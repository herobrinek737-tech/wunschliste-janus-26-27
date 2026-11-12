-- Admin table access is limited by RLS to users explicitly listed in wish_admins.
grant select on table public.wish_admins to authenticated;
create policy wish_admins_select_self
  on public.wish_admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.wish_items to authenticated;
create policy wish_items_admin_all
  on public.wish_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.wish_admins as admin
      where admin.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.wish_admins as admin
      where admin.user_id = (select auth.uid())
    )
  );

-- Admin RPCs use the caller's role and RLS instead of bypassing row security.
alter function public.admin_list_wish_items() security invoker;
alter function public.admin_save_wish_item(uuid, text, text, integer, boolean) security invoker;
alter function public.admin_delete_wish_item(uuid) security invoker;
alter function public.admin_reset_wish_item(uuid) security invoker;
alter function public.admin_save_wish_order(uuid[]) security invoker;
