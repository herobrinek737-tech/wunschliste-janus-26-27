# Wunschliste Janus 26/27

Eine deutsche React-Webseite mit öffentlicher Wunschliste, Reservierung per Formular, Admin-Anmeldung, Drag-and-Drop-Sortierung und Supabase-Backend. Die Oberfläche wird als statische Seite über GitHub Pages veröffentlicht.

## Supabase-Projekt

Das Projekt ist in der Organisation **Weinachtsapp** angelegt (Frankfurt, Projekt-Ref `zwsjiygcegpwtxpxccxt`). Die Datenbank enthält alle 14 Wünsche mit Platzhalterpreisen und die Migrationen aus `supabase/migrations/`.

Die Projekt-URL und der browsergeeignete Publishable Key stehen in `.env.example`. Die lokale Datei `.env.local` ist von Git ausgeschlossen. Niemals einen Secret- oder Service-Role-Key in die Frontend-Konfiguration eintragen.

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

Für den Admin-Zugang muss noch ein Auth-Benutzer im Supabase-Dashboard angelegt und als Admin eingetragen werden:

1. Unter **Authentication → Users** einen Benutzer anlegen und ein Passwort setzen.
2. Unter **Authentication → Settings** öffentliche Registrierungen deaktivieren.
3. Die Benutzer-ID des angelegten Kontos in der SQL-Ansicht als Admin eintragen:

   ```sql
   insert into public.wish_admins (user_id)
   values ('UUID-DES-ADMIN-BENUTZERS');
   ```

Danach kannst du dich unter `/#/admin` anmelden. Nur Benutzer, deren ID in `wish_admins` steht, erhalten Zugriff auf die Admin-Daten. Row Level Security (RLS) beschränkt zusätzlich den Tabellenzugriff.

## GitHub Pages

Das GitHub-Repository ist so eingerichtet, dass ein Push nach `main` automatisch die App aus `Weinachtswebseite/` baut und veröffentlicht. Die Pages-Quelle ist **GitHub Actions**; der Workflow liegt im Repo-Hauptordner unter `.github/workflows/deploy.yml`.

Die benötigten Actions-Variablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` sind im Repository hinterlegt. Die veröffentlichte Seite ist unter [herobrinek737-tech.github.io/wunschliste-janus-26-27](https://herobrinek737-tech.github.io/wunschliste-janus-26-27/) erreichbar, sobald der Workflow erfolgreich abgeschlossen ist.

GitHub Pages hostet nur die statische Oberfläche. Datenbank und API laufen in Supabase. Der Publishable Key darf im Browser verwendet werden; ein Secret- oder Service-Role-Key gehört niemals in die Frontend-Variablen oder ins Repository.

## Funktionen

- Artikel sind über `sort_order` geordnet; der Admin kann sie per Drag-and-Drop sortieren. Die vollständige Reihenfolge wird in einem Batch-RPC validiert und transaktional gespeichert.
- Reservierungen werden atomar vorgenommen. Zwei gleichzeitige Reservierungen können denselben Artikel nicht doppelt belegen.
- Die öffentliche API liefert keine Namen oder E-Mail-Adressen, sondern nur den Reservierungsstatus. Schenkerdaten sind ausschließlich im Admin-Bereich sichtbar.
- Artikel, Links und Preise können bearbeitet, ergänzt und gelöscht werden. Reservierungen lassen sich zurücksetzen.
- Der INZONE H9 II ist als Hauptwunsch markiert.

## Projektstruktur

```text
.github/workflows/deploy.yml
README.md
Weinachtswebseite/
  .env.example
  .gitignore
  README.md
  index.html
  package.json
  setup.ps1
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
  tsconfig.json
  vite.config.ts
```
