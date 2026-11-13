-- Keep the currently published Janus admin page functional until its updated
-- frontend is deployed, while replacing giver identities with a neutral status.
create function public.admin_list_wish_items()
returns table (
  id uuid,
  title text,
  url text,
  price_cents integer,
  sort_order integer,
  is_featured boolean,
  reserved_by text,
  reserved_email text,
  reserved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
    raise exception 'Nicht autorisiert.';
  end if;

  return query
  select item.id, item.title, item.url, item.price_cents, item.sort_order,
         item.is_featured,
         case when item.reserved_by is null then null else 'Bereits verschenkt' end,
         null::text,
         null::timestamptz
  from public.wish_items as item
  where item.list_slug = 'janus'
  order by item.sort_order asc, item.created_at asc;
end;
$$;

create function public.admin_save_wish_item(
  p_item_id uuid,
  p_title text,
  p_url text,
  p_price_cents integer,
  p_is_featured boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_image_url text;
  v_id uuid;
begin
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
    raise exception 'Nicht autorisiert.';
  end if;

  if p_item_id is not null then
    select item.image_url into v_image_url
    from public.wish_items as item
    where item.id = p_item_id and item.list_slug = 'janus'
    for update;
  end if;

  select public.admin_save_wish_item(
    p_item_id, 'janus', p_title, p_url, p_price_cents, p_is_featured, v_image_url
  ) into v_id;
  return v_id;
end;
$$;

create function public.admin_delete_wish_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_delete_wish_item(p_item_id, 'janus');
end;
$$;

create function public.admin_reset_wish_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.admin_reset_wish_item(p_item_id, 'janus');
end;
$$;

create function public.admin_save_wish_order(p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_save_wish_order(p_item_ids, 'janus');
end;
$$;

revoke all on function public.admin_list_wish_items() from public, anon;
revoke all on function public.admin_save_wish_item(uuid, text, text, integer, boolean) from public, anon;
revoke all on function public.admin_delete_wish_item(uuid) from public, anon;
revoke all on function public.admin_reset_wish_item(uuid) from public, anon;
revoke all on function public.admin_save_wish_order(uuid[]) from public, anon;

grant execute on function public.admin_list_wish_items() to authenticated;
grant execute on function public.admin_save_wish_item(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.admin_delete_wish_item(uuid) to authenticated;
grant execute on function public.admin_reset_wish_item(uuid) to authenticated;
grant execute on function public.admin_save_wish_order(uuid[]) to authenticated;
