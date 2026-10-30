create or replace function public.create_catequizando_registration(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_application_id uuid;
begin
  if auth.uid() is null
    or (select public.current_user_role()) is distinct from 'administrador'::public.user_role
  then
    raise exception 'Somente administradores podem cadastrar catequizandos.';
  end if;

  new_application_id := public.submit_public_registration(p_payload);

  update public.applications
  set user_id = (
    select id
    from auth.users
    where email_confirmed_at is not null
      and lower(btrim(auth.users.email)) = lower(btrim(public.applications.email))
    order by created_at desc
    limit 1
  )
  where id = new_application_id;

  return new_application_id;
end;
$$;

revoke execute on function public.create_catequizando_registration(jsonb) from anon;
grant execute on function public.create_catequizando_registration(jsonb) to authenticated;

revoke execute on function public.current_user_role() from anon;
grant execute on function public.current_user_role() to authenticated;

revoke execute on function public.handle_new_auth_user() from anon, authenticated;
revoke execute on function public.link_verified_user_to_applications() from anon, authenticated;

revoke execute on function public.update_own_profile(text, text) from anon;
grant execute on function public.update_own_profile(text, text) to authenticated;
