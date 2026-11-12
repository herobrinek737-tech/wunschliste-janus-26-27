export type PublicWishItem = {
  id: string
  title: string
  url: string
  price_cents: number
  sort_order: number
  is_featured: boolean
  is_reserved: boolean
}

export type AdminWishItem = {
  id: string
  title: string
  url: string
  price_cents: number
  sort_order: number
  is_featured: boolean
  reserved_by: string | null
  reserved_email: string | null
  reserved_at: string | null
}
