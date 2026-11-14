export type WishListSlug = 'janus' | 'marlene'

export type PublicWishItem = {
  id: string
  title: string
  url: string
  price_cents: number
  sort_order: number
  is_featured: boolean
  is_reserved: boolean
  image_url: string | null
  contributed_cents: number
  remaining_cents: number
}

export type AdminWishItem = {
  id: string
  title: string
  url: string
  price_cents: number
  sort_order: number
  is_featured: boolean
  image_url: string | null
  is_reserved: boolean
  contributed_cents: number
}

export type GiftActivity = {
  activity_id: string
  item_id: string
  list_slug: WishListSlug
  item_title: string
  activity_kind: 'Schenkung' | 'Beteiligung'
  giver_name: string
  giver_email: string | null
  amount_cents: number
  activity_at: string
}

export type AdminContribution = {
  activity_id: string
  item_id: string
  list_slug: WishListSlug
  item_title: string
  amount_cents: number
}

export type AdminCapabilities = {
  can_edit: boolean
  can_view_givers: boolean
  editableLists: WishListSlug[]
}
