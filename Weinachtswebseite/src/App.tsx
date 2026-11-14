import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FormEvent } from 'react'
import Modal from './components/Modal'
import { contributeItem, getPublicItems, reserveItem } from './lib/api'
import { demoWishItems } from './lib/demo-items'
import { getProductImage } from './lib/product-images'
import { isSupabaseConfigured } from './lib/supabase'
import { errorMessage, euroToCents, isPublicShopUrl } from './lib/input'
import type { PublicWishItem, WishListSlug } from './lib/types'

const AdminDashboard = lazy(() => import('./components/AdminDashboard'))
const lists = ['janus', 'marlene'] as const
const accents = ['green', 'blue', 'silver', 'violet', 'amber', 'teal', 'red', 'brick', 'charcoal', 'orange', 'midnight', 'mint', 'slate', 'berry']
const symbols = ['✦', '◷', '◉', '✺', '⌁', '▧', '✧', '▦', '◈', '✿', '↗', '✶', '⌖', '◌']
const snowflakes = Array.from({ length: 28 }, (_, index) => ({
  left: `${(index * 37 + 9) % 100}%`,
  delay: `${-((index * 7) % 29)}s`,
  duration: `${18 + ((index * 11) % 17)}s`,
  size: `${9 + ((index * 5) % 11)}px`,
  drift: `${((index * 29) % 120) - 60}px`,
  opacity: 0.2 + ((index * 17) % 45) / 100,
}))

const forestTrees = [
  { left: -3, width: 86, height: 215, shade: 'tree-pale' },
  { left: 4, width: 116, height: 300, shade: 'tree-blue' },
  { left: 13, width: 73, height: 182, shade: 'tree-slate' },
  { left: 20, width: 52, height: 132, shade: 'tree-pale' },
  { left: 79, width: 55, height: 138, shade: 'tree-pale' },
  { left: 84, width: 83, height: 204, shade: 'tree-blue' },
  { left: 91, width: 116, height: 300, shade: 'tree-slate' },
  { left: 98, width: 87, height: 220, shade: 'tree-pale' },
]

const configuredAddress = import.meta.env.VITE_PAPA_PAYPAL_ADDRESS?.trim() ?? ''
const paypalAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredAddress) ? configuredAddress : ''
const paypalCheckoutUrl = import.meta.env.VITE_PAPA_PAYPAL_CHECKOUT_URL?.trim() || ''
const paypalSendUrl = 'https://www.paypal.com/de/digital-wallet/send-receive-money/send-money'
const cartStorageKey = 'wishlist-cart-by-list-v1'
type CartEntry = { kind: 'wish' } | { kind: 'contribution' | 'reservation'; amountCents: number }
type CartByList = Record<WishListSlug, Record<string, CartEntry>>
type CartLine = { item: PublicWishItem; listSlug: WishListSlug; amountCents: number; kind: CartEntry['kind'] }
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

function price(cents: number) {
  return euro.format(cents / 100)
}

function isAdminLocation() {
  const authParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return window.location.hash === '#/admin'
    || new URLSearchParams(window.location.search).get('admin') === 'setup'
    || authParams.has('access_token')
    || authParams.has('error_code')
    || new URLSearchParams(window.location.search).has('code')
}

function getListSlug(): WishListSlug {
  return new URLSearchParams(window.location.search).get('list') === 'marlene' ? 'marlene' : 'janus'
}

function getListHref(listSlug: WishListSlug) {
  const url = new URL(window.location.href)
  if (listSlug === 'marlene') url.searchParams.set('list', 'marlene')
  else url.searchParams.delete('list')
  url.hash = ''
  return `${url.pathname}${url.search}`
}

function readCartEntries(value: unknown): Record<string, CartEntry> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.filter((id): id is string => typeof id === 'string').map((id) => [id, { kind: 'wish' }]))
  }
  if (value && typeof value === 'object') {
    const entries: Array<[string, CartEntry]> = []
    for (const [id, entry] of Object.entries(value)) {
      if (entry === 0) {
        entries.push([id, { kind: 'wish' }])
      } else if (typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0) {
        entries.push([id, { kind: 'contribution', amountCents: entry }])
      } else if (typeof entry === 'object' && entry !== null) {
        if (entry.kind === 'wish') entries.push([id, { kind: 'wish' }])
        if (
          (entry.kind === 'contribution' || entry.kind === 'reservation')
          && Number.isSafeInteger(entry.amountCents) && entry.amountCents >= 0
          && (entry.kind === 'reservation' || entry.amountCents > 0)
        ) entries.push([id, { kind: entry.kind, amountCents: entry.amountCents }])
      }
    }
    return Object.fromEntries(entries)
  }
  return {}
}

function readCartByList(): CartByList {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cartStorageKey) || '{}') as Record<string, unknown>
    return {
      janus: readCartEntries(parsed.janus),
      marlene: readCartEntries(parsed.marlene),
    }
  } catch {
    return { janus: {}, marlene: {} }
  }
}

function cartLine(item: PublicWishItem, entry: CartEntry | undefined, listSlug: WishListSlug): CartLine | null {
  if (!entry || !isPublicShopUrl(item.url)) return null
  if (entry.kind === 'reservation') {
    return item.is_reserved ? { item, listSlug, kind: entry.kind, amountCents: item.price_cents } : null
  }
  if (item.is_reserved) return null
  if (entry.kind === 'contribution') {
    return item.contributed_cents >= entry.amountCents ? { item, listSlug, ...entry } : null
  }
  return item.remaining_cents > 0 || item.price_cents === 0
    ? { item, listSlug, amountCents: item.remaining_cents, kind: 'wish' }
    : null
}

function getPayPalCheckoutHref(baseUrl: string, amountCents: number) {
  try {
    const url = new URL(baseUrl)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['paypal.com', 'paypal.me'].includes(hostname)) return ''

    const segments = url.pathname.split('/').filter(Boolean)
    const amount = `${(amountCents / 100).toFixed(2)}EUR`
    const validHandle = (handle: string) => /^[A-Za-z0-9]+$/.test(handle)
    if (hostname === 'paypal.me') {
      if (!validHandle(segments[0] ?? '')) return ''
      url.pathname = `/${segments[0]}/${amount}`
    } else if (segments[0]?.toLowerCase() === 'paypalme') {
      if (!validHandle(segments[1] ?? '')) return ''
      url.pathname = `/paypalme/${segments[1]}/${amount}`
    } else if (!segments.length) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function getWishlistShopUrl(item: PublicWishItem, list: WishListSlug) {
  if (!isPublicShopUrl(item.url)) return ''

  const url = new URL(item.url)
  if (url.hostname === 'www.google.com' && url.pathname === '/aclk') return ''

  if (list === 'marlene' && (
    (item.id === 'b938c387-e0ed-46ff-9420-a7d426f2b1be' && /\/dp\/B0DG4Y9R97\/?$/i.test(url.pathname)) ||
    (item.id === '093fc1cc-1d61-4fe9-b329-077ea3934698' && /\/dp\/B0DRYWT1WM\/?$/i.test(url.pathname))
  )) return ''

  return item.url
}

function ProductArtwork({ item, index, list, shopUrl }: { item: PublicWishItem; index: number; list: WishListSlug; shopUrl: string }) {
  const [failedImages, setFailedImages] = useState<string[]>([])
  const image = [item.image_url, getProductImage(shopUrl, list)].find((src) => src && !failedImages.includes(src))

  return (
    <div className={'product-art product-art-' + accents[index % accents.length]}>
      <span className="art-orbit orbit-a" /><span className="art-orbit orbit-b" />
      {image ? (
        <img className="product-image" src={image} alt="" loading={index === 0 ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedImages((failed) => [...failed, image])} />
      ) : (
        <span className="product-symbol" aria-hidden="true">{symbols[index % symbols.length]}</span>
      )}
      <span className="product-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      {item.is_featured && <span className="main-wish">HAUPTWUNSCH</span>}
      {item.is_reserved && <span className="reserved-overlay" aria-hidden="true"><span>✓</span> Reserviert</span>}
      {!item.is_reserved && item.price_cents > 0 && item.remaining_cents === 0 && <span className="reserved-overlay" aria-hidden="true"><span>✓</span> Zielbetrag zugesagt</span>}
    </div>
  )
}

function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(isAdminLocation)
  const [listSlug, setListSlug] = useState<WishListSlug>(getListSlug)
  const [itemsByList, setItemsByList] = useState<Record<WishListSlug, PublicWishItem[]>>(() => ({ janus: isSupabaseConfigured ? [] : demoWishItems, marlene: [] }))
  const items = itemsByList[listSlug].filter((item) => isPublicShopUrl(item.url))
  const [cartByList, setCartByList] = useState<CartByList>(readCartByList)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartLoading, setCartLoading] = useState(true)
  const [cartError, setCartError] = useState('')
  const [cartChanged, setCartChanged] = useState(false)
  const [cartPriceChanged, setCartPriceChanged] = useState(false)
  const [offlinePayment, setOfflinePayment] = useState(false)
  const [cartPaymentNote, setCartPaymentNote] = useState('')
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PublicWishItem | null>(null)
  const [selectedListSlug, setSelectedListSlug] = useState<WishListSlug>('janus')
  const [selectedAction, setSelectedAction] = useState<'reserve' | 'contribute'>('reserve')
  const [returnToCart, setReturnToCart] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const cartRequest = useRef(0)
  const listRequest = useRef(0)
  const [snow, setSnow] = useState(() => {
    try { return localStorage.getItem('wishlist-snow') !== 'off' } catch { return true }
  })
  const cartItems = lists.flatMap((slug) =>
    itemsByList[slug].flatMap((item) => {
      const line = cartLine(item, cartByList[slug][item.id], slug)
      return line ? [line] : []
    }),
  )
  const cartCount = cartItems.length
  const cartTotalCents = cartItems.reduce((sum, line) => sum + line.amountCents, 0)
  const checkoutHref = getPayPalCheckoutHref(paypalCheckoutUrl, cartTotalCents)
  const hasOpenWishes = cartItems.some((line) => line.kind === 'wish')
  const hasOpenPrice = cartItems.some((line) => line.amountCents === 0)
  const canPay = !hasOpenWishes && !hasOpenPrice && cartTotalCents > 0

  useEffect(() => {
    try {
      window.localStorage.setItem(cartStorageKey, JSON.stringify(cartByList))
    } catch {
      // The cart still works for this page view if browser storage is unavailable.
    }
  }, [cartByList])

  async function refreshItems() {
    const request = ++listRequest.current
    if (!isSupabaseConfigured) {
      setItemsByList((current) => ({ ...current, [listSlug]: listSlug === 'janus' ? demoWishItems : [] }))
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const refreshedItems = await getPublicItems(listSlug)
      if (request !== listRequest.current) return
      setItemsByList((current) => ({ ...current, [listSlug]: refreshedItems }))
    } catch {
      if (request === listRequest.current) setError('Die Wunschliste konnte nicht geladen werden.')
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    const updateRoute = () => {
      const admin = isAdminLocation()
      if (admin) {
        cartRequest.current += 1
        listRequest.current += 1
        setCartOpen(false)
        setSelected(null)
      }
      setIsAdminRoute(admin)
      setListSlug(getListSlug())
    }
    window.addEventListener('hashchange', updateRoute)
    window.addEventListener('popstate', updateRoute)
    return () => {
      window.removeEventListener('hashchange', updateRoute)
      window.removeEventListener('popstate', updateRoute)
    }
  }, [])

  useEffect(() => {
    if (!isAdminRoute) void refreshItems()
  }, [listSlug, isAdminRoute])

  useEffect(() => {
    if (isAdminRoute || !isSupabaseConfigured) return
    const otherList = listSlug === 'janus' ? 'marlene' : 'janus'
    if (!Object.keys(cartByList[otherList]).length) return
    let active = true
    const cartVersion = cartRequest.current
    getPublicItems(otherList).then((otherItems) => {
      if (active && cartRequest.current === cartVersion) {
        setItemsByList((current) => ({ ...current, [otherList]: otherItems }))
      }
    }).catch(() => { /* The cart shows its own retry control if validation fails. */ })
    return () => { active = false }
  }, [listSlug, isAdminRoute])

  function toggleSnow() {
    const next = !snow
    setSnow(next)
    try { localStorage.setItem('wishlist-snow', next ? 'on' : 'off') } catch { /* Setting lasts for this page view. */ }
  }

  async function refreshCombinedCartItems() {
    const request = ++cartRequest.current
    setCartLoading(true)
    setCartError('')
    try {
      if (!isSupabaseConfigured) {
        setItemsByList((current) => ({ ...current, janus: demoWishItems, marlene: [] }))
        return
      }
      const results = await Promise.allSettled(lists.map(getPublicItems))
      if (request !== cartRequest.current) return
      const nextCart = { ...cartByList }
      const updated: Partial<Record<WishListSlug, PublicWishItem[]>> = {}
      let removed = false
      let priceChanged = false
      let failed = false
      for (const [index, slug] of lists.entries()) {
        const result = results[index]
        const entries = Object.entries(cartByList[slug])
        if (result.status === 'rejected') {
          failed ||= entries.length > 0
          continue
        }
        updated[slug] = result.value
        const byId = new Map(result.value.map((item) => [item.id, item]))
        nextCart[slug] = Object.fromEntries(entries.flatMap(([id, entry]): Array<[string, CartEntry]> => {
          const item = byId.get(id)
          const line = item && cartLine(item, entry, slug)
          if (!line) {
            removed = true
            return []
          }
          if (entry.kind === 'reservation' && entry.amountCents !== line.amountCents) {
            priceChanged = true
            return [[id, { kind: 'reservation', amountCents: line.amountCents }]]
          }
          return [[id, entry]]
        }))
      }
      setItemsByList((current) => ({ ...current, ...updated }))
      if (failed) setCartError('Der Warenkorb konnte nicht geprüft werden.')
      if (removed) setCartChanged(true)
      if (priceChanged) setCartPriceChanged(true)
      setCartByList(nextCart)
    } catch {
      if (request === cartRequest.current) setCartError('Der Warenkorb konnte nicht geprüft werden.')
    } finally {
      if (request === cartRequest.current) setCartLoading(false)
    }
  }

  function openCart(keepPaymentChoice = false) {
    cartRequest.current += 1
    setCartLoading(true)
    setCartError('')
    setCartOpen(true)
    setCartChanged(false)
    setCartPriceChanged(false)
    if (!keepPaymentChoice) setOfflinePayment(false)
    setCartPaymentNote('')
  }

  function closeCart() {
    cartRequest.current += 1
    setCartOpen(false)
  }

  useEffect(() => {
    if (cartOpen) void refreshCombinedCartItems()
  }, [cartOpen])

  useEffect(() => {
    if (!cartOpen) return
    function recheckCart() {
      if (document.visibilityState === 'visible') void refreshCombinedCartItems()
    }
    document.addEventListener('visibilitychange', recheckCart)
    return () => document.removeEventListener('visibilitychange', recheckCart)
  }, [cartOpen, cartByList])

  function openWishForm(item: PublicWishItem, slug: WishListSlug, action: 'reserve' | 'contribute', fromCart = false) {
    setFormError('')
    setName('')
    setEmail('')
    setAmount(fromCart && action === 'contribute' ? (item.remaining_cents / 100).toFixed(2).replace('.', ',') : '')
    setSelected(item)
    setSelectedListSlug(slug)
    setSelectedAction(action)
    setReturnToCart(fromCart)
    closeCart()
  }

  function closeWishForm() {
    setSelected(null)
    if (returnToCart) openCart(true)
  }

  async function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || saving) return
    if (!name.trim()) {
      setFormError('Bitte gib deinen Namen ein.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (selectedAction === 'reserve') {
        const reserved = await reserveItem(selected.id, name.trim(), email)
        if (!reserved) {
          setFormError('Dieser Wunsch ist inzwischen nicht mehr verfügbar.')
          await refreshItems()
          return
        }
        setCartByList((current) => ({
          ...current,
          [selectedListSlug]: { ...current[selectedListSlug], [selected.id]: { kind: 'reservation', amountCents: selected.price_cents } },
        }))
      } else {
        const amountCents = euroToCents(amount)
        if (amountCents === null || amountCents < 1) {
          setFormError('Bitte gib einen Betrag ab 0,01 € mit höchstens zwei Nachkommastellen ein, zum Beispiel 10,50.')
          return
        }
        if (amountCents > selected.remaining_cents) {
          setFormError('Der Betrag ist höher als der noch offene Teilbetrag.')
          return
        }
        await contributeItem(selected.id, name.trim(), email, amountCents)
        setCartByList((current) => {
          const previous = current[selectedListSlug][selected.id]
          const total = amountCents + (previous?.kind === 'contribution' ? previous.amountCents : 0)
          return {
            ...current,
            [selectedListSlug]: { ...current[selectedListSlug], [selected.id]: { kind: 'contribution', amountCents: total } },
          }
        })
      }
      setSelected(null)
      setName('')
      setEmail('')
      setAmount('')
      if (selectedAction === 'reserve') setNotice('Danke! Der Wunsch ist jetzt für dich reserviert.')
      if (selectedAction === 'contribute' || returnToCart) openCart(returnToCart)
      else await refreshItems()
    } catch (reason) {
      setFormError(errorMessage(reason, 'Die Aktion ist fehlgeschlagen.'))
      await refreshItems()
    } finally {
      setSaving(false)
    }
  }

  function addToCart(item: PublicWishItem, itemListSlug: WishListSlug = listSlug) {
    setCartByList((current) => {
      const currentEntries = current[itemListSlug] ?? {}
      if (Object.hasOwn(currentEntries, item.id)) return current
      return { ...current, [itemListSlug]: { ...currentEntries, [item.id]: { kind: 'wish' } } }
    })
    openCart()
  }

  function removeFromCart(itemId: string, itemListSlug: WishListSlug) {
    const entry = cartByList[itemListSlug][itemId]
    if (entry?.kind !== 'wish' && !window.confirm('Die Position wird nur aus diesem Warenkorb entfernt. Die Zusage bleibt eingetragen. Position entfernen?')) return
    setCartPaymentNote('')
    setCartByList((current) => {
      const updatedList = { ...(current[itemListSlug] ?? {}) }
      delete updatedList[itemId]
      return { ...current, [itemListSlug]: updatedList }
    })
  }

  async function prepareManualPayPal() {
    try {
      await navigator.clipboard.writeText(paypalAddress)
      setCartPaymentNote('Papas PayPal-Adresse wurde kopiert. Füge sie bei PayPal als Empfänger ein und trage den oben angezeigten Gesamtbetrag ein.')
    } catch {
      setCartPaymentNote('Die Adresse konnte nicht kopiert werden. Du kannst sie oben ablesen.')
    }
  }

  if (isAdminRoute) return (
    <Suspense fallback={<main className="site-shell loading-state" role="status">Admin-Bereich wird geladen …</main>}>
      <AdminDashboard />
    </Suspense>
  )

  return (
    <main className={`site-shell ${snow ? '' : 'snow-off'}`}>
      <div className="winter-scenery" aria-hidden="true">
        <div className="winter-forest winter-forest-left">
          {forestTrees.slice(0, 4).map((tree, index) => (
            <span key={index} className={`forest-tree ${tree.shade}`} style={{ left: `${tree.left}%`, width: tree.width, height: tree.height } as CSSProperties} />
          ))}
        </div>
        <div className="winter-forest winter-forest-right">
          {forestTrees.slice(4).map((tree, index) => (
            <span key={index} className={`forest-tree ${tree.shade}`} style={{ left: `${tree.left - 79}%`, width: tree.width, height: tree.height } as CSSProperties} />
          ))}
        </div>
      </div>
      {snow && <div className="snowfall" aria-hidden="true">
        {snowflakes.map((flake, index) => (
          <span
            key={index}
            className="snowflake"
            style={{ left: flake.left, animationDelay: flake.delay, animationDuration: flake.duration, fontSize: flake.size, opacity: flake.opacity, '--drift': flake.drift } as CSSProperties}
          >❄</span>
        ))}
      </div>}
      <header className="topbar">
        <a className="brand" href={getListHref(listSlug)} aria-label="Zur Wunschliste">
          <span className="brand-mark">{listSlug === 'marlene' ? 'M' : 'J'}</span>
          <span>{listSlug === 'marlene' ? 'MARLENE' : 'JANUS'} <i>·</i> 26/27</span>
        </a>
        <nav className="topbar-actions" aria-label="Wunschlisten">
          <button className="admin-area-link cart-toggle" onClick={() => openCart()} aria-label={`Gemeinsamen Warenkorb mit ${cartCount} Artikeln öffnen`}>
            Warenkorb <span className="cart-count">{cartCount}</span>
          </button>
          <a className="admin-area-link sister-list-link" href={getListHref(listSlug === 'marlene' ? 'janus' : 'marlene')}>
            {listSlug === 'marlene' ? 'Zur Wunschliste von Janus' : 'Zur Wunschliste von Marlene'} <span aria-hidden="true">↗</span>
          </a>
          <a className="admin-area-link" href="#/admin">Admin-Bereich</a>
        </nav>
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">Wunschliste {listSlug === 'marlene' ? 'von Marlene' : 'von Janus'} · Weihnachten 2026</p>
          <h1>{listSlug === 'marlene' ? <>Ein paar Dinge,<br /><em>die Marlene Freude machen.</em></> : <>Ein paar Dinge,<br /><em>die Freude machen.</em></>}</h1>
          <p className="intro-text">Hier findest du {listSlug === 'marlene' ? 'Marlenes' : 'meine'} Wünsche für dieses Jahr. Du kannst ein Geschenk reservieren oder einen Teil des Preises übernehmen.</p>
          {!loading && !error && <div className="wish-count"><span className="count-star" aria-hidden="true">✳</span><span><strong>{items.length}</strong> {items.length === 1 ? 'Wunsch' : 'Wünsche'} auf der Liste</span></div>}
        </div>
        <div className="intro-art" aria-hidden="true">
          <div className="moon" />
          <div className="tree tree-back"><i /><i /><i /></div>
          <div className="tree tree-front"><i /><i /><i /></div>
          <div className="ornament ornament-one" />
          <div className="ornament ornament-two" />
          <span className="art-spark spark-one">✳</span>
          <span className="art-spark spark-two">✦</span>
          <span className="art-label">WISHES<br />& WONDER</span>
        </div>
      </section>

      {!isSupabaseConfigured && <div className="setup-banner">Vorschau mit Platzhalterpreisen · Verbinde Supabase, um Reservierungen zu aktivieren.</div>}
      {notice && <div className="notice-banner" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Hinweis schließen">×</button></div>}

      <section className="wishlist-section" aria-labelledby="wishlist-title">
        <div className="section-heading">
          <div><p className="eyebrow">Für dich ausgesucht</p><h2 id="wishlist-title">{listSlug === 'marlene' ? 'Marlene wünscht sich' : 'Die Wunschliste'}</h2></div>
        </div>
        {loading ? (
          <div className="loading-state" role="status"><span className="loader" aria-hidden="true" /> Wunschliste wird geladen …</div>
        ) : error ? (
          <div className="error-banner"><span role="alert">{error}</span><button className="outline-button" onClick={refreshItems}>Erneut laden</button></div>
        ) : (
          <div className="wish-grid">
            {items.length === 0 && <p className="empty-public-list">Diese Wunschliste ist noch leer. Wünsche erscheinen hier, sobald sie ergänzt wurden.</p>}
            {items.map((item, index) => {
              const shopUrl = getWishlistShopUrl(item, listSlug)
              return (
                <article className={'wish-card ' + (item.is_featured ? 'wish-card-featured ' : '') + (item.is_reserved ? 'is-reserved' : '')} key={item.id}>
                  <ProductArtwork item={item} index={index} list={listSlug} shopUrl={shopUrl} />
                  <div className="wish-card-content">
                    <h3>{item.title}</h3>
                    <div className="card-meta">
                      <span className="price">{item.price_cents > 0 ? `Zielbetrag ca. ${price(item.price_cents)}` : 'Preis offen'}</span>
                      {shopUrl && <a href={shopUrl} target="_blank" rel="noreferrer" aria-label={`Angebot für ${item.title} ansehen (neuer Tab)`}>Zum Angebot <span aria-hidden="true">↗</span></a>}
                    </div>
                    {item.contributed_cents > 0 && !item.is_reserved && item.remaining_cents > 0 && (
                      <p className="contribution-progress">Noch {price(item.remaining_cents)} offen · {price(item.contributed_cents)} zugesagt</p>
                    )}
                    {item.is_reserved ? (
                      <p className="gift-button gift-button-done">Reserviert</p>
                    ) : item.price_cents > 0 && item.remaining_cents === 0 ? (
                      <p className="gift-button gift-button-done">Zielbetrag zugesagt</p>
                    ) : (
                      <div className="gift-actions">
                        <button className="gift-button" onClick={() => addToCart(item, listSlug)} disabled={!isSupabaseConfigured}>
                          {cartByList[listSlug][item.id] ? 'Warenkorb öffnen' : 'In den Warenkorb'} <span aria-hidden="true">＋</span>
                        </button>
                        {item.remaining_cents > 0 && <button className="gift-button gift-button-secondary" onClick={() => openWishForm(item, listSlug, 'contribute')} disabled={!isSupabaseConfigured}>
                          Mit einem Teilbetrag beteiligen <span aria-hidden="true">＋</span>
                        </button>}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>Mit Liebe zusammengestellt von {listSlug === 'marlene' ? 'Marlene' : 'Janus'}</span>
        <button className="quiet-button" type="button" onClick={toggleSnow} aria-pressed={snow}>Schneefall</button>
      </footer>

      {selected && (
        <Modal titleId="reserve-title" busy={saving} onClose={closeWishForm}>
          <p className="eyebrow">Eine schöne Überraschung</p>
          <h2 id="reserve-title">{selectedAction === 'reserve' ? 'Wunsch reservieren' : 'Teilbetrag zusagen'}</h2>
          <p className="modal-product">{selected.title}</p>
          <form onSubmit={submitReservation}>
            {selectedAction === 'contribute' && <>
                <label htmlFor="contribution-amount">Dein Teilbetrag in Euro</label>
                <input id="contribution-amount" aria-describedby="contribution-hint" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="z. B. 10,00" required />
              <p id="contribution-hint" className="privacy-note">Noch offen sind {price(selected.remaining_cents)}. Deine Zusage wird eingetragen. Wie du zahlst, wählst du anschließend im Warenkorb.</p>
            </>}
            <label htmlFor="giver-name">Dein Name</label>
            <input id="giver-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="name" required placeholder="Wie darf ich dich nennen?" />
            <label htmlFor="giver-email">E-Mail <span>(optional)</span></label>
            <input id="giver-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="Für Rückfragen" />
            <p className="privacy-note">Dein Name und deine E-Mail werden nur dem Papa-Account angezeigt und nicht öffentlich geteilt.</p>
            <button className="gift-button modal-submit" disabled={saving}>{saving ? 'Wird gespeichert …' : selectedAction === 'reserve' ? 'Wunsch reservieren' : 'Teilbetrag zusagen & zum Warenkorb'} <span aria-hidden="true">↗</span></button>
            {formError && <p className="form-message" role="alert">{formError}</p>}
          </form>
        </Modal>
      )}

      {cartOpen && (
        <Modal className="cart-modal" titleId="cart-title" closeLabel="Warenkorb schließen" onClose={closeCart}>
          <p className="eyebrow">Wunschlisten Janus &amp; Marlene</p>
          <h2 id="cart-title">Dein Warenkorb</h2>
          {cartLoading && <div className="loading-state" role="status"><span className="loader" aria-hidden="true" /> Warenkorb wird geprüft …</div>}
          {cartError && <div><p className="form-message" role="alert">{cartError}</p><button className="outline-button" onClick={refreshCombinedCartItems}>Erneut laden</button></div>}
          {cartChanged && <p className="cart-payment-note" role="status">Nicht mehr verfügbare Positionen wurden entfernt. Bitte prüfe den aktuellen Betrag.</p>}
          {cartPriceChanged && <p className="cart-payment-note" role="status">Der Zielbetrag einer Reservierung hat sich geändert. Bitte prüfe die aktuelle Summe.</p>}
          {!cartLoading && !cartError && (cartItems.length === 0 ? (
            <p className="cart-empty">Hier liegen noch keine verfügbaren Wünsche.</p>
          ) : (
            <>
              <ul className="cart-list">
                {cartItems.map((line) => (
                  <li key={`${line.listSlug}-${line.item.id}`}>
                    <span>
                      <small className="cart-list-label">Wunschliste {line.listSlug === 'marlene' ? 'Marlene' : 'Janus'}</small>
                      <strong>{line.item.title}</strong>
                      <small>{line.amountCents === 0 ? 'Preis offen' : price(line.amountCents)} · {line.kind === 'contribution' ? 'Zugesagter Teilbetrag' : line.kind === 'reservation' ? 'Reserviert' : line.item.contributed_cents > 0 ? 'Offener Restbetrag' : 'Zur Reservierung'}</small>
                    </span>
                    <div className="cart-row-actions">
                      {line.kind === 'wish' && <button className="cart-remove cart-reserve" onClick={() => openWishForm(line.item, line.listSlug, line.item.contributed_cents > 0 ? 'contribute' : 'reserve', true)}>{line.item.contributed_cents > 0 ? 'Restbetrag übernehmen' : 'Reservieren'}</button>}
                      <button className="cart-remove" onClick={() => removeFromCart(line.item.id, line.listSlug)} aria-label={`${line.item.title} aus dem Warenkorb entfernen`}>Entfernen</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="cart-total"><span>Geschätzter Gesamtbetrag</span><strong>{price(cartTotalCents)}</strong></div>
              {hasOpenWishes && <p className="cart-setup-note">Reserviere die Geschenke oder sage die offenen Restbeträge zu, bevor du zahlst.</p>}
              {!hasOpenWishes && hasOpenPrice && <p className="cart-setup-note">Für Wünsche ohne Zielbetrag klärst du den Preis direkt mit Papa.</p>}
              {canPay && (checkoutHref || paypalAddress) && (
                <>
                  <a className="gift-button modal-submit cart-pay" href={checkoutHref || paypalSendUrl} target="_blank" rel="noreferrer" onClick={checkoutHref ? undefined : prepareManualPayPal}>
                    Mit PayPal zahlen <span aria-hidden="true">↗</span>
                  </a>
                  <p className="cart-setup-note">{checkoutHref ? 'Prüfe Empfänger und Betrag bei PayPal.' : `Gib bei PayPal ${paypalAddress} als Empfänger und den Betrag oben ein.`} Die Zahlung wird hier nicht automatisch bestätigt.</p>
                </>
              )}
              <button className="gift-button gift-button-secondary modal-submit cart-pay" type="button" aria-expanded={offlinePayment} aria-controls={offlinePayment ? 'offline-payment' : undefined} onClick={() => setOfflinePayment((open) => !open)}>Ich zahle anders</button>
              {offlinePayment && <p id="offline-payment" className="cart-payment-note" role="status">
                Sprich mit Papa ab, ob du bar zahlst oder überweist. Nenne ihm die Wünsche und den Betrag aus deinem Warenkorb.
              </p>}
              {cartPaymentNote && <p className="cart-payment-note" role="status">{cartPaymentNote}</p>}
            </>
          ))}
        </Modal>
      )}
    </main>
  )
}

export default App
