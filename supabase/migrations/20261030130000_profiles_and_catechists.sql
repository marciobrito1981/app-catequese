alter table public.profiles
  add column if not exists phone text;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Usuário'),
    'catequizando',
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      phone = coalesce(excluded.phone, public.profiles.phone);
  return new;
end;
$$;

create or replace function public.link_verified_user_to_applications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
    and (tg_op = 'INSERT' or old.email_confirmed_at is null)
  then
    update public.applications
    set user_id = new.id
    where user_id is null
      and lower(btrim(email)) = lower(btrim(new.email));
  end if;
  return new;
end;
$$;

create or replace function public.create_catequizando_registration(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_application_id uuid;
begin
  if (select public.current_user_role()) <> 'administrador' then
    raise exception 'Somente administradores podem cadastrar catequizandos.';
  end if;

  new_application_id := public.submit_public_registration(p_payload);

  update public.applications
  set user_id = (
    select id
    from auth.users
    where email_confirmed_at is not null
      and lower(btrim(email)) = lower(btrim(public.applications.email))
    order by created_at desc
    limit 1
  )
  where id = new_application_id;

  return new_application_id;
end;
$$;

revoke all on function public.create_catequizando_registration(jsonb) from public;
grant execute on function public.create_catequizando_registration(jsonb) to authenticated;

create or replace function public.update_own_profile(p_full_name text, p_phone text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  if auth.uid() is null or nullif(trim(p_full_name), '') is null then
    raise exception 'Informe seu nome completo.';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(p_phone), '')
  where id = auth.uid()
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Perfil não encontrado.';
  end if;

  update public.applications
  set full_name = updated_profile.full_name,
      phone = coalesce(updated_profile.phone, phone)
  where user_id = auth.uid();

  return updated_profile;
end;
$$;

revoke all on function public.update_own_profile(text, text) from public;
grant execute on function public.update_own_profile(text, text) to authenticated;

revoke all on function public.handle_new_auth_user() from public;
