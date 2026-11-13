param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm wurde nicht gefunden. Installiere Node.js 22.12 oder neuer und starte dieses Skript erneut.'
}

if (-not (Test-Path '.env.local')) {
    Copy-Item '.env.example' '.env.local'
    Write-Host 'Die Datei .env.local wurde angelegt. Trage dort Supabase-URL und Publishable Key ein.'
}

npm ci
if ($LASTEXITCODE -ne 0) {
    throw 'npm ci ist fehlgeschlagen.'
}

if ($ProjectRef) {
    npx supabase link --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) {
        throw 'Supabase-Verknüpfung fehlgeschlagen. Melde dich vorher mit npx supabase login an.'
    }

    npx supabase db push --remote
    if ($LASTEXITCODE -ne 0) {
        throw 'Die Datenbankmigration konnte nicht übertragen werden.'
    }
}
else {
    Write-Host ''
    Write-Host 'Abhängigkeiten sind installiert.'
    Write-Host 'Für das Backend: npx supabase login, danach setup.ps1 -ProjectRef DEIN_PROJECT_REF ausführen.'
    Write-Host 'Die Supabase-Zugangsdaten für die Website kommen in .env.local.'
}
