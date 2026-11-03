-- Encontros, limite de faltas, chamada e avisos de excesso de faltas.

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_number integer not null unique check (meeting_number > 0),
  theme text not null check (length(btrim(theme)) between 1 and 200),
  mandatory boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.absence_settings (
  id boolean primary key default true check (id),
  max_absences integer not null default 3 check (max_absences between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.absence_settings (id, max_absences) values (true, 3);

create table public.meeting_attendance (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  catequizando_id uuid not null references public.t_catequizando (id) on delete cascade,
  present boolean not null,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (meeting_id, catequizando_id)
);
create index meeting_attendance_catequizando_idx on public.meeting_attendance (catequizando_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipient_email text,
  title text not null,
  message text not null,
  catequizando_id uuid references public.t_catequizando (id) on delete cascade,
  absence_count integer,
  read_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, catequizando_id, absence_count)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Indica se o usuário logado é catequista da turma do catequizando informado.
create function public.is_catechist_of_catequizando(p_catequizando_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.t_catequizando as c
    join public.t_catequista as k on k.class_id = c.assigned_class_id
    where c.id = p_catequizando_id
      and k.id = auth.uid()
  );
$$;
revoke all on function public.is_catechist_of_catequizando(uuid) from public, anon;
grant execute on function public.is_catechist_of_catequizando(uuid) to authenticated;

-- Gera avisos quando as faltas do catequizando ultrapassam o limite.
create function public.notify_absence_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  absence_limit integer;
  absence_total integer;
  reg record;
  alert_title text;
  alert_message text;
begin
  if new.present then
    return new;
  end if;

  select max_absences into absence_limit from public.absence_settings where id;
  select count(*) into absence_total
  from public.meeting_attendance
  where catequizando_id = new.catequizando_id and not present;
  if absence_total <= absence_limit then
    return new;
  end if;

  select id, full_name, email, user_id, assigned_class_id into reg
  from public.t_catequizando where id = new.catequizando_id;
  if not found then
    return new;
  end if;

  alert_title := 'Limite de faltas ultrapassado';

  if reg.user_id is not null then
    insert into public.notifications (user_id, recipient_email, title, message, catequizando_id, absence_count)
    values (
      reg.user_id, reg.email, alert_title,
      format('Você acumulou %s faltas, acima do limite de %s. Procure seu catequista.', absence_total, absence_limit),
      reg.id, absence_total
    )
    on conflict (user_id, catequizando_id, absence_count) do nothing;
  end if;

  insert into public.notifications (user_id, recipient_email, title, message, catequizando_id, absence_count)
  select
    k.id, k.email, alert_title,
    format('%s acumulou %s faltas, acima do limite de %s.', reg.full_name, absence_total, absence_limit),
    reg.id, absence_total
  from public.t_catequista as k
  where reg.assigned_class_id is not null and k.class_id = reg.assigned_class_id
  on conflict (user_id, catequizando_id, absence_count) do nothing;

  return new;
end;
$$;
revoke all on function public.notify_absence_limit() from public, anon, authenticated;

create trigger meeting_attendance_absence_alert
after insert or update of present on public.meeting_attendance
for each row execute function public.notify_absence_limit();

alter table public.meetings enable row level security;
alter table public.absence_settings enable row level security;
alter table public.meeting_attendance enable row level security;
alter table public.notifications enable row level security;

create policy "Authenticated read meetings"
on public.meetings for select to authenticated using (true);
create policy "Coordinators manage meetings"
on public.meetings for all to authenticated
using ((select public.current_user_role()) = 'coordenador')
with check ((select public.current_user_role()) = 'coordenador');

create policy "Authenticated read absence settings"
on public.absence_settings for select to authenticated using (true);
create policy "Coordinators manage absence settings"
on public.absence_settings for update to authenticated
using ((select public.current_user_role()) = 'coordenador')
with check ((select public.current_user_role()) = 'coordenador');

create policy "Staff and owners read attendance"
on public.meeting_attendance for select to authenticated
using (
  (select public.current_user_role()) = 'coordenador'
  or public.is_catechist_of_catequizando(catequizando_id)
  or exists (
    select 1 from public.t_catequizando c
    where c.id = meeting_attendance.catequizando_id and c.user_id = (select auth.uid())
  )
);
create policy "Coordinators and class catechists insert attendance"
on public.meeting_attendance for insert to authenticated
with check (
  (select public.current_user_role()) = 'coordenador'
  or public.is_catechist_of_catequizando(catequizando_id)
);
create policy "Coordinators and class catechists update attendance"
on public.meeting_attendance for update to authenticated
using (
  (select public.current_user_role()) = 'coordenador'
  or public.is_catechist_of_catequizando(catequizando_id)
)
with check (
  (select public.current_user_role()) = 'coordenador'
  or public.is_catechist_of_catequizando(catequizando_id)
);

create policy "Users read own notifications"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy "Users mark own notifications as read"
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.meetings, public.absence_settings, public.meeting_attendance, public.notifications from public, anon, authenticated;
grant select, insert, update, delete on public.meetings to authenticated;
grant select, update (max_absences, updated_at) on public.absence_settings to authenticated;
grant select, insert, update on public.meeting_attendance to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
