-- 1. Renomeia o perfil Administrador para Coordenador mantendo os mesmos acessos.
-- Políticas RLS armazenam o valor do enum por OID e acompanham a renomeação.
alter type public.user_role rename value 'administrador' to 'coordenador';

-- 2. Funções PL/pgSQL comparam o valor como texto; recria-as com o novo nome.
do $$
declare
  fn record;
  new_def text;
begin
  for fn in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc like '%''administrador''%'
  loop
    new_def := replace(fn.def, '''administrador''', '''coordenador''');
    new_def := replace(new_def, 'Somente administradores', 'Somente coordenadores');
    execute new_def;
  end loop;
end;
$$;

-- 3. Alteração de perfil por um coordenador (catequista <-> coordenador).
create or replace function public.change_user_role(p_user_id uuid, p_role public.user_role)
returns public.user_role
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
    raise exception 'Somente coordenadores podem alterar perfis de acesso.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio perfil.';
  end if;
  if p_role not in ('catequista', 'coordenador') then
    raise exception 'Perfil de destino inválido.';
  end if;

  select role into target_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  if target_role = 'catequizando' then
    raise exception 'O perfil de catequizando não pode ser alterado.';
  end if;

  if p_role = 'catequista' then
    insert into public.t_catequista (id, full_name, phone, email)
    select
      auth_user.id,
      coalesce(nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''), 'Catequista'),
      nullif(regexp_replace(coalesce(auth_user.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), ''),
      lower(auth_user.email)
    from auth.users as auth_user
    where auth_user.id = p_user_id
    on conflict (id) do nothing;
  end if;

  update public.profiles set role = p_role where id = p_user_id;
  return p_role;
end;
$$;

revoke all on function public.change_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.change_user_role(uuid, public.user_role) to authenticated;
