-- Add a second list, partial contributions, product images, and strict
-- separation between list editing and access to giver identities.

alter table public.wish_items
  add column if not exists list_slug text not null default 'janus',
  add column if not exists image_url text;

alter table public.wish_items
  drop constraint if exists wish_items_title_key;

alter table public.wish_items
  add constraint wish_items_list_slug_check
    check (list_slug in ('janus', 'marlene')),
  add constraint wish_items_list_title_key unique (list_slug, title);

create table public.wish_contributions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wish_items (id) on delete cascade,
  contributor_name text not null check (char_length(btrim(contributor_name)) between 1 and 100),
  contributor_email text check (contributor_email is null or char_length(contributor_email) <= 254),
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create index wish_contributions_item_id_idx
  on public.wish_contributions (item_id, created_at);

create table public.wish_reservation_viewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.wish_items enable row level security;
alter table public.wish_contributions enable row level security;
alter table public.wish_admins enable row level security;
alter table public.wish_reservation_viewers enable row level security;

-- Private reservation and contribution columns are never available via a
-- direct table query. Callers use narrowly scoped RPCs below.
drop policy if exists wish_items_admin_all on public.wish_items;
revoke all on table public.wish_items from public, anon, authenticated;
revoke all on table public.wish_contributions from public, anon, authenticated;
revoke all on table public.wish_admins from public, anon, authenticated;
revoke all on table public.wish_reservation_viewers from public, anon, authenticated;

grant select on table public.wish_admins to authenticated;
drop policy if exists wish_admins_select_self on public.wish_admins;
create policy wish_admins_select_self
  on public.wish_admins for select to authenticated
  using (user_id = (select auth.uid()));

grant select on table public.wish_reservation_viewers to authenticated;
create policy wish_reservation_viewers_select_self
  on public.wish_reservation_viewers for select to authenticated
  using (user_id = (select auth.uid()));

-- Remove the old unscoped functions so stale clients cannot keep calling them.
drop function if exists public.get_public_wish_items();
drop function if exists public.admin_list_wish_items();
drop function if exists public.admin_save_wish_item(uuid, text, text, integer, boolean);
drop function if exists public.admin_delete_wish_item(uuid);
drop function if exists public.admin_reset_wish_item(uuid);
drop function if exists public.admin_save_wish_order(uuid[]);

create function public.get_public_wish_items(p_list_slug text default 'janus')
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
  select
    item.id,
    item.title,
    item.url,
    item.price_cents,
    item.sort_order,
    item.is_featured,
    item.reserved_by is not null,
    item.image_url,
    coalesce(contributions.total_cents, 0),
    greatest(item.price_cents::bigint - coalesce(contributions.total_cents, 0), 0)
  from public.wish_items as item
  left join lateral (
    select sum(contribution.amount_cents)::bigint as total_cents
    from public.wish_contributions as contribution
    where contribution.item_id = item.id
  ) as contributions on true
  where item.list_slug = p_list_slug
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
  v_item public.wish_items%rowtype;
  v_contributed bigint;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Bitte einen Namen mit 1 bis 100 Zeichen eingeben.';
  end if;
  if v_email is not null and char_length(v_email) > 254 then
    raise exception 'Die E-Mail-Adresse ist zu lang.';
  end if;

  select item.* into v_item
  from public.wish_items as item
  where item.id = p_item_id
  for update;

  if not found or v_item.reserved_by is not null then
    return false;
  end if;

  select coalesce(sum(contribution.amount_cents), 0)::bigint into v_contributed
  from public.wish_contributions as contribution
  where contribution.item_id = p_item_id;

  if v_contributed > 0 then
    raise exception 'Für diesen Wunsch gibt es bereits Beteiligungen.';
  end if;

  update public.wish_items as item
  set reserved_by = v_name,
      reserved_email = v_email,
      reserved_at = now()
  where item.id = p_item_id;

  return true;
end;
$$;

create function public.contribute_wish_item(
  p_item_id uuid,
  p_name text,
  p_email text,
  p_amount_cents integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_item public.wish_items%rowtype;
  v_contributed bigint;
  v_remaining bigint;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Bitte einen Namen mit 1 bis 100 Zeichen eingeben.';
  end if;
  if v_email is not null and char_length(v_email) > 254 then
    raise exception 'Die E-Mail-Adresse ist zu lang.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Bitte einen Betrag größer als 0,00 € eingeben.';
  end if;

  select item.* into v_item
  from public.wish_items as item
  where item.id = p_item_id
  for update;

  if not found or v_item.reserved_by is not null then
    raise exception 'Dieser Wunsch ist nicht mehr verfügbar.';
  end if;

  select coalesce(sum(contribution.amount_cents), 0)::bigint into v_contributed
  from public.wish_contributions as contribution
  where contribution.item_id = p_item_id;
  v_remaining := greatest(v_item.price_cents::bigint - v_contributed, 0);

  if p_amount_cents::bigint > v_remaining then
    raise exception 'Der Betrag ist höher als der noch offene Teilbetrag.';
  end if;

  insert into public.wish_contributions (item_id, contributor_name, contributor_email, amount_cents)
  values (p_item_id, v_name, v_email, p_amount_cents);

  return v_remaining - p_amount_cents;
end;
$$;

create function public.get_admin_capabilities()
returns table (can_edit boolean, can_view_givers boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())),
    exists (select 1 from public.wish_reservation_viewers as viewer where viewer.user_id = (select auth.uid()));
$$;

create function public.admin_list_wish_items(p_list_slug text)
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
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
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

create function public.admin_save_wish_item(
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
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
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

create function public.admin_delete_wish_item(p_item_id uuid, p_list_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
    raise exception 'Nicht autorisiert.';
  end if;
  delete from public.wish_items as item where item.id = p_item_id and item.list_slug = p_list_slug;
  if not found then
    raise exception 'Artikel nicht gefunden.';
  end if;
end;
$$;

create function public.admin_reset_wish_item(p_item_id uuid, p_list_slug text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
    raise exception 'Nicht autorisiert.';
  end if;
  update public.wish_items as item
  set reserved_by = null, reserved_email = null, reserved_at = null
  where item.id = p_item_id and item.list_slug = p_list_slug;
  return found;
end;
$$;

create function public.admin_save_wish_order(p_item_ids uuid[], p_list_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_supplied integer;
begin
  if not exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid())) then
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

create function public.papa_list_gift_activity()
returns table (
  activity_id uuid,
  item_id uuid,
  list_slug text,
  item_title text,
  activity_kind text,
  giver_name text,
  giver_email text,
  amount_cents integer,
  activity_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wish_reservation_viewers as viewer where viewer.user_id = (select auth.uid())) then
    raise exception 'Nicht autorisiert.';
  end if;

  return query
  select item.id, item.id, item.list_slug, item.title, 'Schenkung'::text,
         item.reserved_by, item.reserved_email, item.price_cents, item.reserved_at
  from public.wish_items as item
  where item.reserved_by is not null
  union all
  select contribution.id, item.id, item.list_slug, item.title, 'Beteiligung'::text,
         contribution.contributor_name, contribution.contributor_email,
         contribution.amount_cents, contribution.created_at
  from public.wish_contributions as contribution
  join public.wish_items as item on item.id = contribution.item_id
  order by 9 desc;
end;
$$;

revoke all on function public.get_public_wish_items(text) from public;
revoke all on function public.reserve_wish_item(uuid, text, text) from public;
revoke all on function public.contribute_wish_item(uuid, text, text, integer) from public;
revoke all on function public.get_admin_capabilities() from public, anon;
revoke all on function public.admin_list_wish_items(text) from public, anon;
revoke all on function public.admin_save_wish_item(uuid, text, text, text, integer, boolean, text) from public, anon;
revoke all on function public.admin_delete_wish_item(uuid, text) from public, anon;
revoke all on function public.admin_reset_wish_item(uuid, text) from public, anon;
revoke all on function public.admin_save_wish_order(uuid[], text) from public, anon;
revoke all on function public.papa_list_gift_activity() from public, anon;

grant execute on function public.get_public_wish_items(text) to anon, authenticated;
grant execute on function public.reserve_wish_item(uuid, text, text) to anon, authenticated;
grant execute on function public.contribute_wish_item(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.get_admin_capabilities() to authenticated;
grant execute on function public.admin_list_wish_items(text) to authenticated;
grant execute on function public.admin_save_wish_item(uuid, text, text, text, integer, boolean, text) to authenticated;
grant execute on function public.admin_delete_wish_item(uuid, text) to authenticated;
grant execute on function public.admin_reset_wish_item(uuid, text) to authenticated;
grant execute on function public.admin_save_wish_order(uuid[], text) to authenticated;
grant execute on function public.papa_list_gift_activity() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists wish_admin_upload_product_images on storage.objects;
drop policy if exists wish_admin_update_product_images on storage.objects;
drop policy if exists wish_admin_delete_product_images on storage.objects;

create policy wish_admin_upload_product_images
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid()))
  );

create policy wish_admin_update_product_images
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid()))
  );

create policy wish_admin_delete_product_images
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.wish_admins as admin where admin.user_id = (select auth.uid()))
  );

-- To grant the private viewer role after Papa's Supabase account exists, run
-- this in the Supabase SQL editor after replacing the email with his address:
-- insert into public.wish_reservation_viewers (user_id)
-- select id from auth.users where lower(email) = lower('PAPA_EMAIL_HERE')
-- on conflict (user_id) do nothing;
