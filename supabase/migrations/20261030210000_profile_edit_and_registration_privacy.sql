-- Perfil editável, e-mail/CPF de catequistas e proteção dos dados cadastrais.

-- 1. Catequista: e-mail e CPF.
alter table public.t_catequista
  add column if not exists email text,
  add column if not exists cpf text;

update public.t_catequista as catechist
set email = lower(btrim(auth_user.email))
from auth.users as auth_user
where auth_user.id = catechist.id
  and catechist.email is null;

alter table public.t_catequista
  drop constraint if exists t_catequista_email_format,
  drop constraint if exists t_catequista_cpf_format;
alter table public.t_catequista
  add constraint t_catequista_email_format
    check (email is null or (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email) <= 254)),
  add constraint t_catequista_cpf_format
    check (cpf is null or cpf ~ '^[0-9]{11}$');

create unique index if not exists t_catequista_cpf_unique
  on public.t_catequista (cpf)
  where cpf is not null;

-- 2. CPF e data de nascimento não podem ser alterados por usuários autenticados.
-- Chamadas administrativas feitas pelo service_role (auth.uid() nulo) continuam possíveis.
create or replace function public.guard_catequizando_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and (new.cpf is distinct from old.cpf or new.birth_date is distinct from old.birth_date)
  then
    raise exception 'CPF e data de nascimento não podem ser alterados.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_catequizando_identity on public.t_catequizando;
create trigger guard_catequizando_identity
before update on public.t_catequizando
for each row execute function public.guard_catequizando_identity();

create or replace function public.guard_catechist_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cpf is not null and not public.is_valid_cpf(new.cpf) then
    raise exception 'CPF inválido.';
  end if;
  if tg_op = 'UPDATE'
    and auth.uid() is not null
    and new.cpf is distinct from old.cpf
  then
    raise exception 'O CPF do catequista não pode ser alterado por esta operação.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_catechist_identity() from public, anon, authenticated;
revoke all on function public.guard_catequizando_identity() from public, anon, authenticated;

drop trigger if exists guard_catechist_identity on public.t_catequista;
create trigger guard_catechist_identity
before insert or update on public.t_catequista
for each row execute function public.guard_catechist_identity();

-- 3. Nenhum cadastro é editado por chamadas diretas à API.
-- Administradores só atualizam a turma do catequizando; catequistas são editados pela Edge Function update-catechist.
revoke update on public.t_catequizando from authenticated;
revoke update on public.t_catequista from authenticated;
do $$
declare
  target record;
begin
  for target in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('t_catequizando', 't_catequista')
  loop
    execute format(
      'revoke update (%I) on public.%I from authenticated, anon',
      target.column_name,
      target.table_name
    );
  end loop;
end;
$$;
grant update (assigned_class_id) on public.t_catequizando to authenticated;

revoke all on function public.update_catequizando_registration(uuid, jsonb) from public, anon, authenticated;
drop function if exists public.update_catequizando_registration(uuid, jsonb);

-- 4. Atualização do próprio perfil (somente campos permitidos).
drop function if exists public.update_own_profile(text, text);
create function public.update_own_profile(
  p_full_name text,
  p_phone text,
  p_address jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.user_role;
  clean_name text := btrim(coalesce(p_full_name, ''));
  clean_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  clean_postal_code text;
  clean_state text;
  clean_street text;
  clean_number text;
  clean_neighborhood text;
  clean_city text;
begin
  if auth.uid() is null then
    raise exception 'Autenticação necessária.';
  end if;
  if clean_name = '' or length(clean_name) > 150 then
    raise exception 'Informe seu nome completo.';
  end if;
  if clean_phone !~ '^[0-9]{10,11}$' then
    raise exception 'Informe um telefone válido com DDD.';
  end if;

  caller_role := public.current_user_role();
  if caller_role = 'catequista' then
    update public.t_catequista
    set full_name = clean_name,
        phone = clean_phone
    where id = auth.uid();
    if not found then
      raise exception 'Cadastro de catequista não encontrado.';
    end if;
  elsif caller_role = 'catequizando' then
    if p_address is not null then
      clean_postal_code := regexp_replace(coalesce(p_address ->> 'postal_code', ''), '[^0-9]', '', 'g');
      clean_state := upper(btrim(coalesce(p_address ->> 'state', '')));
      clean_street := btrim(coalesce(p_address ->> 'street', ''));
      clean_number := btrim(coalesce(p_address ->> 'street_number', ''));
      clean_neighborhood := btrim(coalesce(p_address ->> 'neighborhood', ''));
      clean_city := btrim(coalesce(p_address ->> 'city', ''));
      if clean_postal_code !~ '^[0-9]{8}$'
        or clean_state !~ '^[A-Z]{2}$'
        or clean_street = '' or clean_number = ''
        or clean_neighborhood = '' or clean_city = ''
      then
        raise exception 'Informe o endereço completo.';
      end if;
    end if;

    update public.t_catequizando
    set full_name = clean_name,
        phone = clean_phone,
        postal_code = coalesce(clean_postal_code, postal_code),
        street = coalesce(clean_street, street),
        street_number = coalesce(clean_number, street_number),
        complement = case
          when p_address is null then complement
          else nullif(btrim(coalesce(p_address ->> 'complement', '')), '')
        end,
        neighborhood = coalesce(clean_neighborhood, neighborhood),
        city = coalesce(clean_city, city),
        state = coalesce(clean_state, state)
    where user_id = auth.uid();
    if not found then
      raise exception 'Cadastro de catequizando não encontrado.';
    end if;
  elsif caller_role is distinct from 'administrador' then
    raise exception 'Perfil de acesso inválido.';
  end if;
end;
$$;

revoke all on function public.update_own_profile(text, text, jsonb) from public, anon;
grant execute on function public.update_own_profile(text, text, jsonb) to authenticated;

-- 5. Mantém o e-mail do cadastro igual ao e-mail de login após a confirmação da troca.
create or replace function public.sync_registration_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.t_catequizando
    set email = lower(btrim(new.email))
    where user_id = new.id;
    update public.t_catequista
    set email = lower(btrim(new.email))
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_registration_email_from_auth() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function public.sync_registration_email_from_auth();
