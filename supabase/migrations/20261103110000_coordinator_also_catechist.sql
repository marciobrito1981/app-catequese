-- Coordenador também pode atuar como catequista e pertencer a uma turma.
-- O vínculo é o cadastro em t_catequista; as políticas e avisos já se baseiam nele, independente do perfil.

create or replace function public.set_coordinator_catechist(
  p_user_id uuid,
  p_enabled boolean,
  p_class_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.user_role;
begin
  if auth.uid() is null
    or (select public.current_user_role()) is distinct from 'coordenador'::public.user_role
  then
    raise exception 'Somente coordenadores podem alterar este vínculo.';
  end if;

  select role into target_role from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  if target_role is distinct from 'coordenador'::public.user_role then
    raise exception 'Esta opção vale apenas para usuários com perfil de coordenador.';
  end if;

  if not p_enabled then
    delete from public.t_catequista where id = p_user_id;
    return;
  end if;

  if p_class_id is not null
    and not exists (select 1 from public.classes where id = p_class_id and active)
  then
    raise exception 'A turma selecionada não está ativa ou não existe.';
  end if;

  insert into public.t_catequista (id, full_name, phone, email, class_id)
  select
    auth_user.id,
    coalesce(nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''), 'Coordenador'),
    nullif(regexp_replace(coalesce(auth_user.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), ''),
    lower(auth_user.email),
    p_class_id
  from auth.users as auth_user
  where auth_user.id = p_user_id
  on conflict (id) do update set class_id = excluded.class_id;
end;
$$;

revoke all on function public.set_coordinator_catechist(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_coordinator_catechist(uuid, boolean, uuid) to authenticated;
