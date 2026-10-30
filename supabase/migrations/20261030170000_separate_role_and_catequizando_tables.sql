update auth.users as auth_user
set raw_user_meta_data = coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'full_name',
    coalesce(
      nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
      profile.full_name
    )
  )
  || case
    when coalesce(auth_user.raw_user_meta_data ->> 'phone', '') = ''
      and profile.phone is not null
    then jsonb_build_object('phone', profile.phone)
    else '{}'::jsonb
  end
from public.profiles as profile
where profile.id = auth_user.id;

create table public.t_catequista (
  id uuid primary key references public.profiles (id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

insert into public.t_catequista (id, full_name, phone)
select id, full_name, phone
from public.profiles
where role = 'catequista'
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

alter table public.applications rename to t_catequizando;
alter table public.t_catequizando
  drop constraint applications_assigned_catechist_id_fkey;
alter table public.t_catequizando
  add constraint t_catequizando_assigned_catechist_id_fkey
  foreign key (assigned_catechist_id)
  references public.t_catequista (id)
  on delete set null;

alter table public.profiles
  drop column full_name,
  drop column phone,
  drop column created_at;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'catequizando')
  on conflict (id) do nothing;
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
    update public.t_catequizando
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
  new_catequizando_id uuid;
begin
  if auth.uid() is null
    or (select public.current_user_role()) is distinct from 'administrador'::public.user_role
  then
    raise exception 'Somente administradores podem cadastrar catequizandos.';
  end if;

  new_catequizando_id := public.submit_public_registration(p_payload);

  update public.t_catequizando
  set user_id = (
    select id
    from auth.users
    where email_confirmed_at is not null
      and lower(btrim(auth.users.email)) = lower(btrim(public.t_catequizando.email))
    order by created_at desc
    limit 1
  )
  where id = new_catequizando_id;

  return new_catequizando_id;
end;
$$;

drop function public.update_own_profile(text, text);

create function public.update_own_profile(p_full_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.user_role;
begin
  if auth.uid() is null or nullif(trim(p_full_name), '') is null then
    raise exception 'Informe seu nome completo.';
  end if;

  caller_role := public.current_user_role();
  if caller_role = 'catequista' then
    update public.t_catequista
    set full_name = trim(p_full_name),
        phone = nullif(trim(p_phone), '')
    where id = auth.uid();
    if not found then
      raise exception 'Cadastro de catequista não encontrado.';
    end if;
  elsif caller_role = 'catequizando' then
    update public.t_catequizando
    set full_name = trim(p_full_name),
        phone = nullif(trim(p_phone), '')
    where user_id = auth.uid();
  elsif caller_role is distinct from 'administrador' then
    raise exception 'Perfil de acesso inválido.';
  end if;
end;
$$;

create view public.applications
with (security_invoker = true)
as
select *
from public.t_catequizando;

alter table public.profiles enable row level security;
alter table public.t_catequista enable row level security;
alter table public.t_catequizando enable row level security;

drop policy if exists "Profiles are visible to their owner and administrators" on public.profiles;
drop policy if exists "Administrators manage profiles" on public.profiles;
create policy "Profiles are visible to their owner and administrators"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.current_user_role()) = 'administrador');
create policy "Administrators manage profiles"
on public.profiles for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

drop policy if exists "Applicants and assigned catechists read authorized applications" on public.t_catequizando;
drop policy if exists "Administrators manage applications" on public.t_catequizando;
create policy "Applicants and assigned catechists read authorized catequizandos"
on public.t_catequizando for select to authenticated
using (
  (select public.current_user_role()) = 'administrador'
  or assigned_catechist_id = (select auth.uid())
  or (
    user_id = (select auth.uid())
    and (select public.current_user_role()) = 'catequizando'
  )
);
create policy "Administrators manage catequizandos"
on public.t_catequizando for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

drop policy if exists "Authorized users read application preferences" on public.registration_preferences;
drop policy if exists "Administrators manage application preferences" on public.registration_preferences;
create policy "Authorized users read catequizando preferences"
on public.registration_preferences for select to authenticated
using (
  exists (
    select 1
    from public.t_catequizando
    where t_catequizando.id = registration_preferences.application_id
  )
);
create policy "Administrators manage catequizando preferences"
on public.registration_preferences for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

create policy "Catechists and administrators read catechist records"
on public.t_catequista for select to authenticated
using (
  id = (select auth.uid())
  or (select public.current_user_role()) = 'administrador'
);
create policy "Administrators manage catechist records"
on public.t_catequista for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

revoke all on public.profiles, public.t_catequista, public.t_catequizando,
  public.applications, public.registration_preferences from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.t_catequista to authenticated;
grant select, update, delete on public.t_catequizando to authenticated;
grant select, update, delete on public.registration_preferences to authenticated;

drop policy if exists "Authorized staff read assigned certificates" on storage.objects;
create policy "Authorized staff read assigned certificates"
on storage.objects for select to authenticated
using (
  bucket_id = 'marriage-certificates'
  and exists (
    select 1
    from public.t_catequizando
    where t_catequizando.marriage_certificate_path = storage.objects.name
      and (
        (select public.current_user_role()) = 'administrador'
        or t_catequizando.assigned_catechist_id = (select auth.uid())
      )
  )
);

revoke all on function public.update_own_profile(text, text) from public;
grant execute on function public.update_own_profile(text, text) to authenticated;

revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.link_verified_user_to_applications() from public;
revoke execute on function public.link_verified_user_to_applications() from anon, authenticated;
