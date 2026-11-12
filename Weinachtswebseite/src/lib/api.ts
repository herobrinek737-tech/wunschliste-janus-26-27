import { requireSupabase } from './supabase'
import type { AdminWishItem, PublicWishItem } from './types'

export async function getPublicItems() {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_public_wish_items')
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

export async function getAdminItems() {
  const client = requireSupabase()
  const { data, error } = await client.rpc('admin_list_wish_items')
  if (error) throw error
  return (data ?? []) as AdminWishItem[]
}

export async function saveItem(item: {
  id: string | null
  title: string
  url: string
  price_cents: number
  is_featured: boolean
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('admin_save_wish_item', {
    p_item_id: item.id,
    p_title: item.title,
    p_url: item.url,
    p_price_cents: item.price_cents,
    p_is_featured: item.is_featured,
  })
  if (error) throw error
  return data as string
}

export async function deleteItem(itemId: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('admin_delete_wish_item', { p_item_id: itemId })
  if (error) throw error
}

export async function resetItem(itemId: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('admin_reset_wish_item', { p_item_id: itemId })
  if (error) throw error
  return data as boolean
}

export async function saveOrder(itemIds: string[]) {
  const client = requireSupabase()
  const { error } = await client.rpc('admin_save_wish_order', { p_item_ids: itemIds })
  if (error) throw error
}
