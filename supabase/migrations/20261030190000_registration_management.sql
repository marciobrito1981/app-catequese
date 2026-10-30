grant update on public.t_catequista to authenticated;
grant insert on public.registration_preferences to authenticated;

create or replace function public.update_catequizando_registration(
  p_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or (select public.current_user_role()) is distinct from 'administrador'::public.user_role
  then
    raise exception 'Somente administradores podem atualizar catequizandos.';
  end if;

  update public.t_catequizando
  set full_name = btrim(p_payload ->> 'full_name'),
      birth_date = (p_payload ->> 'birth_date')::date,
      cpf = p_payload ->> 'cpf',
      sex = nullif(p_payload ->> 'sex', '')::public.sex,
      marital_status = (p_payload ->> 'marital_status')::public.marital_status,
      postal_code = p_payload ->> 'postal_code',
      street = btrim(p_payload ->> 'street'),
      street_number = btrim(p_payload ->> 'street_number'),
      complement = nullif(btrim(p_payload ->> 'complement'), ''),
      neighborhood = btrim(p_payload ->> 'neighborhood'),
      city = btrim(p_payload ->> 'city'),
      state = upper(p_payload ->> 'state'),
      email = lower(btrim(p_payload ->> 'email')),
      phone = p_payload ->> 'phone',
      referral_source = (p_payload ->> 'referral_source')::public.referral_source,
      referral_other = nullif(btrim(p_payload ->> 'referral_other'), ''),
      registration_reason = (p_payload ->> 'registration_reason')::public.registration_reason,
      reason_other = nullif(btrim(p_payload ->> 'reason_other'), ''),
      sacraments = array(
        select jsonb_array_elements_text(coalesce(p_payload -> 'sacraments', '[]'::jsonb))
      ),
      baptism_date = nullif(p_payload ->> 'baptism_date', '')::date,
      baptism_parish = nullif(btrim(p_payload ->> 'baptism_parish'), ''),
      baptism_city = nullif(btrim(p_payload ->> 'baptism_city'), ''),
      baptism_state = nullif(upper(btrim(p_payload ->> 'baptism_state')), ''),
      eucharist_parish = nullif(btrim(p_payload ->> 'eucharist_parish'), ''),
      eucharist_city = nullif(btrim(p_payload ->> 'eucharist_city'), ''),
      marriage_certificate_path = nullif(p_payload ->> 'marriage_certificate_path', '')
  where id = p_id;

  if not found then
    raise exception 'Cadastro de catequizando não encontrado.';
  end if;

  delete from public.registration_preferences
  where application_id = p_id;

  insert into public.registration_preferences (application_id, schedule_id)
  select p_id, value::uuid
  from jsonb_array_elements_text(coalesce(p_payload -> 'schedule_ids', '[]'::jsonb));
end;
$$;

revoke all on function public.update_catequizando_registration(uuid, jsonb) from public;
grant execute on function public.update_catequizando_registration(uuid, jsonb) to authenticated;

create or replace function public.delete_class_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or (select public.current_user_role()) is distinct from 'administrador'::public.user_role
  then
    raise exception 'Somente administradores podem excluir horários.';
  end if;

  delete from public.registration_preferences
  where schedule_id = p_schedule_id;

  delete from public.class_schedules
  where id = p_schedule_id;

  if not found then
    raise exception 'Horário não encontrado.';
  end if;
end;
$$;

revoke all on function public.delete_class_schedule(uuid) from public;
grant execute on function public.delete_class_schedule(uuid) to authenticated;

create or replace function public.delete_class_record(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or (select public.current_user_role()) is distinct from 'administrador'::public.user_role
  then
    raise exception 'Somente administradores podem excluir turmas.';
  end if;

  delete from public.registration_preferences
  where schedule_id in (
    select id
    from public.class_schedules
    where class_id = p_class_id
  );

  delete from public.classes
  where id = p_class_id;

  if not found then
    raise exception 'Turma não encontrada.';
  end if;
end;
$$;

revoke all on function public.delete_class_record(uuid) from public;
grant execute on function public.delete_class_record(uuid) to authenticated;
