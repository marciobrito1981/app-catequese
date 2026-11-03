alter table public.t_catequizando
  add column if not exists active boolean not null default true;
