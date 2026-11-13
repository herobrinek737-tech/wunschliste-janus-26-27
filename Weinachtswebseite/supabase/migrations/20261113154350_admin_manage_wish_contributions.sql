-- Let wishlist editors manage anonymous contribution amounts without exposing
-- contributor names or email addresses. Papa's separate viewer role continues
-- to control access to the full gift activity.

create function public.admin_list_wish_contributions(p_list_slug text)
returns table (
  activity_id uuid,
  item_id uuid,
  list_slug text,
  item_title text,
  amount_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.wish_admins as admin
    where admin.user_id = (select auth.uid())
  ) then
    raise exception 'Nicht autorisiert.';
  end if;

  if p_list_slug is null or p_list_slug not in ('janus', 'marlene') then
    raise exception 'Unbekannte Wunschliste.';
  end if;

  return query
  select contribution.id, item.id, item.list_slug, item.title,
         contribution.amount_cents
  from public.wish_contributions as contribution
  join public.wish_items as item on item.id = contribution.item_id
  where item.list_slug = p_list_slug
  order by contribution.created_at desc, contribution.id desc;
end;
$$;

create function public.admin_delete_wish_contribution(p_contribution_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
begin
  if not exists (
    select 1 from public.wish_admins as admin
    where admin.user_id = (select auth.uid())
  ) then
    raise exception 'Nicht autorisiert.';
  end if;

  select contribution.item_id into v_item_id
  from public.wish_contributions as contribution
  where contribution.id = p_contribution_id;

  if not found then
    return false;
  end if;

  -- Serialize deletes with contribution inserts, which lock the same item
  -- before checking the remaining amount.
  perform 1
  from public.wish_items as item
  where item.id = v_item_id
  for update;

  delete from public.wish_contributions as contribution
  where contribution.id = p_contribution_id;
  return found;
end;
$$;

revoke all on function public.admin_list_wish_contributions(text) from public, anon;
revoke all on function public.admin_delete_wish_contribution(uuid) from public, anon;
grant execute on function public.admin_list_wish_contributions(text) to authenticated;
grant execute on function public.admin_delete_wish_contribution(uuid) to authenticated;
