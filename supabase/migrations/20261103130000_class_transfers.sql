create table public.class_transfers (
  id uuid primary key default gen_random_uuid(),
  catequizando_id uuid not null references public.t_catequizando(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  to_class_id uuid not null references public.classes(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catequizando_id, meeting_id)
);

alter table public.class_transfers enable row level security;
revoke all on public.class_transfers from anon;
grant select on public.class_transfers to authenticated;

create or replace function public.is_catechist_of_catequizando(p_catequizando_id uuid)
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
  ) or exists (
    select 1
    from public.class_transfers as t
    join public.t_catequista as k on k.class_id = t.to_class_id
    where t.catequizando_id = p_catequizando_id
      and k.id = auth.uid()
  );
$$;

create policy "Coordinators and involved catechists read transfers"
  on public.class_transfers for select to authenticated
  using (
    (select public.current_user_role()) = 'coordenador'
    or public.is_catechist_of_catequizando(catequizando_id)
  );

drop policy "Applicants and class catechists read authorized catequizandos" on public.t_catequizando;
create policy "Applicants and class catechists read authorized catequizandos"
  on public.t_catequizando for select to authenticated
  using (
    (select public.current_user_role()) = 'coordenador'
    or public.is_catechist_of_catequizando(id)
    or (user_id = (select auth.uid()) and (select public.current_user_role()) = 'catequizando')
  );

create or replace function public.transfer_catequizando(
  p_catequizando_id uuid,
  p_class_id uuid,
  p_meeting_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_class uuid;
begin
  if auth.uid() is null then
    raise exception 'Autenticação necessária.';
  end if;

  select assigned_class_id into v_current_class
  from public.t_catequizando where id = p_catequizando_id;
  if not found then
    raise exception 'Catequizando não encontrado.';
  end if;

  if not (
    public.current_user_role() = 'coordenador'
    or exists (
      select 1 from public.t_catequista k
      where k.id = auth.uid() and k.class_id = v_current_class
    )
  ) then
    raise exception 'Somente o catequista da turma ou um coordenador pode transferir o catequizando.';
  end if;

  if not exists (select 1 from public.classes where id = p_class_id and active) then
    raise exception 'Turma de destino inválida ou inativa.';
  end if;
  if p_class_id = v_current_class then
    raise exception 'O catequizando já pertence a essa turma.';
  end if;

  if p_meeting_id is null then
    update public.t_catequizando set assigned_class_id = p_class_id where id = p_catequizando_id;
  else
    if not exists (select 1 from public.meetings where id = p_meeting_id) then
      raise exception 'Encontro não encontrado.';
    end if;
    insert into public.class_transfers (catequizando_id, meeting_id, to_class_id, created_by)
    values (p_catequizando_id, p_meeting_id, p_class_id, auth.uid())
    on conflict (catequizando_id, meeting_id)
    do update set to_class_id = excluded.to_class_id, created_by = excluded.created_by;
  end if;
end;
$$;

revoke all on function public.transfer_catequizando(uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_catequizando(uuid, uuid, uuid) to authenticated;
