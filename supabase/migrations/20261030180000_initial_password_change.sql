create table public.user_access_status (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  must_change_password boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_access_status enable row level security;
revoke all on public.user_access_status from anon, authenticated;

create or replace function public.is_initial_password_change_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select user_access_status.must_change_password
      from public.user_access_status
      where user_access_status.user_id = (select auth.uid())
    ),
    false
  )
$$;

revoke all on function public.is_initial_password_change_required() from public;
grant execute on function public.is_initial_password_change_required() to authenticated;
