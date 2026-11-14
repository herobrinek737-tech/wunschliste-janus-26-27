create table public.wish_list_admins (
  user_id uuid not null references auth.users(id) on delete cascade,
  list_slug text not null check (list_slug in ('janus', 'marlene')),
  primary key (user_id, list_slug)
);
alter table public.wish_list_admins enable row level security;
revoke all on public.wish_list_admins from public, anon, authenticated;

create function public.can_manage_wish_list(p_list_slug text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_list_slug in ('janus', 'marlene'), false)
    and (
      exists (select 1 from public.wish_admins where user_id = (select auth.uid()))
      or exists (select 1 from public.wish_list_admins where user_id = (select auth.uid()) and list_slug = p_list_slug)
    );
$$;
revoke all on function public.can_manage_wish_list(text) from public, anon;
grant execute on function public.can_manage_wish_list(text) to authenticated;

create or replace function public.get_admin_capabilities()
returns table (can_edit boolean, can_view_givers boolean)
language sql stable security invoker set search_path = ''
as $$
  select public.can_manage_wish_list('janus') or public.can_manage_wish_list('marlene'),
    exists (select 1 from public.wish_reservation_viewers where user_id = (select auth.uid()));
$$;


create or replace function public.admin_list_wish_items(p_list_slug text)
returns table (
  id uuid,
  title text,
  url text,
  price_cents integer,
  sort_order integer,
  is_featured boolean,
  image_url text,
  is_reserved boolean,
  contributed_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_wish_list(p_list_slug) then
    raise exception 'Nicht autorisiert.';
  end if;

  if p_list_slug not in ('janus', 'marlene') then
    raise exception 'Unbekannte Wunschliste.';
  end if;

  return query
  select item.id, item.title, item.url, item.price_cents, item.sort_order,
         item.is_featured, item.image_url, item.reserved_by is not null,
         coalesce(contributions.total_cents, 0)
  from public.wish_items as item
  left join lateral (
    select sum(contribution.amount_cents)::bigint as total_cents
    from public.wish_contributions as contribution
    where contribution.item_id = item.id
  ) as contributions on true
  where item.list_slug = p_list_slug
  order by item.sort_order asc, item.created_at asc;
end;
$$;

create or replace function public.admin_save_wish_item(
  p_item_id uuid,
  p_list_slug text,
  p_title text,
  p_url text,
  p_price_cents integer,
  p_is_featured boolean,
  p_image_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_url text := btrim(coalesce(p_url, ''));
  v_contributed bigint;
begin
  if not public.can_manage_wish_list(p_list_slug) then
    raise exception 'Nicht autorisiert.';
  end if;
  if p_list_slug not in ('janus', 'marlene') then
    raise exception 'Unbekannte Wunschliste.';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 180 then
    raise exception 'Der Titel muss 1 bis 180 Zeichen lang sein.';
  end if;
  if v_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'Bitte einen vollständigen Link mit https:// eingeben.';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'Der Preis darf nicht negativ sein.';
  end if;
  if p_image_url is not null and p_image_url !~* '^https://[^[:space:]]+$' then
    raise exception 'Das Produktbild muss über HTTPS erreichbar sein.';
  end if;

  if p_item_id is not null then
    select item.id into v_id
    from public.wish_items as item
    where item.id = p_item_id and item.list_slug = p_list_slug
    for update;
    if not found then
      raise exception 'Artikel nicht gefunden.';
    end if;

    select coalesce(sum(contribution.amount_cents), 0)::bigint into v_contributed
    from public.wish_contributions as contribution
    where contribution.item_id = p_item_id;
    if p_price_cents::bigint < v_contributed then
      raise exception 'Der Preis darf nicht unter die bereits zugesagten Teilbeträge sinken.';
    end if;
  end if;

  if coalesce(p_is_featured, false) then
    update public.wish_items as item
    set is_featured = false
    where item.list_slug = p_list_slug and item.is_featured and item.id is distinct from p_item_id;
  end if;

  if p_item_id is null then
    insert into public.wish_items (list_slug, title, url, price_cents, sort_order, is_featured, image_url)
    values (
      p_list_slug, v_title, v_url, p_price_cents,
      coalesce((select max(item.sort_order) + 1 from public.wish_items as item where item.list_slug = p_list_slug), 0),
      coalesce(p_is_featured, false), p_image_url
    )
    returning id into v_id;
  else
    update public.wish_items as item
    set title = v_title,
        url = v_url,
        price_cents = p_price_cents,
        is_featured = coalesce(p_is_featured, false),
        image_url = p_image_url
    where item.id = p_item_id and item.list_slug = p_list_slug
    returning item.id into v_id;
    if v_id is null then
      raise exception 'Artikel nicht gefunden.';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_delete_wish_item(p_item_id uuid, p_list_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved_by text;
begin
  if not public.can_manage_wish_list(p_list_slug) then
    raise exception 'Nicht autorisiert.';
  end if;

  select item.reserved_by into v_reserved_by
  from public.wish_items as item
  where item.id = p_item_id and item.list_slug = p_list_slug
  for update;

  if not found then
    raise exception 'Artikel nicht gefunden.';
  end if;
  if v_reserved_by is not null or exists (
    select 1 from public.wish_contributions as contribution where contribution.item_id = p_item_id
  ) then
    raise exception 'Kläre die Reservierung oder Teilbeträge, bevor du diesen Wunsch löschst.';
  end if;

  delete from public.wish_items as item where item.id = p_item_id and item.list_slug = p_list_slug;
end;
$$;

create or replace function public.admin_reset_wish_item(p_item_id uuid, p_list_slug text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_wish_list(p_list_slug) then
    raise exception 'Nicht autorisiert.';
  end if;
  update public.wish_items as item
  set reserved_by = null, reserved_email = null, reserved_at = null
  where item.id = p_item_id and item.list_slug = p_list_slug;
  return found;
end;
$$;

create or replace function public.admin_save_wish_order(p_item_ids uuid[], p_list_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_supplied integer;
begin
  if not public.can_manage_wish_list(p_list_slug) then
    raise exception 'Nicht autorisiert.';
  end if;
  if p_list_slug not in ('janus', 'marlene') then
    raise exception 'Unbekannte Wunschliste.';
  end if;

  lock table public.wish_items in share row exclusive mode;
  v_supplied := coalesce(cardinality(p_item_ids), 0);
  select count(*)::integer into v_total from public.wish_items as item where item.list_slug = p_list_slug;
  if v_supplied <> v_total then
    raise exception 'Die Reihenfolge muss alle Artikel dieser Liste enthalten.';
  end if;
  if (select count(distinct supplied.item_id)::integer from unnest(coalesce(p_item_ids, array[]::uuid[])) as supplied(item_id)) <> v_supplied then
    raise exception 'Die Reihenfolge enthält doppelte Artikel.';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_item_ids, array[]::uuid[])) as supplied(item_id)
    left join public.wish_items as item on item.id = supplied.item_id and item.list_slug = p_list_slug
    where item.id is null
  ) then
    raise exception 'Die Reihenfolge enthält einen unbekannten Artikel.';
  end if;

  update public.wish_items as item
  set sort_order = supplied.position::integer - 1
  from unnest(coalesce(p_item_ids, array[]::uuid[])) with ordinality as supplied(item_id, position)
  where item.id = supplied.item_id and item.list_slug = p_list_slug;
end;
$$;

create or replace function public.admin_list_wish_contributions(p_list_slug text)
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
  if not public.can_manage_wish_list(p_list_slug) then
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

create or replace function public.admin_delete_wish_contribution(p_contribution_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
begin
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
  where item.id = v_item_id and public.can_manage_wish_list(item.list_slug)
  for update;

  if not found then
    return false;
  end if;

  delete from public.wish_contributions as contribution
  where contribution.id = p_contribution_id;
  return found;
end;
$$;

create or replace function public.can_remove_product_image(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bucket = 'product-images'
    and public.can_manage_wish_list(split_part(p_path, '/', 1))
    and not exists (
      select 1 from public.wish_items as item
      where item.image_url like '%/storage/v1/object/public/product-images/%'
        and right(split_part(item.image_url, '?', 1), length('/product-images/' || p_path)) = '/product-images/' || p_path
    );
$$;

revoke all on function public.can_remove_product_image(text, text) from public, anon;
grant execute on function public.can_remove_product_image(text, text) to authenticated;

drop policy if exists wish_admin_upload_product_images on storage.objects;
drop policy if exists wish_admin_update_product_images on storage.objects;
drop policy if exists wish_admin_delete_product_images on storage.objects;
drop policy if exists wish_admin_select_product_images on storage.objects;

create policy wish_admin_select_product_images on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and public.can_manage_wish_list(split_part(name, '/', 1)));
create policy wish_admin_upload_product_images on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.can_manage_wish_list(split_part(name, '/', 1)));
create policy wish_admin_delete_product_images on storage.objects for delete to authenticated
  using (public.can_remove_product_image(bucket_id, name));
