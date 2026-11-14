alter table public.wish_items
  add column note text check (char_length(note) <= 600);

create table public.wish_list_settings (
  list_slug text primary key check (list_slug in ('janus', 'marlene')),
  season text not null check (season in ('winter', 'spring', 'summer', 'autumn'))
);
insert into public.wish_list_settings values ('janus', 'winter'), ('marlene', 'winter');
alter table public.wish_list_settings enable row level security;
revoke all on public.wish_list_settings from public, anon, authenticated;
grant select on public.wish_list_settings to anon, authenticated;
grant update (season) on public.wish_list_settings to authenticated;
create policy public_read_wish_list_settings on public.wish_list_settings
  for select to anon, authenticated using (true);
create policy admin_update_wish_list_settings on public.wish_list_settings
  for update to authenticated
  using (public.can_manage_wish_list(list_slug))
  with check (public.can_manage_wish_list(list_slug));

-- Carry annotations in versioned projections while keeping older clients working.
create schema if not exists wishlist_private;
revoke all on schema wishlist_private from public;
grant usage on schema wishlist_private to anon, authenticated;

create function wishlist_private.wish_item_notes(p_list_slug text)
returns table (item_id uuid, note text)
language sql stable security definer set search_path = ''
as $$
  select item.id, item.note from public.wish_items as item
  where item.list_slug = p_list_slug and item.note is not null;
$$;
revoke all on function wishlist_private.wish_item_notes(text) from public;
grant execute on function wishlist_private.wish_item_notes(text) to anon, authenticated;

create function public.get_public_wish_items_with_notes(p_list_slug text)
returns setof jsonb
language sql stable security invoker set search_path = ''
as $$
  select (to_jsonb(item) - 'ordinality') || jsonb_build_object('note', notes.note)
  from public.get_public_wish_items(p_list_slug) with ordinality as item
  left join wishlist_private.wish_item_notes(p_list_slug) as notes on notes.item_id = item.id
  order by item.ordinality;
$$;
revoke all on function public.get_public_wish_items_with_notes(text) from public;
grant execute on function public.get_public_wish_items_with_notes(text) to anon, authenticated;

create function public.admin_list_wish_items_with_notes(p_list_slug text)
returns setof jsonb
language sql stable security invoker set search_path = ''
as $$
  select (to_jsonb(item) - 'ordinality') || jsonb_build_object('note', notes.note)
  from public.admin_list_wish_items(p_list_slug) with ordinality as item
  left join wishlist_private.wish_item_notes(p_list_slug) as notes on notes.item_id = item.id
  order by item.ordinality;
$$;
revoke all on function public.admin_list_wish_items_with_notes(text) from public, anon;
grant execute on function public.admin_list_wish_items_with_notes(text) to authenticated;

create function wishlist_private.save_wish_item_with_note(
  p_item_id uuid, p_list_slug text, p_title text, p_url text,
  p_price_cents integer, p_is_featured boolean, p_image_url text, p_note text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.can_manage_wish_list(p_list_slug) then
    raise exception 'Nicht autorisiert.';
  end if;
  v_id := public.admin_save_wish_item(
    p_item_id, p_list_slug, p_title, p_url, p_price_cents, p_is_featured, p_image_url
  );
  update public.wish_items set note = nullif(btrim(p_note), '') where id = v_id;
  return v_id;
end;
$$;
revoke all on function wishlist_private.save_wish_item_with_note(uuid, text, text, text, integer, boolean, text, text) from public;
grant execute on function wishlist_private.save_wish_item_with_note(uuid, text, text, text, integer, boolean, text, text) to authenticated;

create function public.admin_save_wish_item_with_note(
  p_item_id uuid, p_list_slug text, p_title text, p_url text,
  p_price_cents integer, p_is_featured boolean, p_image_url text, p_note text
)
returns uuid
language sql security invoker set search_path = ''
as $$
  select wishlist_private.save_wish_item_with_note(
    p_item_id, p_list_slug, p_title, p_url, p_price_cents, p_is_featured, p_image_url, p_note
  );
$$;
revoke all on function public.admin_save_wish_item_with_note(uuid, text, text, text, integer, boolean, text, text) from public, anon;
grant execute on function public.admin_save_wish_item_with_note(uuid, text, text, text, integer, boolean, text, text) to authenticated;

create table public.wish_bulk_delete_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  list_slug text not null check (list_slug in ('janus', 'marlene')),
  code_hash text not null,
  sent_at timestamptz not null,
  attempts integer not null default 0,
  consumed boolean not null default false
);
alter table public.wish_bulk_delete_challenges enable row level security;
revoke all on public.wish_bulk_delete_challenges from public, anon, authenticated;
grant select, insert, update on public.wish_bulk_delete_challenges to service_role;
grant select, delete on public.wish_items to service_role;
grant select on public.wish_contributions to service_role;

create function public.start_wish_bulk_delete(
  p_user_id uuid, p_session_id uuid, p_list_slug text, p_code_hash text
)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.wish_bulk_delete_challenges (user_id, session_id, list_slug, code_hash, sent_at)
  values (p_user_id, p_session_id, p_list_slug, p_code_hash, statement_timestamp())
  on conflict (user_id) do update
    set session_id = excluded.session_id, list_slug = excluded.list_slug, code_hash = excluded.code_hash,
        sent_at = excluded.sent_at, attempts = 0, consumed = false
    where wish_bulk_delete_challenges.sent_at <= excluded.sent_at - interval '60 seconds';
  return found;
end;
$$;

create function public.finish_wish_bulk_delete(
  p_user_id uuid, p_session_id uuid, p_list_slug text, p_code_hash text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_challenge public.wish_bulk_delete_challenges;
  v_count integer;
begin
  select * into v_challenge from public.wish_bulk_delete_challenges
  where user_id = p_user_id and session_id = p_session_id and list_slug = p_list_slug for update;

  if not found or v_challenge.consumed or v_challenge.attempts >= 5
    or v_challenge.sent_at <= statement_timestamp() - interval '10 minutes' then
    return jsonb_build_object('status', 'expired');
  end if;

  if v_challenge.code_hash is distinct from p_code_hash then
    update public.wish_bulk_delete_challenges set attempts = attempts + 1 where user_id = p_user_id;
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.wish_bulk_delete_challenges set consumed = true where user_id = p_user_id;

  -- Serialize with new products, reservations and contribution changes.
  lock table public.wish_items in exclusive mode;
  if exists (
    select 1 from public.wish_items as item
    where item.list_slug = p_list_slug and (
      item.reserved_by is not null or exists (
        select 1 from public.wish_contributions as contribution where contribution.item_id = item.id
      )
    )
  ) then
    return jsonb_build_object('status', 'protected');
  end if;

  delete from public.wish_items where list_slug = p_list_slug;
  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'deleted', 'count', v_count);
end;
$$;

revoke all on function public.start_wish_bulk_delete(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_wish_bulk_delete(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_wish_bulk_delete(uuid, uuid, text, text) to service_role;
grant execute on function public.finish_wish_bulk_delete(uuid, uuid, text, text) to service_role;
