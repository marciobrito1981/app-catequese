alter table public.t_catequizando
  add column assigned_class_id uuid references public.classes (id) on delete set null;

alter table public.t_catequista
  add column class_id uuid references public.classes (id) on delete set null;

drop policy if exists "Applicants and assigned catechists read authorized catequizandos"
on public.t_catequizando;
create policy "Applicants and class catechists read authorized catequizandos"
on public.t_catequizando for select to authenticated
using (
  (select public.current_user_role()) = 'administrador'
  or exists (
    select 1
    from public.t_catequista
    where t_catequista.id = (select auth.uid())
      and t_catequista.class_id = t_catequizando.assigned_class_id
  )
  or (
    user_id = (select auth.uid())
    and (select public.current_user_role()) = 'catequizando'
  )
);

create policy "Catechists read their assigned classes"
on public.classes for select to authenticated
using (
  exists (
    select 1
    from public.t_catequista
    where t_catequista.id = (select auth.uid())
      and t_catequista.class_id = classes.id
  )
);

drop policy if exists "Authorized staff read assigned certificates"
on storage.objects;
create policy "Authorized staff read class assigned certificates"
on storage.objects for select to authenticated
using (
  bucket_id = 'marriage-certificates'
  and exists (
    select 1
    from public.t_catequizando
    where t_catequizando.marriage_certificate_path = storage.objects.name
      and (
        (select public.current_user_role()) = 'administrador'
        or exists (
          select 1
          from public.t_catequista
          where t_catequista.id = (select auth.uid())
            and t_catequista.class_id = t_catequizando.assigned_class_id
        )
      )
  )
);
