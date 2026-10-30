create type public.user_role as enum ('administrador', 'catequista', 'catequizando');
create type public.marital_status as enum (
  'solteiro',
  'casado_igreja',
  'casado_civil',
  'divorciado',
  'viuvo',
  'outro'
);
create type public.sex as enum ('feminino', 'masculino', 'outro', 'prefiro_nao_informar');
create type public.referral_source as enum (
  'amigos_familiares',
  'missas',
  'catequese_infantil',
  'outro'
);
create type public.registration_reason as enum (
  'preparacao_casamento',
  'receber_sacramentos',
  'ouvinte',
  'acompanhar_filho',
  'outro'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'catequizando',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Usuário'),
    'catequizando'
  );
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

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

revoke all on function public.link_verified_user_to_applications() from public;

create trigger on_auth_user_verified_to_applications
after insert or update of email_confirmed_at on auth.users
for each row execute function public.link_verified_user_to_applications();

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  available boolean not null default true,
  check (ends_at > starts_at),
  unique (class_id, weekday, starts_at, ends_at)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  assigned_catechist_id uuid references public.profiles (id) on delete set null,
  full_name text not null,
  birth_date date not null,
  cpf text not null,
  sex public.sex,
  marital_status public.marital_status not null,
  postal_code text not null,
  street text not null,
  street_number text not null,
  complement text,
  neighborhood text not null,
  city text not null,
  state text not null,
  email text not null,
  phone text not null,
  referral_source public.referral_source not null,
  referral_other text,
  registration_reason public.registration_reason not null,
  reason_other text,
  sacraments text[] not null default '{}',
  baptism_date date,
  baptism_parish text,
  baptism_city text,
  baptism_state text,
  eucharist_parish text,
  eucharist_city text,
  privacy_acknowledged_at timestamptz not null,
  marriage_certificate_path text,
  created_at timestamptz not null default now(),
  check (cpf ~ '^[0-9]{11}$'),
  check (postal_code ~ '^[0-9]{8}$'),
  check (state ~ '^[A-Z]{2}$'),
  check (
    sacraments <@ array['batismo', 'primeira_eucaristia', 'crisma', 'nenhum']::text[]
    and (not ('nenhum' = any(sacraments)) or cardinality(sacraments) = 1)
  ),
  check (
    'batismo' = any(sacraments)
    or (baptism_date is null and baptism_parish is null and baptism_city is null and baptism_state is null)
  ),
  check (
    'primeira_eucaristia' = any(sacraments)
    or (eucharist_parish is null and eucharist_city is null)
  ),
  check (
    referral_source <> 'outro'
    or nullif(trim(referral_other), '') is not null
  ),
  check (
    registration_reason <> 'outro'
    or nullif(trim(reason_other), '') is not null
  )
);

create table public.registration_preferences (
  application_id uuid not null references public.applications (id) on delete cascade,
  schedule_id uuid not null references public.class_schedules (id) on delete restrict,
  primary key (application_id, schedule_id)
);

create schema if not exists private;

create table private.registration_upload_tokens (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter table private.registration_upload_tokens enable row level security;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

create or replace function public.create_registration_upload_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token uuid;
begin
  insert into private.registration_upload_tokens default values
  returning token into new_token;
  return new_token;
end;
$$;

revoke all on function public.create_registration_upload_token() from public;
grant execute on function public.create_registration_upload_token() to anon, authenticated;

create or replace function public.is_registration_upload_token_valid(p_token uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.registration_upload_tokens
    where token = p_token
      and consumed_at is null
      and created_at > now() - interval '1 hour'
  )
$$;

revoke all on function public.is_registration_upload_token_valid(uuid) from public;
grant execute on function public.is_registration_upload_token_valid(uuid) to anon, authenticated;

create or replace function public.is_valid_cpf(p_cpf text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  cpf_digits text := regexp_replace(p_cpf, '[^0-9]', '', 'g');
  sum_digits integer;
  remainder integer;
  expected_digit integer;
  digit_index integer;
  weight_position integer;
begin
  if length(cpf_digits) <> 11 or cpf_digits ~ '^([0-9])\1{10}$' then
    return false;
  end if;

  for digit_index in 9..10 loop
    sum_digits := 0;
    for weight_position in 1..digit_index loop
      sum_digits := sum_digits + substring(cpf_digits from weight_position for 1)::integer * (digit_index + 2 - weight_position);
    end loop;
    remainder := (sum_digits * 10) % 11;
    expected_digit := case when remainder = 10 then 0 else remainder end;
    if substring(cpf_digits from digit_index + 1 for 1)::integer <> expected_digit then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.is_valid_cpf(text) from public;

create or replace function public.submit_public_registration(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_application_id uuid;
  selected_schedule_id uuid;
  certificate_path text;
  upload_token uuid;
begin
  if nullif(trim(p_payload ->> 'full_name'), '') is null
    or nullif(trim(p_payload ->> 'birth_date'), '') is null
    or nullif(p_payload ->> 'cpf', '') is null
    or nullif(trim(p_payload ->> 'postal_code'), '') is null
    or nullif(trim(p_payload ->> 'street'), '') is null
    or nullif(trim(p_payload ->> 'street_number'), '') is null
    or nullif(trim(p_payload ->> 'neighborhood'), '') is null
    or nullif(trim(p_payload ->> 'city'), '') is null
    or nullif(trim(p_payload ->> 'state'), '') is null
    or nullif(trim(p_payload ->> 'email'), '') is null
    or nullif(trim(p_payload ->> 'phone'), '') is null
    or coalesce(p_payload ->> 'privacy_acknowledged', '') <> 'true'
  then
    raise exception 'Preencha os campos obrigatórios e confirme o aviso de privacidade.';
  end if;

  if p_payload ->> 'cpf' !~ '^[0-9]{11}$'
    or not public.is_valid_cpf(p_payload ->> 'cpf')
    or p_payload ->> 'postal_code' !~ '^[0-9]{8}$'
    or p_payload ->> 'state' !~ '^[A-Z]{2}$'
    or p_payload ->> 'email' !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or p_payload ->> 'phone' !~ '^[0-9]{10,11}$'
    or (p_payload ->> 'birth_date')::date > current_date
  then
    raise exception 'Confira o CPF, o CEP e a unidade federativa.';
  end if;

  certificate_path := nullif(p_payload ->> 'marriage_certificate_path', '');
  if certificate_path is not null then
    if certificate_path !~ '^[0-9a-f-]{36}/certificate\.(pdf|jpg|jpeg|png)$' then
      raise exception 'O comprovante anexado não é válido.';
    end if;
    upload_token := split_part(certificate_path, '/', 1)::uuid;
    if not public.is_registration_upload_token_valid(upload_token) then
      raise exception 'O envio do comprovante expirou. Anexe o arquivo novamente.';
    end if;
  end if;

  insert into public.applications (
    full_name, birth_date, cpf, sex, marital_status, postal_code, street,
    street_number, complement, neighborhood, city, state, email, phone,
    referral_source, referral_other, registration_reason, reason_other,
    sacraments, baptism_date, baptism_parish, baptism_city, baptism_state,
    eucharist_parish, eucharist_city,
    privacy_acknowledged_at, marriage_certificate_path
  )
  values (
    trim(p_payload ->> 'full_name'),
    (p_payload ->> 'birth_date')::date,
    p_payload ->> 'cpf',
    nullif(p_payload ->> 'sex', '')::public.sex,
    (p_payload ->> 'marital_status')::public.marital_status,
    p_payload ->> 'postal_code',
    trim(p_payload ->> 'street'),
    trim(p_payload ->> 'street_number'),
    nullif(trim(p_payload ->> 'complement'), ''),
    trim(p_payload ->> 'neighborhood'),
    trim(p_payload ->> 'city'),
    p_payload ->> 'state',
    trim(p_payload ->> 'email'),
    trim(p_payload ->> 'phone'),
    (p_payload ->> 'referral_source')::public.referral_source,
    nullif(trim(p_payload ->> 'referral_other'), ''),
    (p_payload ->> 'registration_reason')::public.registration_reason,
    nullif(trim(p_payload ->> 'reason_other'), ''),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p_payload -> 'sacraments', '[]'::jsonb))),
      '{}'::text[]
    ),
    nullif(p_payload ->> 'baptism_date', '')::date,
    nullif(trim(p_payload ->> 'baptism_parish'), ''),
    nullif(trim(p_payload ->> 'baptism_city'), ''),
    nullif(upper(trim(p_payload ->> 'baptism_state')), ''),
    nullif(trim(p_payload ->> 'eucharist_parish'), ''),
    nullif(trim(p_payload ->> 'eucharist_city'), ''),
    now(),
    certificate_path
  )
  returning id into new_application_id;

  for selected_schedule_id in
    select distinct value::uuid
    from jsonb_array_elements_text(coalesce(p_payload -> 'schedule_ids', '[]'::jsonb))
  loop
    if not exists (
      select 1
      from public.class_schedules schedule
      join public.classes class on class.id = schedule.class_id
      where schedule.id = selected_schedule_id
        and schedule.active
        and schedule.available
        and class.active
    ) then
      raise exception 'Uma das opções de horário não está mais disponível. Atualize a página e tente novamente.';
    end if;
    insert into public.registration_preferences (application_id, schedule_id)
    values (new_application_id, selected_schedule_id);
  end loop;

  if upload_token is not null then
    update private.registration_upload_tokens
    set consumed_at = now()
    where token = upload_token;
  end if;

  return new_application_id;
end;
$$;

revoke all on function public.submit_public_registration(jsonb) from public;
grant execute on function public.submit_public_registration(jsonb) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_schedules enable row level security;
alter table public.applications enable row level security;
alter table public.registration_preferences enable row level security;

create policy "Profiles are visible to their owner and administrators"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.current_user_role()) = 'administrador');

create policy "Administrators manage profiles"
on public.profiles for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

create policy "Anyone reads active classes"
on public.classes for select to anon, authenticated
using (active);

create policy "Administrators manage classes"
on public.classes for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

create policy "Anyone reads available active schedules"
on public.class_schedules for select to anon, authenticated
using (
  active
  and available
  and exists (
    select 1 from public.classes
    where classes.id = class_schedules.class_id and classes.active
  )
);

create policy "Administrators manage schedules"
on public.class_schedules for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

create policy "Applicants and assigned catechists read authorized applications"
on public.applications for select to authenticated
using (
  (select public.current_user_role()) = 'administrador'
  or assigned_catechist_id = (select auth.uid())
  or (
    user_id = (select auth.uid())
    and (select public.current_user_role()) = 'catequizando'
  )
);

create policy "Administrators manage applications"
on public.applications for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

create policy "Authorized users read application preferences"
on public.registration_preferences for select to authenticated
using (
  exists (
    select 1 from public.applications
    where applications.id = registration_preferences.application_id
  )
);

create policy "Administrators manage application preferences"
on public.registration_preferences for all to authenticated
using ((select public.current_user_role()) = 'administrador')
with check ((select public.current_user_role()) = 'administrador');

revoke all on public.profiles, public.classes, public.class_schedules,
  public.applications, public.registration_preferences from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.classes, public.class_schedules to anon, authenticated;
grant insert, update, delete on public.classes, public.class_schedules to authenticated;
grant select on public.applications, public.registration_preferences to authenticated;
grant update, delete on public.applications, public.registration_preferences to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marriage-certificates',
  'marriage-certificates',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public uploads use short-lived one-time tokens"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'marriage-certificates'
  and name ~ '^[0-9a-f-]{36}/certificate\.(pdf|jpg|jpeg|png)$'
  and public.is_registration_upload_token_valid(split_part(name, '/', 1)::uuid)
);

create policy "Authorized staff read assigned certificates"
on storage.objects for select to authenticated
using (
  bucket_id = 'marriage-certificates'
  and exists (
    select 1
    from public.applications
    where applications.marriage_certificate_path = storage.objects.name
      and (
        (select public.current_user_role()) = 'administrador'
        or applications.assigned_catechist_id = (select auth.uid())
      )
  )
);

-- Após criar a conta do administrador autorizado, execute no SQL Editor:
-- update public.profiles
-- set role = 'administrador'
-- where id = 'UUID-DO-USUARIO-AUTORIZADO';
