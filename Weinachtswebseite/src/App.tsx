import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FormEvent } from 'react'
import AdminDashboard from './components/AdminDashboard'
import { contributeItem, getPublicItems, reserveItem } from './lib/api'
import { demoWishItems } from './lib/demo-items'
import { getProductImage } from './lib/product-images'
import { isSupabaseConfigured } from './lib/supabase'
import type { PublicWishItem, WishListSlug } from './lib/types'

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

const paypalAddress = import.meta.env.VITE_PAPA_PAYPAL_ADDRESS?.trim() || '[Hier PayPal-Adresse von Papa einfügen]'
const paypalCheckoutUrl = import.meta.env.VITE_PAPA_PAYPAL_CHECKOUT_URL?.trim() || ''
const paypalSendUrl = 'https://www.paypal.com/de/digital-wallet/send-receive-money/send-money'
const cartStorageKey = 'wishlist-cart-by-list-v1'
type CartByList = Record<WishListSlug, Record<string, number>>
type CartLine = { item: PublicWishItem; listSlug: WishListSlug; amountCents: number; isContribution: boolean }

function price(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
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

function readCartEntries(value: unknown): Record<string, number> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.filter((id): id is string => typeof id === 'string').map((id) => [id, 0]))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0))
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

function getPayPalCheckoutHref(baseUrl: string, amountCents: number) {
  try {
    const url = new URL(baseUrl)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (url.protocol !== 'https:' || !['paypal.com', 'paypal.me'].includes(hostname)) return ''

    const segments = url.pathname.split('/').filter(Boolean)
    const amount = `${(amountCents / 100).toFixed(2)}EUR`
    if (hostname === 'paypal.me' && segments.length > 0) {
      url.pathname = `/${segments[0]}/${amount}`
    } else if (hostname === 'paypal.com' && segments[0]?.toLowerCase() === 'paypalme' && segments[1]) {
      url.pathname = `/paypalme/${segments[1]}/${amount}`
    }
    return url.toString()
  } catch {
    return ''
  }
}

function ProductArtwork({ item, index }: { item: PublicWishItem; index: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const image = item.image_url || getProductImage(item.title)

  return (
    <div className={'product-art product-art-' + accents[index % accents.length]}>
      <span className="art-orbit orbit-a" /><span className="art-orbit orbit-b" />
      {image && !imageFailed ? (
        <img className="product-image" src={image} alt={item.title} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
      ) : (
        <span className="product-symbol" aria-hidden="true">{symbols[index % symbols.length]}</span>
      )}
      <span className="product-index">{String(index + 1).padStart(2, '0')}</span>
      {item.is_featured && <span className="main-wish">HAUPTWUNSCH</span>}
      {item.is_reserved && <span className="reserved-overlay"><span>✓</span> Bereits verschenkt</span>}
      {!item.is_reserved && item.remaining_cents === 0 && <span className="reserved-overlay"><span>✓</span> Gemeinsam finanziert</span>}
    </div>
  )
}

function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(isAdminLocation)
  const [listSlug, setListSlug] = useState<WishListSlug>(getListSlug)
  const [itemsByList, setItemsByList] = useState<Record<WishListSlug, PublicWishItem[]>>(() => ({ janus: isSupabaseConfigured ? [] : demoWishItems, marlene: [] }))
  const items = itemsByList[listSlug] ?? []
  const [cartByList, setCartByList] = useState<CartByList>(readCartByList)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartLoading, setCartLoading] = useState(false)
  const [cartError, setCartError] = useState('')
  const [cartPaymentNote, setCartPaymentNote] = useState('')
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PublicWishItem | null>(null)
  const [selectedListSlug, setSelectedListSlug] = useState<WishListSlug>('janus')
  const [selectedAction, setSelectedAction] = useState<'reserve' | 'contribute'>('reserve')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const cartIds = Object.keys(cartByList[listSlug] ?? {})
  const cartItems: CartLine[] = (['janus', 'marlene'] as const).flatMap((cartListSlug) =>
    Object.entries(cartByList[cartListSlug] ?? {}).flatMap(([itemId, savedAmount]) => {
      const item = itemsByList[cartListSlug].find((entry) => entry.id === itemId)
      if (!item || item.is_reserved) return []
      const isContribution = savedAmount > 0
      const amountCents = isContribution ? savedAmount : item.remaining_cents
      if (amountCents <= 0) return []
      return [{ item, listSlug: cartListSlug, amountCents, isContribution }]
    }),
  )
  const cartCount = (Object.values(cartByList) as Array<Record<string, number>>).reduce((sum, entries) => sum + Object.keys(entries).length, 0)
  const cartTotalCents = cartItems.reduce((sum, line) => sum + line.amountCents, 0)

  useEffect(() => {
    try {
      window.localStorage.setItem(cartStorageKey, JSON.stringify(cartByList))
    } catch {
      // The cart still works for this page view if browser storage is unavailable.
    }
  }, [cartByList])

  async function refreshItems() {
    if (!isSupabaseConfigured) {
      setItemsByList((current) => ({ ...current, [listSlug]: listSlug === 'janus' ? demoWishItems : [] }))
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const refreshedItems = await getPublicItems(listSlug)
      setItemsByList((current) => ({ ...current, [listSlug]: refreshedItems }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die Wunschliste konnte nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const updateRoute = () => {
      setIsAdminRoute(isAdminLocation())
      setListSlug(getListSlug())
    }
    window.addEventListener('hashchange', updateRoute)
    window.addEventListener('popstate', updateRoute)
    void refreshItems()
    return () => {
      window.removeEventListener('hashchange', updateRoute)
      window.removeEventListener('popstate', updateRoute)
    }
  }, [listSlug])

  async function refreshCombinedCartItems() {
    setCartLoading(true)
    setCartError('')
    try {
      if (!isSupabaseConfigured) {
        setItemsByList((current) => ({ ...current, janus: demoWishItems, marlene: [] }))
        return
      }
      const [janusItems, marleneItems] = await Promise.all([getPublicItems('janus'), getPublicItems('marlene')])
      setItemsByList({ janus: janusItems, marlene: marleneItems })
    } catch (reason) {
      setCartError(reason instanceof Error ? reason.message : 'Der gemeinsame Warenkorb konnte nicht geladen werden.')
    } finally {
      setCartLoading(false)
    }
  }

  function openCart() {
    setCartOpen(true)
    setCartPaymentNote('')
    void refreshCombinedCartItems()
  }

  async function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    setNotice('')
    try {
      if (selectedAction === 'reserve') {
        const reserved = await reserveItem(selected.id, name, email)
        if (!reserved) {
          setNotice('Dieser Wunsch wurde gerade schon reserviert. Bitte wähle einen anderen Artikel.')
          await refreshItems()
          return
        }
        setCartByList((current) => {
          const updatedList = { ...(current[selectedListSlug] ?? {}) }
          delete updatedList[selected.id]
          return { ...current, [selectedListSlug]: updatedList }
        })
      } else {
        const numericAmount = Number(amount.replace(',', '.'))
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
          setNotice('Bitte trage einen gültigen Betrag größer als 0,00 € ein.')
          return
        }
        const amountCents = Math.round(numericAmount * 100)
        if (amountCents > selected.remaining_cents) {
          setNotice('Der Betrag ist höher als der noch offene Teilbetrag.')
          return
        }
        await contributeItem(selected.id, name, email, amountCents)
        setCartByList((current) => ({
          ...current,
          [selectedListSlug]: { ...(current[selectedListSlug] ?? {}), [selected.id]: amountCents },
        }))
      }
      setSelected(null)
      setName('')
      setEmail('')
      setAmount('')
      await refreshItems()
      if (selectedAction === 'contribute') {
        openCart()
      } else {
        setNotice('Danke! Der Artikel ist jetzt für dich reserviert.')
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Die Aktion ist fehlgeschlagen.')
      await refreshItems()
    } finally {
      setSaving(false)
    }
  }

  function addToCart(item: PublicWishItem, itemListSlug: WishListSlug = listSlug) {
    setCartByList((current) => {
      const currentEntries = current[itemListSlug] ?? {}
      if (Object.hasOwn(currentEntries, item.id)) return current
      return { ...current, [itemListSlug]: { ...currentEntries, [item.id]: 0 } }
    })
    openCart()
  }

  function removeFromCart(itemId: string, itemListSlug: WishListSlug) {
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
      setCartPaymentNote('Bitte verwende die angezeigte PayPal-Adresse und trage den oben angezeigten Gesamtbetrag bei PayPal ein.')
    }
  }

  if (isAdminRoute) return <AdminDashboard />

  return (
    <main className="site-shell">
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
      <div className="snowfall" aria-hidden="true">
        {snowflakes.map((flake, index) => (
          <span
            key={index}
            className="snowflake"
            style={{ left: flake.left, animationDelay: flake.delay, animationDuration: flake.duration, fontSize: flake.size, opacity: flake.opacity, '--drift': flake.drift } as CSSProperties}
          >❄</span>
        ))}
      </div>
      <header className="topbar">
        <a className="brand" href={getListHref(listSlug)} aria-label="Zur Wunschliste">
          <span className="brand-mark">{listSlug === 'marlene' ? 'M' : 'J'}</span>
          <span>{listSlug === 'marlene' ? 'MARLENE' : 'JANUS'} <i>·</i> 26/27</span>
        </a>
        <div className="topbar-actions">
          <div className="topbar-note"><span className="topbar-dot" /> Weihnachtswünsche</div>
          <button className="admin-area-link cart-toggle" onClick={openCart} aria-label={`Gemeinsamen Warenkorb mit ${cartCount} Artikeln öffnen`}>
            Warenkorb <span className="cart-count">{cartCount}</span>
          </button>
          <a className="admin-area-link sister-list-link" href={getListHref(listSlug === 'marlene' ? 'janus' : 'marlene')}>
            {listSlug === 'marlene' ? 'Zur Wunschliste von Janus' : 'Zur Wunschliste von Marlene'} <span aria-hidden="true">↗</span>
          </a>
          <a className="admin-area-link" href="#/admin">Admin-Bereich</a>
        </div>
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">Wunschliste {listSlug === 'marlene' ? 'von Marlene' : 'von Janus'} · Weihnachten 2026</p>
          <h1>{listSlug === 'marlene' ? <>Ein paar Dinge,<br /><em>die Marlene Freude machen.</em></> : <>Ein paar Dinge,<br /><em>die Freude machen.</em></>}</h1>
          <p className="intro-text">Hier findest du {listSlug === 'marlene' ? 'Marlenes' : 'meine'} Wünsche für dieses Jahr. Wenn du etwas davon schenken möchtest, reserviere es oder beteilige dich an einem Teilbetrag.</p>
          <div className="wish-count"><span className="count-star">✳</span><span><strong>{items.length || (isSupabaseConfigured || listSlug === 'marlene' ? 0 : 14)}</strong> Wünsche auf der Liste</span></div>
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
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Hinweis schließen">×</button></div>}

      <section className="wishlist-section" aria-labelledby="wishlist-title">
        <div className="section-heading">
          <div><p className="eyebrow">Für dich ausgesucht</p><h2 id="wishlist-title">{listSlug === 'marlene' ? 'Marlene wünscht sich' : 'Die Wunschliste'}</h2></div>
          <div className="order-note"><span>01</span> {listSlug === 'marlene' ? 'Marlene' : 'Janus'}' Reihenfolge</div>
        </div>
        {loading ? (
          <div className="loading-state"><span className="loader" /> Wunschliste wird geladen …</div>
        ) : (
          <div className="wish-grid">
            {items.length === 0 && <p className="empty-public-list">Diese Wunschliste ist noch leer. Wünsche erscheinen hier, sobald sie ergänzt wurden.</p>}
            {items.map((item, index) => (
              <article className={'wish-card ' + (item.is_featured ? 'wish-card-featured ' : '') + (item.is_reserved ? 'is-reserved' : '')} key={item.id}>
                <ProductArtwork item={item} index={index} />
                <div className="wish-card-content">
                  <p className="card-kicker">{item.is_featured ? 'Der große Wunsch' : 'Wunsch ' + String(index + 1).padStart(2, '0')}</p>
                  <h3>{item.title}</h3>
                  <div className="card-meta">
                    <span className="price">{price(item.price_cents)}</span>
                    <a href={item.url} target="_blank" rel="noreferrer">Zum Shop <span aria-hidden="true">↗</span></a>
                  </div>
                  {item.contributed_cents > 0 && !item.is_reserved && item.remaining_cents > 0 && (
                    <p className="contribution-progress">Noch {price(item.remaining_cents)} offen · {price(item.contributed_cents)} beigetragen</p>
                  )}
                  {item.is_reserved ? (
                    <button className="gift-button gift-button-done" disabled>Schon reserviert</button>
                  ) : item.remaining_cents === 0 ? (
                    <button className="gift-button gift-button-done" disabled>Gemeinsam finanziert</button>
                  ) : (
                    <div className="gift-actions">
                      <button className="gift-button" onClick={() => addToCart(item, listSlug)} disabled={!isSupabaseConfigured || item.contributed_cents > 0}>
                        {cartIds.includes(item.id) ? 'Warenkorb öffnen' : 'Schenken'} <span aria-hidden="true">↗</span>
                      </button>
                      <button className="gift-button gift-button-cart" onClick={() => addToCart(item, listSlug)} disabled={!isSupabaseConfigured}>
                        {cartIds.includes(item.id) ? 'Zum Warenkorb' : 'In den Warenkorb'} <span aria-hidden="true">＋</span>
                      </button>
                      <button className="gift-button gift-button-secondary" onClick={() => { setSelected(item); setSelectedListSlug(listSlug); setSelectedAction('contribute'); setAmount(''); setName(''); setEmail(''); setNotice('') }} disabled={!isSupabaseConfigured}>
                        Beteiligen <span aria-hidden="true">＋</span>
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>Mit Liebe zusammengestellt von {listSlug === 'marlene' ? 'Marlene' : 'Janus'}</span>
        <span className="paypal-note">PayPal an Papa: {paypalAddress}</span>
        <span>Alle Preise sind Platzhalter und können sich im Shop ändern.</span>
      </footer>

      {selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <section className="reserve-modal" role="dialog" aria-modal="true" aria-labelledby="reserve-title">
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Schließen">×</button>
            <p className="eyebrow">Eine schöne Überraschung</p>
            <h2 id="reserve-title">{selectedAction === 'reserve' ? 'Du schenkst …' : 'Du beteiligst dich …'}</h2>
            <p className="modal-product">{selected.title}</p>
            <form onSubmit={submitReservation}>
              {selectedAction === 'contribute' && <>
                <label htmlFor="contribution-amount">Dein Teilbetrag in Euro</label>
                <input id="contribution-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="z. B. 10,00" required />
                <p className="privacy-note">Noch offen: {price(selected.remaining_cents)}. Die Zahlung selbst erfolgt separat über Papa.</p>
              </>}
              <label htmlFor="giver-name">Dein Name</label>
              <input id="giver-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="name" required placeholder="Wie darf ich dich nennen?" />
              <label htmlFor="giver-email">E-Mail <span>(optional)</span></label>
              <input id="giver-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="Für Rückfragen" />
              <p className="privacy-note">Dein Name und deine E-Mail werden nur dem Papa-Account angezeigt und nicht öffentlich geteilt.</p>
              <button className="gift-button modal-submit" disabled={saving}>{saving ? 'Wird gespeichert …' : selectedAction === 'reserve' ? 'Wunsch reservieren' : 'Beteiligung eintragen & zum Warenkorb'} <span aria-hidden="true">↗</span></button>
              {notice && <p className="form-message" role="alert">{notice}</p>}
            </form>
          </section>
        </div>
      )}

      {cartOpen && (
        <div className="modal-backdrop cart-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
          <section className="reserve-modal cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <button className="modal-close" onClick={() => setCartOpen(false)} aria-label="Warenkorb schließen">×</button>
            <p className="eyebrow">Wunschlisten Janus &amp; Marlene</p>
            <h2 id="cart-title">Dein Warenkorb</h2>
            {cartLoading && <div className="loading-state"><span className="loader" /> Gemeinsamer Warenkorb wird geladen …</div>}
            {cartError && <p className="form-message" role="alert">{cartError}</p>}
            {!cartLoading && !cartError && cartItems.length === 0 ? (
              <p className="cart-empty">Hier liegen noch keine verfügbaren Wünsche.</p>
            ) : !cartLoading && (
              <>
                <ul className="cart-list">
                  {cartItems.map((line) => (
                    <li key={`${line.listSlug}-${line.item.id}`}>
                      <span>
                        <small className="cart-list-label">Wunschliste {line.listSlug === 'marlene' ? 'Marlene' : 'Janus'}</small>
                        <strong>{line.item.title}</strong>
                        <small>{price(line.amountCents)} · {line.isContribution ? 'Teilbetrag' : line.item.contributed_cents > 0 ? 'Restbetrag' : 'Geschenk'}</small>
                      </span>
                      <div className="cart-row-actions">
                        {!line.isContribution && <button className="cart-remove cart-reserve" onClick={() => { setSelected(line.item); setSelectedListSlug(line.listSlug); setSelectedAction('reserve'); setName(''); setEmail(''); setNotice(''); setCartOpen(false) }}>Reservieren</button>}
                        <button className="cart-remove" onClick={() => removeFromCart(line.item.id, line.listSlug)} aria-label={`${line.item.title} aus dem Warenkorb entfernen`}>Entfernen</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="cart-total"><span>Gesamtbetrag</span><strong>{price(cartTotalCents)}</strong></div>
                <p className="privacy-note">Zahlungsempfänger: Papa · {paypalAddress}</p>
                {paypalCheckoutUrl ? (
                  <a className="gift-button modal-submit cart-pay" href={getPayPalCheckoutHref(paypalCheckoutUrl, cartTotalCents)} target="_blank" rel="noreferrer">
                    Jetzt bezahlen <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <a className="gift-button modal-submit cart-pay" href={paypalSendUrl} target="_blank" rel="noreferrer" onClick={() => { void prepareManualPayPal() }}>
                    Jetzt bezahlen <span aria-hidden="true">↗</span>
                  </a>
                )}
                {!paypalCheckoutUrl && <p className="cart-setup-note">PayPal öffnet in einem neuen Tab. Die Adresse wird kopiert; füge sie dort als Empfänger ein und gib den Gesamtbetrag manuell ein. Nach der Zahlung kannst du Geschenke hier über „Reservieren“ eintragen. Die Zahlung wird nicht automatisch in dieser Liste bestätigt.</p>}
                {paypalCheckoutUrl && <p className="cart-setup-note">Bitte prüfe Empfänger und Betrag bei PayPal. Die Wunschliste erhält keine automatische Zahlungsbestätigung. Nach der Zahlung kannst du Geschenke hier über „Reservieren“ eintragen.</p>}
                {cartPaymentNote && <p className="cart-payment-note" role="status">{cartPaymentNote}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default App
