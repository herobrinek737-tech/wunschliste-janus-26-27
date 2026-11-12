create table if not exists public.wish_items (
  id uuid primary key default gen_random_uuid(),
  title text not null unique check (char_length(btrim(title)) between 1 and 180),
  url text not null check (url ~* '^https?://[^[:space:]]+$'),
  price_cents integer not null default 0 check (price_cents >= 0),
  sort_order integer not null default 0,
  is_featured boolean not null default false,
  reserved_by text,
  reserved_email text,
  reserved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wish_items_reservation_fields_check check (
    (reserved_by is null and reserved_at is null)
    or (reserved_by is not null and reserved_at is not null)
  )
);

create index if not exists wish_items_sort_order_idx
  on public.wish_items (sort_order, created_at);

create table if not exists public.wish_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.wish_items enable row level security;
alter table public.wish_admins enable row level security;

grant usage on schema public to anon, authenticated;
revoke all on table public.wish_items from public, anon, authenticated;
revoke all on table public.wish_admins from public, anon, authenticated;

create or replace function public.get_public_wish_items()
returns table (
  id uuid,
  title text,
  url text,
  price_cents integer,
  sort_order integer,
  is_featured boolean,
  is_reserved boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    item.id,
    item.title,
    item.url,
    item.price_cents,
    item.sort_order,
    item.is_featured,
    item.reserved_by is not null
  from public.wish_items as item
  order by item.sort_order asc, item.created_at asc;
$$;

create or replace function public.reserve_wish_item(
  p_item_id uuid,
  p_name text,
  p_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Bitte einen Namen mit 1 bis 100 Zeichen eingeben.';
  end if;

  if v_email is not null and char_length(v_email) > 254 then
    raise exception 'Die E-Mail-Adresse ist zu lang.';
  end if;

  update public.wish_items as item
  set reserved_by = v_name,
      reserved_email = v_email,
      reserved_at = now()
  where item.id = p_item_id
    and item.reserved_by is null;

  return found;
end;
$$;

create or replace function public.admin_list_wish_items()
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
  if not exists (
    select 1
    from public.wish_admins as admin
    where admin.user_id = (select auth.uid())
  ) then
    raise exception 'Nicht autorisiert.';
  end if;

  return query
  select
    item.id,
    item.title,
    item.url,
    item.price_cents,
    item.sort_order,
    item.is_featured,
    item.reserved_by,
    item.reserved_email,
    item.reserved_at
  from public.wish_items as item
  order by item.sort_order asc, item.created_at asc;
end;
$$;

create or replace function public.admin_save_wish_item(
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
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_url text := btrim(coalesce(p_url, ''));
begin
  if not exists (
    select 1 from public.wish_admins as admin
    where admin.user_id = (select auth.uid())
  ) then
    raise exception 'Nicht autorisiert.';
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

  if coalesce(p_is_featured, false) then
    update public.wish_items as item
    set is_featured = false
    where item.is_featured and item.id is distinct from p_item_id;
  end if;

  if p_item_id is null then
    insert into public.wish_items (title, url, price_cents, sort_order, is_featured)
    values (
      v_title,
      v_url,
      p_price_cents,
      coalesce((select max(item.sort_order) + 1 from public.wish_items as item), 0),
      coalesce(p_is_featured, false)
    )
    returning id into v_id;
  else
    update public.wish_items as item
    set title = v_title,
        url = v_url,
        price_cents = p_price_cents,
        is_featured = coalesce(p_is_featured, false)
    where item.id = p_item_id
    returning item.id into v_id;

    if v_id is null then
      raise exception 'Artikel nicht gefunden.';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_delete_wish_item(p_item_id uuid)
returns void
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

  delete from public.wish_items where id = p_item_id;
  if not found then
    raise exception 'Artikel nicht gefunden.';
  end if;
end;
$$;

create or replace function public.admin_reset_wish_item(p_item_id uuid)
returns boolean
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

  update public.wish_items as item
  set reserved_by = null,
      reserved_email = null,
      reserved_at = null
  where item.id = p_item_id;

  return found;
end;
$$;

create or replace function public.admin_save_wish_order(p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_supplied integer;
begin
  if not exists (
    select 1 from public.wish_admins as admin
    where admin.user_id = (select auth.uid())
  ) then
    raise exception 'Nicht autorisiert.';
  end if;

  lock table public.wish_items in share row exclusive mode;
  v_supplied := coalesce(cardinality(p_item_ids), 0);
  select count(*)::integer into v_total from public.wish_items;

  if v_supplied <> v_total then
    raise exception 'Die Reihenfolge muss alle Artikel enthalten.';
  end if;

  if (
    select count(distinct supplied.item_id)::integer
    from unnest(coalesce(p_item_ids, array[]::uuid[])) as supplied(item_id)
  ) <> v_supplied then
    raise exception 'Die Reihenfolge enthält doppelte Artikel.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_item_ids, array[]::uuid[])) as supplied(item_id)
    left join public.wish_items as item on item.id = supplied.item_id
    where item.id is null
  ) then
    raise exception 'Die Reihenfolge enthält einen unbekannten Artikel.';
  end if;

  update public.wish_items as item
  set sort_order = supplied.position::integer - 1
  from unnest(coalesce(p_item_ids, array[]::uuid[]))
       with ordinality as supplied(item_id, position)
  where item.id = supplied.item_id;
end;
$$;

revoke all on function public.get_public_wish_items() from public;
revoke all on function public.reserve_wish_item(uuid, text, text) from public;
revoke all on function public.admin_list_wish_items() from public, anon;
revoke all on function public.admin_save_wish_item(uuid, text, text, integer, boolean) from public, anon;
revoke all on function public.admin_delete_wish_item(uuid) from public, anon;
revoke all on function public.admin_reset_wish_item(uuid) from public, anon;
revoke all on function public.admin_save_wish_order(uuid[]) from public, anon;

grant execute on function public.get_public_wish_items() to anon, authenticated;
grant execute on function public.reserve_wish_item(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_list_wish_items() to authenticated;
grant execute on function public.admin_save_wish_item(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.admin_delete_wish_item(uuid) to authenticated;
grant execute on function public.admin_reset_wish_item(uuid) to authenticated;
grant execute on function public.admin_save_wish_order(uuid[]) to authenticated;

insert into public.wish_items (title, url, price_cents, sort_order, is_featured)
values
  ('INZONE H9 II schwarz', 'https://www.sony.de/gaming-gear/products/inzone-h9-ii', 29999, 0, true),
  ('Xiaomi Watch 2', 'https://www.mi.com/de/product/xiaomi-watch-2/', 12999, 1, false),
  ('Monster Energy Ultra White Zero Sugar, 12x 500ml', 'https://www.steam-time.de/monster-ultra-white-zero-sugar-energy-drink-12x-500ml', 2399, 2, false),
  ('Govee Starlight Projector mit Nebula-Effekt', 'https://eu.govee.com/de-de/products/govee-star-light-projector-nebula', 14999, 3, false),
  ('5er Pack USB 3.0 Sticks 64GB', 'https://bit.ly/4djEGP', 2499, 4, false),
  ('ELEGOO ESP-32 Starter Kit', 'https://bit.ly/4rJ3nNa', 2999, 5, false),
  ('Minecraft Dungeons 2', 'https://www.minecraft.net/de-de/store/minecraft-dungeons-ii', 3999, 6, false),
  ('LEGO Game Boy - 72046', 'https://steinehelden.de/Game-Boy-72046/72046', 5999, 7, false),
  ('Steam Controller 2', 'https://store.steampowered.com/hardware/steamcontroller2', 9999, 8, false),
  ('Holy Sirup Starter Set mit Cola, Mango und Peach', 'https://de.holy.com', 2999, 9, false),
  ('Inui Pocket Pro Powerbank 20.000mAh', 'https://www.amazon.de/dp/B0DCYR5VNR', 3999, 10, false),
  ('Very Cool X Minecraft Elytra Necklace', 'https://shirtz.cool/products/the-elytra-pendant', 3299, 11, false),
  ('Grefay Fahrrad Handyhalterung', 'https://www.amazon.de/s?k=Grefay+Fahrrad+Handyhalterung', 1999, 12, false),
  ('WMF Kult X Go Mixer', 'https://www.amazon.de/s?k=WMF+Kult+X+Go+Mixer', 2499, 13, false)
on conflict (title) do nothing;
