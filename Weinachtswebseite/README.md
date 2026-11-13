# Wunschliste Janus 26/27

Eine deutsche React-Webseite mit den öffentlichen Wunschlisten von Janus und Marlene, Geschenkreservierung, Beteiligungen an Teilbeträgen, Admin-Anmeldung, Bildupload und Supabase-Backend. Die Oberfläche wird als statische Seite über GitHub Pages veröffentlicht.

Das winterliche Design enthält Schneefall und lokal gespeicherte Produktbilder aus dem beigefügten Wunschlisten-PDF. Dadurch bleiben die Bilder auch auf GitHub Pages verfügbar.

## Supabase-Projekt

Das Projekt ist bereits in der Organisation **Weinachtsapp** angelegt (Frankfurt, Projekt-Ref `zwsjiygcegpwtxpxccxt`). Die Datenbank enthält die vorhandenen Wünsche mit Platzhalterpreisen und die Migrationen aus `supabase/migrations/`.

Die Supabase-Projekt-URL steht in `.env.example`. Der dort eingetragene Publishable Key ist für die Verwendung im Browser vorgesehen. `.env.local` ist von Git ausgeschlossen.

## Lokal starten

Voraussetzungen: Node.js 22.12 oder neuer und npm.

```powershell
.\setup.ps1
npm run dev
```

Das Setup-Skript kopiert `.env.example` bei Bedarf nach `.env.local` und installiert die Abhängigkeiten. Die öffentliche Seite von Janus läuft unter `/`; Marlenes Liste ist unter `/?list=marlene` erreichbar. Das Admin-Dashboard ist unter `/#/admin` erreichbar.

Falls Datenbankänderungen später lokal entwickelt werden, kann Supabase CLI verwendet werden:

```powershell
npx supabase login
.\setup.ps1 -ProjectRef zwsjiygcegpwtxpxccxt
```

## Admin-Zugang

Das erste Admin-Konto wurde im Supabase-Projekt eingeladen und in `public.wish_admins` freigeschaltet. Öffne die veröffentlichte Seite unter `/#/admin`. Für die erste Anmeldung kannst du den Einladungslink oder **Anmeldelink per E-Mail senden** verwenden; öffne den Link im selben Browser. Im Dashboard kannst du anschließend über **Passwort festlegen** ein dauerhaftes Passwort für spätere Anmeldungen einrichten.

Nur Benutzer, deren ID in `wish_admins` steht, dürfen Wunschlisten verwalten. Diese Berechtigung gibt keine Schenker-Namen oder E-Mail-Adressen frei. Geschenkdetails sind zusätzlich durch `wish_reservation_viewers` geschützt; nur dort eingetragene Nutzer können sie über die Papa-Übersicht lesen. Neue Konten erhalten keine öffentliche Registrierung.

Lege Papas Auth-Konto im Supabase-Dashboard unter **Authentication → Users** mit seiner echten E-Mail-Adresse an bzw. lade ihn ein. Danach trage ihn über die Supabase SQL-Konsole als Geschenkdetails-Betrachter ein. Ersetze die E-Mail durch Papas echte Adresse:

```sql
insert into public.wish_reservation_viewers (user_id)
select id from auth.users where lower(email) = lower('PAPA_EMAIL_HIER_EINTRAGEN')
on conflict (user_id) do nothing;
```

Die E-Mail-Adresse im Formular allein erteilt keine Berechtigung. Die Datenbank prüft die eingeloggte Benutzer-ID. Janus kann beide Listen bearbeiten, sieht aber nur den Reservierungsstatus und die aggregierte Beteiligungssumme.

## GitHub Pages

Das bestehende Repository veröffentlicht Änderungen am Branch `main` über GitHub Actions. Die Pages-Quelle ist **GitHub Actions**. Unter **Settings → Secrets and variables → Actions → Variables** müssen diese Repository-Variablen gesetzt sein:
   - `VITE_SUPABASE_URL` = `https://zwsjiygcegpwtxpxccxt.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = Publishable Key aus den Supabase Project Settings
   - `VITE_PAPA_PAYPAL_ADDRESS` = Papas PayPal-Adresse für die manuelle Eingabe bei PayPal
   - `VITE_PAPA_PAYPAL_CHECKOUT_URL` = Papas PayPal.Me-Link mit seinem PayPal-Benutzernamen oder offizieller Checkout-Link

Der mitgelieferte Workflow `.github/workflows/deploy.yml` erwartet `package.json` im Repository-Stamm. Liegt die App im Zielrepository in einem Unterordner, passe dort das Arbeitsverzeichnis der npm-Schritte und den Pfad zum Pages-Artefakt an. Der Workflow übergibt die PayPal-Werte unter `jobs.build.env`:

```yaml
VITE_PAPA_PAYPAL_ADDRESS: ${{ vars.VITE_PAPA_PAYPAL_ADDRESS }}
VITE_PAPA_PAYPAL_CHECKOUT_URL: ${{ vars.VITE_PAPA_PAYPAL_CHECKOUT_URL }}
```

Bei einem PayPal.Me-Link hängt die App den Gesamtbetrag an. Ist nur die PayPal-Adresse eingerichtet, öffnet „Mit PayPal zahlen“ die Seite zum Geldsenden. Dort gibt der Absender Adresse und Betrag ein. Über „Ich zahle anders“ können Schenkende Barzahlung oder Überweisung direkt mit Papa abstimmen. Zusagen und Reservierungen werden vor dem Zahlungswechsel eingetragen. Den Zahlungseingang gleicht Papa separat ab.

Änderungen in `main` lösen den Build und die Veröffentlichung automatisch aus. Die Bilddateien liegen unter `public/products/` und werden gemeinsam mit der App ausgeliefert.

GitHub Pages hostet nur die statische Oberfläche. Datenbank und API laufen in Supabase. Der Publishable Key darf im Browser verwendet werden; ein Secret- oder Service-Role-Key gehört niemals in die Frontend-Variablen oder in GitHub Actions Variables.

Spiele die Migrationen in `supabase/migrations/` vor der Veröffentlichung ein. Sie korrigieren unter anderem die Startdaten und schützen Wünsche mit bestehenden Zusagen vor versehentlichem Löschen.

## Funktionen

- Artikel sind in der Datenbank über `sort_order` geordnet; der Admin kann sie per Drag-and-Drop sortieren. Die vollständige Reihenfolge wird in einem Batch-RPC validiert und transaktional gespeichert.
- Reservierungen werden atomar vorgenommen. Zwei gleichzeitige Reservierungen können denselben Artikel nicht doppelt belegen.
- Die öffentliche API liefert keine Namen oder E-Mail-Adressen, sondern nur Reservierungsstatus und aggregierte Beteiligungssummen. Ausschließlich ein Eintrag in `wish_reservation_viewers` kann Geschenkdetails abrufen.
- Janus' Admin-Konto kann beide Listen bearbeiten. Artikel, Links, Preise und Produktbilder können ergänzt, geändert und gelöscht werden. Reservierungen lassen sich ohne Anzeige des Schenkernamens freigeben.
- Janus' und Marlenes Wünsche landen im selben lokalen Warenkorb. Einzelne Wünsche können reserviert und Teilbeträge zugesagt werden. Mehrere Zusagen für denselben Wunsch werden im Warenkorb addiert. Die Datenbank prüft bei jeder Zusage den offenen Restbetrag. Wenn die Positionen bestätigt sind, kann der geschätzte Gesamtbetrag per PayPal oder nach Absprache mit Papa bezahlt werden.
- Produktbilder liegen im öffentlichen Supabase-Storage-Bucket `product-images`. Nur Admin-Konten dürfen dort hochladen oder löschen.
- Der INZONE H9 II ist als Hauptwunsch markiert.

## Projektstruktur

```text
src/
  components/AdminDashboard.tsx
  lib/api.ts
  lib/demo-items.ts
  lib/product-images.ts
  lib/supabase.ts
  lib/types.ts
  App.tsx
  main.tsx
  styles.css
public/
  products/ (14 lokale Produktbilder)
PRODUCT_IMAGE_SOURCES.md
supabase/
  config.toml
  migrations/
    20261112182812_create_wishlist.sql
    20261112182931_admin_rls.sql
    20261113125154_multi_wishlists_contributions_privacy.sql
    20261113125747_serialize_contribution_price_checks.sql
    20261113130157_legacy_admin_rpc_privacy_bridge.sql
    20261113154350_admin_manage_wish_contributions.sql
    20261113160557_wishlist_integrity.sql
.github/workflows/deploy.yml
setup.ps1
```
