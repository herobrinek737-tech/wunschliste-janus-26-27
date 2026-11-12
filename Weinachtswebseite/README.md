# Wunschliste Janus 26/27

Eine deutsche React-Webseite mit öffentlicher Wunschliste, Reservierung per Formular, Admin-Anmeldung, Drag-and-Drop-Sortierung und Supabase-Backend. Die Oberfläche wird als statische Seite über GitHub Pages veröffentlicht.

## Supabase-Projekt

Das Projekt ist bereits in der Organisation **Weinachtsapp** angelegt (Frankfurt, Projekt-Ref `zwsjiygcegpwtxpxccxt`). Die Datenbank enthält alle 14 Wünsche mit Platzhalterpreisen und den beiden Migrationen aus `supabase/migrations/`.

Die Supabase-Projekt-URL steht in `.env.example`. Der dort eingetragene Publishable Key ist für die Verwendung im Browser vorgesehen. `.env.local` ist von Git ausgeschlossen.

## Lokal starten

Voraussetzungen: Node.js 22.12 oder neuer und npm.

```powershell
.\setup.ps1
npm run dev
```

Das Setup-Skript kopiert `.env.example` bei Bedarf nach `.env.local` und installiert die Abhängigkeiten. Die öffentliche Seite läuft unter `/`; das Admin-Dashboard ist unter `/#/admin` erreichbar.

Falls Datenbankänderungen später lokal entwickelt werden, kann Supabase CLI verwendet werden:

```powershell
npx supabase login
.\setup.ps1 -ProjectRef zwsjiygcegpwtxpxccxt
```

## Admin-Zugang einrichten

Die Datenbank ist fertig eingerichtet. Für den Admin-Zugang muss ein Auth-Benutzer im Supabase-Dashboard angelegt und als Admin eingetragen werden:

1. In Supabase unter **Authentication → Users** einen Benutzer mit deiner E-Mail-Adresse anlegen und ein Passwort setzen.
2. Unter **Authentication → Settings** öffentliche Registrierungen deaktivieren.
3. Die Benutzer-ID des angelegten Kontos in der SQL-Ansicht als Admin eintragen:

   ```sql
   insert into public.wish_admins (user_id)
   values ('UUID-DES-ADMIN-BENUTZERS');
   ```

Danach kannst du dich unter `/#/admin` anmelden. Nur Benutzer, deren ID in `wish_admins` steht, erhalten Zugriff auf die Admin-Daten. RLS beschränkt zusätzlich den Tabellenzugriff.

## GitHub Pages

1. Das Repository auf GitHub hochladen.
2. In **Settings → Pages** als Quelle **GitHub Actions** wählen.
3. Unter **Settings → Secrets and variables → Actions → Variables** diese Repository-Variablen anlegen:
   - `VITE_SUPABASE_URL` = `https://zwsjiygcegpwtxpxccxt.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = Publishable Key aus den Supabase Project Settings
4. Änderungen in den Branch `main` pushen. Der Workflow baut und veröffentlicht `dist` automatisch.

GitHub Pages hostet nur die statische Oberfläche. Datenbank und API laufen in Supabase. Der Publishable Key darf im Browser verwendet werden; ein Secret- oder Service-Role-Key gehört niemals in die Frontend-Variablen oder in GitHub Actions Variables.

## Funktionen

- Artikel sind in der Datenbank über `sort_order` geordnet; der Admin kann sie per Drag-and-Drop sortieren. Die vollständige Reihenfolge wird in einem Batch-RPC validiert und transaktional gespeichert.
- Reservierungen werden atomar vorgenommen. Zwei gleichzeitige Reservierungen können denselben Artikel nicht doppelt belegen.
- Die öffentliche API liefert keine Namen oder E-Mail-Adressen, sondern nur den Reservierungsstatus. Schenkerdaten sind nur im Admin-Bereich sichtbar.
- Artikel, Links und Preise können bearbeitet, ergänzt und gelöscht werden. Reservierungen lassen sich zurücksetzen.
- Der INZONE H9 II ist als Hauptwunsch markiert.

## Projektstruktur

```text
src/
  components/AdminDashboard.tsx
  lib/api.ts
  lib/demo-items.ts
  lib/supabase.ts
  lib/types.ts
  App.tsx
  main.tsx
  styles.css
supabase/
  config.toml
  migrations/
    20261112182812_create_wishlist.sql
    20261112182931_admin_rls.sql
.github/workflows/deploy.yml
setup.ps1
```
