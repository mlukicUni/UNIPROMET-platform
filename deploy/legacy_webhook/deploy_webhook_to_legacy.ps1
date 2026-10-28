param(
    [string]$LegacyAppCode = "\\192.168.121.20\racunari_sajt\App_Code"
)

Write-Host "=== POSTAVLJANJE ASINHRONOG WEBHOOK MODULA NA STARI SERVER ===" -ForegroundColor Cyan
Write-Host "Ciljni folder: $LegacyAppCode"

if (-not (Test-Path $LegacyAppCode)) {
    Write-Host "UPOZORENJE: Folder $LegacyAppCode nije dostupan sa ove mreže. Proverite SMB deljenje." -ForegroundColor Yellow
    exit 1
}

$sourceFile = Join-Path $PSScriptRoot "UniprometWebhook.vb"
$destFile = Join-Path $LegacyAppCode "UniprometWebhook.vb"

# 1. Provera izvornog fajla
if (-not (Test-Path $sourceFile)) {
    Write-Host "GRESKA: Izvorni fajl $sourceFile ne postoji!" -ForegroundColor Red
    exit 1
}

# 2. Bezbedno kopiranje u App_Code
Copy-Item -Path $sourceFile -Destination $destFile -Force
Write-Host "✓ Fajl UniprometWebhook.vb je bezbedno postavljen u $LegacyAppCode" -ForegroundColor Green
Write-Host "`nASP.NET automatski kompajlira fajlove iz App_Code foldera bez potrebe za restartom IIS-a." -ForegroundColor Cyan
