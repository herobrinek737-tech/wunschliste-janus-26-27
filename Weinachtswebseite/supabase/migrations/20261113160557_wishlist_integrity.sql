-- Correct the shipped catalog without changing custom titles or links.
update public.wish_items
set url = 'https://www.amazon.de/dp/B09XWVVWMS'
where list_slug = 'janus'
  and url in ('https://bit.ly/4djEGP', 'https://bit.ly/4djEjGP');

update public.wish_items
set url = 'https://www.amazon.de/dp/B0FVWW7MD4'
where list_slug = 'janus' and url = 'https://bit.ly/4rJ3nNa';

update public.wish_items as item
set title = corrections.new_title
from (values
  ('Monster Energy Ultra White Zero Sugar, 12x 500ml', 'Monster Energy Ultra White Zero Sugar, 12 × 500 ml'),
  ('5er Pack USB 3.0 Sticks 64GB', 'USB-3.0-Sticks, 64 GB, 5er-Pack'),
  ('ELEGOO ESP-32 Starter Kit', 'ELEGOO ESP32 Starter Kit'),
  ('Inui Pocket Pro Powerbank 20.000mAh', 'INIU Pocket Pro Powerbank, 20.000 mAh'),
  ('Grefay Fahrrad Handyhalterung', 'Grefay Fahrrad-Handyhalterung')
) as corrections(old_title, new_title)
where item.list_slug = 'janus' and item.title = corrections.old_title
  and not exists (
    select 1 from public.wish_items as other
    where other.list_slug = item.list_slug and other.title = corrections.new_title
  );

-- Keep legacy invalid rows available to admins for correction.
alter table public.wish_items add constraint wish_items_public_shop_url_check
  check (url ~* '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$')
  not valid;

-- An invalid existing shop URL is hidden from the public list.
create or replace function public.get_public_wish_items(p_list_slug text default 'janus')
returns table (
  id uuid,
  title text,
  url text,
  price_cents integer,
  sort_order integer,
  is_featured boolean,
  is_reserved boolean,
  image_url text,
  contributed_cents bigint,
  remaining_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select item.id, item.title, item.url, item.price_cents, item.sort_order, item.is_featured,
         item.reserved_by is not null, item.image_url, coalesce(contributions.total_cents, 0),
         greatest(item.price_cents::bigint - coalesce(contributions.total_cents, 0), 0)
  from public.wish_items as item
  left join lateral (
    select sum(contribution.amount_cents)::bigint as total_cents
    from public.wish_contributions as contribution
    where contribution.item_id = item.id
  ) as contributions on true
  where item.list_slug = p_list_slug
    and item.url ~* '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$'
  order by item.sort_order, item.created_at;
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
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
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

-- Only admins may remove uploads that no wish still references.
create function public.can_remove_product_image(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bucket = 'product-images'
    and exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid()))
    and not exists (
      select 1 from public.wish_items as item
      where item.image_url like '%/storage/v1/object/public/product-images/%'
        and right(split_part(item.image_url, '?', 1), length('/product-images/' || p_path)) = '/product-images/' || p_path
    );
$$;

revoke all on function public.can_remove_product_image(text, text) from public, anon;
grant execute on function public.can_remove_product_image(text, text) to authenticated;

drop policy if exists wish_admin_delete_product_images on storage.objects;
create policy wish_admin_delete_product_images
  on storage.objects for delete to authenticated
  using (public.can_remove_product_image(bucket_id, name));

create policy wish_admin_select_product_images
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid()))
  );
