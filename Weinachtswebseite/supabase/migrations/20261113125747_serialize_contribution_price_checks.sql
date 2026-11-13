-- Serialize price edits with the contribution/reservation routines so the
-- accepted contribution total cannot race past a newly lowered item price.
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
