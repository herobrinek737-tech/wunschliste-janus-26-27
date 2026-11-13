import { requireSupabase } from './supabase'
import type { AdminCapabilities, AdminWishItem, GiftActivity, PublicWishItem, WishListSlug } from './types'

export async function getPublicItems(listSlug: WishListSlug) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_public_wish_items', { p_list_slug: listSlug })
  if (error) throw error
  return (data ?? []) as PublicWishItem[]
}

export async function reserveItem(itemId: string, name: string, email: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('reserve_wish_item', {
    p_item_id: itemId,
    p_name: name,
    p_email: email || null,
  })
  if (error) throw error
  return data as boolean
}

export async function contributeItem(itemId: string, name: string, email: string, amountCents: number) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('contribute_wish_item', {
    p_item_id: itemId,
    p_name: name,
    p_email: email || null,
    p_amount_cents: amountCents,
  })
  if (error) throw error
  return data as number
}

export async function getAdminCapabilities() {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_admin_capabilities')
  if (error) throw error
  return ((data ?? [])[0] ?? { can_edit: false, can_view_givers: false }) as AdminCapabilities
}

export async function getAdminItems(listSlug: WishListSlug) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('admin_list_wish_items', { p_list_slug: listSlug })
  if (error) throw error
  return (data ?? []) as AdminWishItem[]
}

export async function getGiftActivity() {
  const client = requireSupabase()
  const { data, error } = await client.rpc('papa_list_gift_activity')
  if (error) throw error
  return (data ?? []) as GiftActivity[]
}

export async function saveItem(item: {
  id: string | null
  title: string
  url: string
  price_cents: number
  is_featured: boolean
  image_url: string | null
  list_slug: WishListSlug
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('admin_save_wish_item', {
    p_item_id: item.id,
    p_list_slug: item.list_slug,
    p_title: item.title,
    p_url: item.url,
    p_price_cents: item.price_cents,
    p_is_featured: item.is_featured,
    p_image_url: item.image_url,
  })
  if (error) throw error
  return data as string
}

export async function deleteItem(itemId: string, listSlug: WishListSlug) {
  const client = requireSupabase()
  const { error } = await client.rpc('admin_delete_wish_item', { p_item_id: itemId, p_list_slug: listSlug })
  if (error) throw error
}

export async function resetItem(itemId: string, listSlug: WishListSlug) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('admin_reset_wish_item', { p_item_id: itemId, p_list_slug: listSlug })
  if (error) throw error
  return data as boolean
}

export async function saveOrder(itemIds: string[], listSlug: WishListSlug) {
  const client = requireSupabase()
  const { error } = await client.rpc('admin_save_wish_order', { p_item_ids: itemIds, p_list_slug: listSlug })
  if (error) throw error
}

export async function uploadProductImage(file: File, listSlug: WishListSlug) {
  const client = requireSupabase()
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'img'
  const path = `${listSlug}/${crypto.randomUUID()}.${extension}`
  const { error } = await client.storage.from('product-images').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error
  return client.storage.from('product-images').getPublicUrl(path).data.publicUrl
}
