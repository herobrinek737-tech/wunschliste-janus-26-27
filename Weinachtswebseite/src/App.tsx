import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import AdminDashboard from './components/AdminDashboard'
import { getPublicItems, reserveItem } from './lib/api'
import { demoItems } from './lib/demo-items'
import { getProductImage } from './lib/product-images'
import { isSupabaseConfigured } from './lib/supabase'
import type { PublicWishItem } from './lib/types'

const accents = ['green', 'blue', 'silver', 'violet', 'amber', 'teal', 'red', 'brick', 'charcoal', 'orange', 'midnight', 'mint', 'slate', 'berry']
const symbols = ['✦', '◷', '◉', '✺', '⌁', '▧', '✧', '▦', '◈', '✿', '↗', '✶', '⌖', '◌']

function price(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function isAdminLocation() {
  const authParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return window.location.hash === '#/admin'
    || authParams.has('access_token')
    || authParams.has('error_code')
    || new URLSearchParams(window.location.search).has('code')
}

function ProductArtwork({ item, index }: { item: PublicWishItem; index: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const image = getProductImage(item.title)

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
    </div>
  )
}

function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(isAdminLocation)
  const [items, setItems] = useState<PublicWishItem[]>(isSupabaseConfigured ? [] : demoItems)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PublicWishItem | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  async function refreshItems() {
    if (!isSupabaseConfigured) return
    setLoading(true)
    setError('')
    try {
      setItems(await getPublicItems())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die Wunschliste konnte nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const updateRoute = () => setIsAdminRoute(isAdminLocation())
    window.addEventListener('hashchange', updateRoute)
    void refreshItems()
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  async function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    setNotice('')
    try {
      const reserved = await reserveItem(selected.id, name, email)
      if (!reserved) {
        setNotice('Dieser Wunsch wurde gerade schon reserviert. Bitte wähle einen anderen Artikel.')
        await refreshItems()
        return
      }
      setSelected(null)
      setName('')
      setEmail('')
      setNotice('Danke! Der Artikel ist jetzt für dich reserviert.')
      await refreshItems()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Die Reservierung ist fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  if (isAdminRoute) return <AdminDashboard />

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Zur Wunschliste">
          <span className="brand-mark">J</span>
          <span>JANUS <i>·</i> 26/27</span>
        </a>
        <div className="topbar-actions">
          <div className="topbar-note"><span className="topbar-dot" /> Weihnachtswünsche</div>
          <a className="admin-area-link" href="#/admin">Admin-Bereich</a>
        </div>
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">Meine Wunschliste · Weihnachten 2026</p>
          <h1>Ein paar Dinge,<br /><em>die Freude machen.</em></h1>
          <p className="intro-text">Hier findest du meine Wünsche für dieses Jahr. Wenn du mir etwas davon schenken möchtest, reserviere es einfach – so bleibt die Überraschung erhalten.</p>
          <div className="wish-count"><span className="count-star">✳</span><span><strong>{items.length || (isSupabaseConfigured ? 0 : 14)}</strong> Wünsche auf der Liste</span></div>
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
          <div><p className="eyebrow">Für dich ausgesucht</p><h2 id="wishlist-title">Die Wunschliste</h2></div>
          <div className="order-note"><span>01</span> Janus' Reihenfolge</div>
        </div>
        {loading ? (
          <div className="loading-state"><span className="loader" /> Wunschliste wird geladen …</div>
        ) : (
          <div className="wish-grid">
            {items.map((item, index) => (
              <article className={'wish-card ' + (item.is_featured ? 'wish-card-featured' : '') + (item.is_reserved ? ' is-reserved' : '')} key={item.id}>
                <ProductArtwork item={item} index={index} />
                <div className="wish-card-content">
                  <p className="card-kicker">{item.is_featured ? 'Der große Wunsch' : 'Wunsch ' + String(index + 1).padStart(2, '0')}</p>
                  <h3>{item.title}</h3>
                  <div className="card-meta">
                    <span className="price">{price(item.price_cents)}</span>
                    <a href={item.url} target="_blank" rel="noreferrer">Zum Shop <span aria-hidden="true">↗</span></a>
                  </div>
                  <button
                    className={item.is_reserved ? 'gift-button gift-button-done' : 'gift-button'}
                    onClick={() => { setSelected(item); setNotice('') }}
                    disabled={item.is_reserved || !isSupabaseConfigured}
                  >
                    {item.is_reserved ? 'Schon reserviert' : 'Das schenke ich!'}
                    {!item.is_reserved && <span aria-hidden="true">↗</span>}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>Mit Liebe zusammengestellt von Janus</span>
        <span>Alle Preise sind Platzhalter und können sich im Shop ändern.</span>
      </footer>

      {selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <section className="reserve-modal" role="dialog" aria-modal="true" aria-labelledby="reserve-title">
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Schließen">×</button>
            <p className="eyebrow">Eine schöne Überraschung</p>
            <h2 id="reserve-title">Du schenkst …</h2>
            <p className="modal-product">{selected.title}</p>
            <form onSubmit={submitReservation}>
              <label htmlFor="giver-name">Dein Name</label>
              <input id="giver-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="name" required placeholder="Wie darf ich dich nennen?" />
              <label htmlFor="giver-email">E-Mail <span>(optional)</span></label>
              <input id="giver-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="Für Rückfragen" />
              <p className="privacy-note">Dein Name wird nur im Admin-Bereich angezeigt und nicht öffentlich geteilt.</p>
              <button className="gift-button modal-submit" disabled={saving}>{saving ? 'Wird reserviert …' : 'Wunsch reservieren'} <span aria-hidden="true">↗</span></button>
              {notice && <p className="form-message" role="alert">{notice}</p>}
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
