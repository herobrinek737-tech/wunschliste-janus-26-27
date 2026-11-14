import type { CSSProperties } from 'react'
import { getProductImage, getWishIllustration } from '../lib/product-images'
import { seasons, wishlistTitle } from '../lib/seasons'
import type { Season } from '../lib/seasons'
import type { PublicWishItem, WishListSlug } from '../lib/types'

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

export default function WishlistPrint({ items, list, season, shopUrl }: {
  items: PublicWishItem[]
  list: WishListSlug
  season: Season
  shopUrl: (item: PublicWishItem, list: WishListSlug) => string
}) {
  const theme = seasons[season]
  const palette = { '--print-ink': theme.ink, '--print-accent': theme.accent, '--print-paper': theme.paper } as CSSProperties
  return (
    <section className="wishlist-print" style={palette}>
      <header className="wishlist-print-header">
        <span>{theme.label} · {items.length} {items.length === 1 ? 'Wunsch' : 'Wünsche'}</span>
        <h1>{wishlistTitle(season, list)}</h1>
        <div aria-hidden="true">{theme.symbol}</div>
      </header>
      {items.length === 0 && <p>Diese Wunschliste ist noch leer.</p>}
      <ol className="wishlist-print-products">
        {items.map((item) => {
          const url = shopUrl(item, list)
          const illustration = list === 'marlene' ? getWishIllustration(item.id) : undefined
          const image = item.image_url || getProductImage(url, list) || illustration
          const status = item.is_reserved ? 'Reserviert'
            : item.price_cents > 0 && item.remaining_cents === 0 ? 'Zielbetrag zugesagt'
            : item.contributed_cents > 0 ? `Noch ${euro.format(item.remaining_cents / 100)} offen`
            : ''
          return (
            <li key={item.id} className="wishlist-print-item">
              <figure>
                {image && <img src={image} alt="" onError={(event) => { event.currentTarget.hidden = true }} />}
                {image && image === illustration && <figcaption>Beispielbild</figcaption>}
              </figure>
              <div>
                {item.is_featured && <span className="wishlist-print-featured">Hauptwunsch</span>}
                <h2>{item.title}</h2>
                <p>{item.price_cents > 0 ? `Ca. ${euro.format(item.price_cents / 100)}` : 'Preis offen'}{status && ` · ${status}`}</p>
                {item.note && <p className="product-note">{item.note}</p>}
                {url && <a href={url}>Zum Angebot ↗</a>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
