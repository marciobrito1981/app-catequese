-- Agenda de encontros: cada turma cadastra as datas dos encontros; todos os usuários autenticados podem consultar.

create table public.class_meeting_dates (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  meeting_date date not null,
  starts_at time,
  location text check (location is null or length(location) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (class_id, meeting_id)
);
create index class_meeting_dates_date_idx on public.class_meeting_dates (meeting_date);

-- Indica se o usuário logado é catequista da turma informada.
create function public.is_catechist_of_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.t_catequista as k
    where k.id = auth.uid() and k.class_id = p_class_id
  );
$$;
revoke all on function public.is_catechist_of_class(uuid) from public, anon;
grant execute on function public.is_catechist_of_class(uuid) to authenticated;

alter table public.class_meeting_dates enable row level security;

create policy "Authenticated read meeting dates"
on public.class_meeting_dates for select to authenticated using (true);

create policy "Coordinators and class catechists manage meeting dates"
on public.class_meeting_dates for all to authenticated
using (
  (select public.current_user_role()) = 'coordenador'
  or public.is_catechist_of_class(class_id)
)
with check (
  (select public.current_user_role()) = 'coordenador'
  or public.is_catechist_of_class(class_id)
);
