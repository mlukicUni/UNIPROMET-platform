# Plan optimizacije platforme — brzina učitavanja, odzivnost, potrošnja resursa

Datum: 2026-11-26. Stanje koda: verzija 1.3.20, grana `dev`.
Nastalo čitanjem celog koda (frontend, backend, baza, pozadinski poslovi, kamere/video, DMS, AI, deploy). Ništa nije menjano.
Tri nezavisna pregleda dala su iste glavne nalaze; ključne tvrdnje (označene ✔) proverene su direktno u izvornom kodu.

**Pravilo plana: nijedna funkcionalnost se ne sme promeniti.** Zato je svaka stavka označena rizikom i načinom provere, a posao je podeljen na male, odvojeno puštane celine (po jedna verzija) koje se prvo testiraju na dev serveru.

---

## 1. Sažetak — gde se gubi vreme

| # | Nalaz | Efekat |
|---|---|---|
| 1 | Nema kompresije odgovora ✔, a JS/CSS/HTML idu sa `no-store` ✔ | Svako otvaranje/F5 vuče ~2,4 MB (gzip bi bio ~0,45 MB) bez ikakvog keširanja |
| 2 | `lucide@latest` sa interneta (unpkg) u `<head>`, blokira prikaz ✔ | Prvi prikaz čeka internet; bez interneta ikone nikad ne stignu |
| 3 | Pokvaren regex u DMS keš proveri ✔ (`reportFiles.ts:121-122`, fale `\`) | Svaki zahtev za DMS izveštaj sinhrono parsira 5–10 MB; ~7 s po fajlu, **cela platforma stoji** dok neko otvara DMS |
| 4 | Svaki klik na meni pokreće `activateTab` dvaput ✔ (`app.js:726` + `796-808`) | Duplo dohvatanje podataka, duplo crtanje, kamere se montiraju/razmontiraju, 2× prinudni SNMP poziv na Switches |
| 5 | `initSchema()` bez zaštite ✔, zove se pri svakom video-zahtevu | ~0,3–1 ms i stotinak SQL naredbi na svaki frame/stream/listu kamera |
| 6 | Legacy MSSQL sinhronizacija se proverava svake 3 s ✔ i pri promeni ponovo prepisuje sve redove | Stalno opterećenje MSSQL .121.20, višesekundno blokiranje servera pri svakoj promeni |
| 7 | Pozadinska čestica-animacija 60 fps stalno, telemetrija `/api/status`+`/api/stats` svake 4 s na svakoj stranici ✔ | Trošenje CPU/GPU, posebno uz video i `backdrop-filter` |
| 8 | Svi moduli (~1 MB JS) i svih 59 modala (51% HTML-a) učitavaju se odmah, a podaci svih stranica se vuku i crtaju pri startu | Spor prvi prikaz i spor „time to interactive" |
| 9 | Veštačko kašnjenje 450 ms pri svakoj promeni stranice (`page-loader.js:21`) ✔ + 250 ms fade | Platforma deluje sporije nego što jeste |
| 10 | 4× `EventSource` ka istom endpointu, HTTP/1.1 ima samo 6 veza | Posle obilaska 4 stranice ostaju 2 veze za sve ostalo → nasumična „usporenja" |
| 11 | Svako otvaranje UI-ja može pokrenuti skeniranje kamera/LAN-a u zahtevu | Zahtev traje minutima, nepotreban saobraćaj preko Sophosa |
| 12 | Pregled kamera montira do 26 (CCTV) / 64 (monitoring) tokova, i skrivene/prekrivene plocice i dalje dekodiraju | CPU/RAM/mreža klijenta |

Baza sama (SQLite, ~2 MB lokalno) **nije** usko grlo; problem je trošak po pozivu, sinhroni rad na glavnoj niti i količina prenetih bajtova.

---

## 2. Faza 0 — Merenje pre bilo čega (pola dana)

Da bi se posle dokazalo da je bolje, i da bi se videlo da ništa nije pokvareno.

- Beleška „pre": Lighthouse (desktop) na `/#dashboard`; DevTools Network: broj zahteva i bajtova pri startu; Performance: 10 s mirovanja na dashboardu; otvoriti `#cctv_cameras` i `#cctv_monitoring`.
- Server: privremeno logovati `perf_hooks.monitorEventLoopDelay` (p95) i vreme po ruti; brojač SQL naredbi po zahtevu za `GET /api/inventory/cameras`, `GET /api/equipment`, i 3-sekundni legacy poll.
- Na produkciji (Linux .26) proveriti: veličinu `unipromet.db`, broj redova `audit_log`, veličinu `data/backups/snapshots` i `data/backups/daily`, verziju Node-a, da li Apache već radi `mod_deflate` za portal (ako radi, kompresija na Node-u se preskače za taj put).
- Spisak ručnog testa (odeljak 7) odraditi jednom pre izmena kao „polazno stanje".

---

## 3. Faza 1 — Brze pobede, nizak rizik (jedna verzija, ~1–2 dana)

**STATUS (2026-11-26): urađeno na dev serveru, nije puštano.** Sve stavke osim dve: **1.9 (`defer`) namerno preskočeno** — skripte su već pri dnu `<body>`, pa je dobitak zanemarljiv, a rizik stvaran (`document.readyState` više ne bi bio `loading`, pa bi se `init` pozivi u `equipment.js`, `software.js`, `monitoring.js` i dr. izvršavali pre nego što se učitaju ostali moduli); **1.16 (kašnjenje loadera) čeka odluku** iz odeljka 8. Dodato uz plan: DMS biblioteke (SheetJS, Chart.js) takođe lokalno. Provera: curl (kompresija, ETag/304, SSE, DMS keš, video proxy) i sintaksa JS-a; **ponašanje u pregledaču nije proveravano** (self-signed sertifikat blokira ugrađeni pregledač) — potreban ručni prolaz po stranicama.

Najveći efekat po uloženom trudu. Svaka stavka je mala i izolovana.

| ID | Izmena | Gde | Efekat | Rizik | Provera |
|---|---|---|---|---|---|
| 1.1 | Kompresija (gzip/brotli) za html/js/css/json; **isključiti** SSE (`/api/equipment/events`) i `/api/video-gateway` | `server.ts` (+ paket `compression`) | 2,4 MB → ~0,45 MB; DMS JSON 5–8 MB → ~1 MB | Nizak | `curl -H "Accept-Encoding: gzip" -I`; SSE i dalje „streamuje"; video radi |
| 1.2 | Statika: `no-store` → `no-cache` (ETag, 304) | `server.ts:171-180` | Ponovna otvaranja bez prenosa tela; i dalje nema starog JS-a posle deploya | Nizak | Drugi load pokazuje 304; posle deploya odmah novi kod |
| 1.3 | Popraviti regex u DMS kešu (`\d+`, `[\d.]+`) | `reportFiles.ts:121-123` | Nestaje sinhrono parsiranje 5–10 MB po zahtevu; DMS se otvara za ms umesto sekundi | Vrlo nizak | Dva uzastopna `/parsed`: drugi je brz, mtime keš fajla se ne menja |
| 1.4 | `initSchema()` jednokratno (`let ready=false`) | `schema.ts:6` | Nestaje ~100 SQL naredbi po video/kamera zahtevu | Vrlo nizak (resetovati flag ako se DB fajl menja u toku rada — camera-sync restore) | Broj SQL naredbi po zahtevu |
| 1.5 | Ukloniti duple klik-slušaoce na meniju | `app.js:796-808` (ostaju delegati na 726 i 785) | Pola poziva/crtanja pri svakom kliku; nestaje dupli prinudni SNMP | Nizak (proveriti da kategorije opreme `data-category-id` i dalje rade — rukuje ih delegat) | Network: svaki endpoint 1× po kliku |
| 1.6 | Ukloniti dupli `equipment.css` (uključen i preko `@import` i `<link>`) | `index.html:33` / `style.css:15` | −21 KB, manje blokiranja | Nizak (paziti redosled kaskade) | Pixel-poređenje glavnih stranica |
| 1.7 | Lucide: lokalna, **zakucana verzija** (`public/vendor/`), umesto `unpkg @latest`; isto za `login.html`, `monitor.html`, `access-denied.html` | `index.html:19` | Prvi prikaz više ne zavisi od interneta; nema 302 preusmerenja; stabilne ikone | Nizak (iste ikone, ista verzija koja se danas vuče) | Offline test: ikone se vide |
| 1.8 | Fontovi (Inter, Outfit, JetBrains Mono) lokalno + samo korišćene težine, `font-display:swap` | `index.html:14-16` | Nema spoljnog blokirajućeg CSS-a | Nizak | Isti izgled; offline radi |
| 1.9 | `defer` na sve skripte pri dnu `index.html` (redosled se čuva) | `index.html:8358-8403` | Parsiranje ne blokira; brži prvi prikaz | Nizak–srednji: proveriti da nijedna inline skripta ne koristi globale pre učitavanja | Smoke test svih stranica |
| 1.10 | Telemetrija (`/api/status`+`/api/stats`): samo kad je dashboard aktivan i tab vidljiv; interval 15 s; ne iscrtavati LAN listu ako nije promenjena | `app.js:175, 1312-1390, 2977` | Nema 30 zahteva/min po otvorenom tabu | Nizak | Network: bez zahteva na drugim stranicama |
| 1.11 | Čestice na pozadini: 30 fps, pauza kad je otvorena kamera/CCTV/monitoring ili modal, poštovati `prefers-reduced-motion` | `app.js:181-272` | Znatno manje CPU/GPU; uklanja stalno ponovno blurovanje | Nizak (samo izgled) | Performance + GPU pri mirovanju |
| 1.12 | `serverLogs` → kružni bafer (500–1000), `/api/logs` sa limitom; id kroz brojač | `system.routes.ts:9, 81, 94` | Ukida „curenje" memorije i sve veći odgovor | Nizak | `/api/logs` ostaje isti za korisnika |
| 1.13 | Request logger: preskočiti polling putanje (`/api/status`, `/api/stats`, `/api/cameras/status`, video-gateway) | `server.ts:76-85` | Manje sinhronih upisa u log | Vrlo nizak | — |
| 1.14 | SQLite pragme: `cache_size` (~32 MB), `temp_store=MEMORY`, `mmap_size`, `journal_size_limit`; periodično `wal_checkpoint(TRUNCATE)` i `PRAGMA optimize` | `db/sqlite.ts:25-31` | Manje čitanja sa diska, WAL se ne razdvaja | Nizak | WAL ostaje uz DB po veličini |
| 1.15 | Servis: `NODE_ENV=production`; `uncaughtException`/`unhandledRejection` handleri koji loguju; `engines` u `package.json`; `http.keepAliveTimeout` 30–65 s | `deploy/unipromet-admin.service`, `server.ts` | Brži Express, manje nepotrebnih TLS rukovanja, bez nepotrebnih restarta | Nizak | `systemctl status`, test restarta |
| 1.16 | `tabMinVisibleMs` 450 → ~0–150 ms; ne prikazivati loader ako je stranica već popunjena; ukloniti 250 ms `fit()` interval | `page-loader.js:21, 97` | Promena stranice deluje trenutno | Nizak — **ali je odluka o izgledu (vidi odeljak 8)** | Klik→sadržaj vreme |

**Očekivani rezultat Faze 1:** prvi load sa ~2,4 MB na ~0,45 MB prenosa, ponovno otvaranje skoro bez prenosa, DMS bez zamrzavanja servera, klik na meni ~2× lakši, manje CPU u mirovanju.

---

## 4. Faza 2 — Srednji rizik, veliki efekat

**STATUS 2A (2026-11-27): urađeno na dev serveru, nije puštano:** 2.1 (korisnik jednom po zahtevu; keš sesije između zahteva namerno NIJE uveden), 2.2, 2.3, 2.4 (bez paralelnog probanja portova, zbog Sophosa), 2.5, 2.6 (samo keširane prepared naredbe; TTL mapa kredencijala namerno preskočena), 2.13, 2.15 (samo `nice` za build). Delimično: 2.12 (samo `selfsigned`; `exceljs` i `mssql` nisu lazy). **Nisu rađeni:** 2.7 (čeka odluku o Graph intervalu), 2.14 (čeka odluku o retenciji), 2.8, 2.9, 2.10 (video — ostavljeno dok se ne razjasni zastoj videa), 2.11 (mesečni snimak preko scan locka). (2–3 odvojene verzije, ~1–2 nedelje)

### 2A. Backend (jedna verzija)

| ID | Izmena | Efekat | Rizik | Napomena / provera |
|---|---|---|---|---|
| 2.1 | Korisnik se rešava **jednom po zahtevu** (`req.sessionUser`), a `/api` kapija, `isUserAllowed`, `getOrRefreshCurrentUser`, `enforceRouteAccess` ga koriste; kratki (5–10 s) keš sesije sa poništavanjem pri odjavi/promeni role; memoizovan hash grupa | Sa ~3 SELECT-a, 4 HMAC-a i 3 JSON.parse po zahtevu na 1 | Nizak–srednji | **Odjava i promena role moraju odmah da deluju** — test |
| 2.2 | Legacy sync: interval 3 s → 15–30 s (ili samo webhook + `/sync-check`); ceo `pullFromLegacy` u **jednoj transakciji**; upis samo ako se red stvarno promenio; keširane prepared naredbe; `pool.close()` pre nove veze; eksponencijalni backoff kad je MSSQL nedostupan | Nema višesekundnog blokiranja, nema stalnih 28.800 upita/dan, WAL ne raste | **Srednji** | Test sa stvarnom izmenom na legacy strani; SSE osvežavanje ostaje isto; paziti na `[LEGACY_BRIDGE]` markere |
| 2.3 | Navision: kratki keš (30–60 s) za `searchEmployees(term)`; „prekidač" (preskoči 30 s posle greške umesto 5 s čekanja); mapa telefona po normalizovanom broju (umesto O(telefoni×zaposleni)); single-flight za punjenje keša | Pretraga opreme/MTS ne zastaje kad Navision ne radi; MTS lista/izvoz bez 1–3 s blokade | Nizak–srednji | Test sa blokiranim Navision hostom; podaci stari do par minuta (već prihvaćeno, TTL 5 min) |
| 2.4 | Stale-while-revalidate: `/api/cameras`, `/api/network/devices`, `/api/switches` odmah vraćaju poslednje podatke, osvežavanje ide u pozadini (preko postojećeg `acquireScanLock`); `/api/cameras/offline` vraća keširano; paralelno probati port 80 i 554 u `inspectCamera`. **Ne diraju se** „force=true" i „skeniraj sada" | Otvaranje platforme više ne pokreće minutni sken; manje probe-saobraćaja preko Sophos/WAN | Srednji (svežina podataka) | Eksplicitno pokrenut sken radi isto kao ranije |
| 2.5 | `POST /api/cameras/status`: upis u bazu samo pri promeni stanja ili novom probanju; ceo batch u jednoj transakciji | Do 120 upisa/30 s po korisniku → ~0; WAL | Nizak | „Od kada je offline" (`since`) ostaje isto |
| 2.6 | Keširane prepared naredbe samo na vrućim putanjama (`loadSession`, `lookupCameraBy*`, `getCameraCredentials`, `recordCameraStatus`, legacy petlja); TTL mapa ip→kredencijali/kamera (30–60 s, poništava se pri upisu u inventar) | Manje kompajliranja i čitanja po video zahtevu | Nizak | Promena lozinke kamere mora odmah da se primeni (poništavanje) |
| 2.7 | Graph: osvežavanje grupa korisnika na 5–15 min umesto 30 s; `AbortController` timeout; single-flight za token | Manje Graph poziva, nema 429 rizika | Nizak (grupe se osvežavaju sporije; ručno prinudno osvežavanje već postoji) | Potvrda sa korisnikom (odeljak 8) |
| 2.8 | Video gateway: restart go2rtc samo kad je proces stvarno mrtav ili posle 2–3 uzastopna neuspeha; kill po PID-u (ne `pkill -f`); keš zdravlja 5 s | Prolazno kašnjenje ne ruši sve tokove svih gledalaca | Nizak | Otvoriti više kamera uz opterećenje |
| 2.9 | Proxy ka go2rtc: `res.on('close')` zatvara upstream; body parseri ne smeju da progutaju telo za `/api/video-gateway` | Nema „zaostalih" potrošača u go2rtc-u | Nizak–srednji | Test WebRTC i MSE puteva |
| 2.10 | MJPEG `/live-stream`: rekurzivni `setTimeout` umesto `setInterval` (bez preklapanja) + poštovanje `res.write` povratne vrednosti; mikro-keš snapshot-a po IP (1–2 s) i dedup | Nema gomilanja zahteva ka sporoj kameri | Nizak | — |
| 2.11 | `cameraSnapshotService` mesečni snimak preko `acquireScanLock` | Ne preklapa se sa 11:00 skenom i proverom snimača | Nizak | Mesečno pokretanje ručno testirati |
| 2.12 | Lazy `import()` za `exceljs`, `mssql`, `selfsigned` | Podizanje servera ~3 s brže → kraći prekid pri auto-deployu | Nizak | Vreme do prve „listen" linije |
| 2.13 | Indeksi: `equipment(room_id, location_id, building_id, custom_code)`, `equipment_rooms(building)`, `equipment_buildings(location_id)`, `cameras(recorder_id)`; (kasnije ukloniti duplirane) | Brži filteri i brojanja kako tabele rastu | Nizak (`IF NOT EXISTS`) | `EXPLAIN QUERY PLAN` |
| 2.14 | Retencija: `audit_log` (npr. >18–24 meseca), čišćenje `data/backups/snapshots` (zadrži N), DMS: jedan `.json.gz` po izveštaju | Ograničen rast diska/baze | Nizak | Potvrda perioda zadržavanja (odeljak 8) |
| 2.15 | Deploy: `nice`/`ionice` za build na produkciji; atomska zamena `node_modules` (rename) umesto `rsync --delete` dok je servis zaustavljen; `MemoryHigh/MemoryMax` u servisu | Kraći prekid pri auto-deployu, manji uticaj na žive tokove | Srednji (testirati rollback) | Probni deploy |

**STATUS 2C (2026-11-27), na dev serveru, nije puštano:** 2.7 (Graph 10 min, timeout 15 s, single-flight tokena — odluka korisnika), 2.11 (mesečni snimak kroz scan lock, samo za zakazano), brisanje mrtvih `core/api.js` i `core/modal.js`. **Odluka korisnika: bez retencije (2.14 se ne radi).** Namerno preskočeno: keš logotipa za Excel (fajl od 5 KB, nema efekta), brisanje mrtvih tajmera u `schedulerService.ts`/`cameraSchedulerService.ts` (njihove status-funkcije koriste rute, pa bi se menjao odgovor API-ja).

**STATUS 2E (2026-11-27), na dev serveru, nije puštano:** 2.24 (CCTV lista: tok samo za pločice u vidnom polju + 200 px, `IntersectionObserver` u `app.js`; izlazak gasi tok i vraća sliku), čišćenje zaostalih `playback_*`/`export_*` tokova iz `go2rtc.yaml` pri pokretanju (odeljak 9, lozinke), ispravka `data.event` → `data.type` u `nodes.js` (odeljak 9). Provereno: stub test logike pločica (ulaz/izlaz/offline/brz ulaz-izlaz/odmontiranje) i test čišćenja na kopijama konfiguracije i na pravoj dev konfiguraciji. `.env` je u `.gitignore` i nije praćen. **Namerno preskočeno:** 2.30 (`iceServers`: WebRTC je samo rezerva posle MSE, nema efekta), pauza mreže ispod modala, 2.10. Ne diraju se DMS stavke (odluka korisnika).

**STATUS 2D, video (2026-11-27), PUŠTENO kao 1.3.26:** 2.23 (curenje `visibilitychange` u `video-rtc.js`), 2.25 (maksimizacija gasi skrivene ćelije), 2.8 (restart go2rtc-a samo kad je potreban), 2.9 (prekid veze ka go2rtc-u pri zatvaranju toka). Provereno: stub testovi za plejer i mrežu ćelija, na dev serveru restart pri ugašenom go2rtc-u (1 s), i da potrošači u go2rtc-u padaju na 0 odmah posle prekida klijenta. **Nije rađeno:** 2.24 (tokovi samo za vidljive pločice, snapshot u pločici, pauza mreže ispod modala), 2.10 (MJPEG preklapanje zahteva), 2.30 (`iceServers`). Ponašanje u pregledaču proverava korisnik ručno.

### 2B. Frontend (jedna verzija)

**STATUS 2B (2026-11-27), prvi deo, na dev serveru, nije puštano:** urađeno 2.20 (jedna SSE veza; `lines.js` i `software.js` slušaju događaj `equipment-sse-event` koji niko ne šalje, pa im uživo osvežavanje danas ne radi — namerno nije "popravljeno" da se ne uvede novi saobraćaj; `nodes.js` i dalje proverava `data.event`), deo 2.22 (`/auth/me` jednom pri pokretanju), 2.26 (blaga varijanta: 1 s i pauza kad je prozor skriven), 2.28 (samo spljoštavanje `@import`-a), 1.16 i skraćenje kašnjenja pretrage (odluke korisnika: 100 ms i 300 ms). **Nije rađeno (bez provere u pregledaču previše rizično):** 2.21 (crtanje skrivenih stranica pri startu), ostatak 2.22, 2.27, `backdrop-filter`, 2.29 (minifikacija), kao i video stavke 2.23–2.25 i 2.30. Korisnik ručno testira UI.

| ID | Izmena | Efekat | Rizik | Provera |
|---|---|---|---|---|
| 2.20 | **Jedan** `EventSource` (`core/events.js`) koji razašilje događaj postojećim modulima (`software.js` već sluša `equipment-sse-event`); zatvara se kad je tab skriven. Usput: `nodes.js:1605` proverava `data.event`, ostali `data.type` — proveriti da li uživo osvežavanje čvorišta uopšte radi | Oslobađa 3 od 6 HTTP/1.1 veza | Nizak–srednji | Network „events": 1 zahtev; uživo osvežavanje na Opremi/MTS/Mreži/Čvorištima |
| 2.21 | Pri startu **vući** podatke odmah (paralelno sa `/auth/me`), a **crtati** tek pri aktiviranju stranice (osim bedževa/KPI); podela jednog `/auth/me` obećanja između `access.js`, auth widgeta i DMS-a | Nema crtanja stotina kartica za stranice koje niko ne otvori | **Srednji** (neki KPI se ažuriraju unutar renderera) | Po stranici proveriti bedževe i brojeve |
| 2.22 | Deljeni `apiGet(url,{ttl})` (keš + dedup + timeout) za najčešće endpointe (`/api/inventory/cameras`, `recorders`, `/auth/me`); `core/api.js` je danas mrtav kod | Nema dupliranih zahteva | Nizak–srednji | Network |
| 2.23 | `video-rtc.js:303` — `visibilitychange` slušalac se nikad ne uklanja (curenje po svakom crtanju) → ukloniti u `disconnectedCallback` | Ukida curenje memorije | Nizak | Heap snapshot posle više promena stranice |
| 2.24 | CCTV: montirati tokove samo za **vidljive** plocice (`visibilityThreshold`/IntersectionObserver); ne vući živi snapshot ako stream startuje; pri otvaranju live modala pauzirati mrežu ispod; `stopLiveStreaming` mora zaista `destroy()` | Manje istovremenih WebRTC/MSE veza, manje CPU | Srednji (plocice se pokreću kad uđu u vidno polje) | `chrome://webrtc-internals` |
| 2.25 | Monitoring: pri maksimizaciji jedne ćelije `destroy` skrivenih (ostalih do 63), obnova pri povratku; manje 700 ms intervala po ćeliji | Do ~128 MB MSE bafera manje | Srednji | Maksimizuj/vrati više puta |
| 2.26 | `search-delay.js`: umesto `setInterval(500ms)` sa čitanjem layouta → `MutationObserver` + `focusin/input` | Nema stalnog forsiranja layouta | Nizak–srednji (polja čija se vrednost postavlja iz koda) | Dugme „X" u poljima za pretragu |
| 2.27 | Pretraga: preračunati normalizovani tekst po zapisu pri dohvatu (umesto NFD+regex po polju po kucanju); DMS `filterTableRows` bez `innerText`; `MutationObserver` u `dms/paging.js` i `dmsModule.js` samo nad DMS korenom i samo dok je DMS aktivan | Brže filtriranje, manje posla na svaku promenu DOM-a | Nizak–srednji | Isti rezultati pretrage („dj→d" pravilo!) |
| 2.28 | CSS: spljoštiti 8 `@import`-a u paralelne `<link>`-ove (ili jedan spojeni fajl); `backdrop-filter` ukloniti sa velikih tabela, KPI kartica i overlay-a iznad videa (zameniti poluprovidnom pozadinom); `transition: all` → konkretna svojstva | Brži prvi prikaz i glatkije kretanje uz video | Nizak (vizuelno) | Pixel-poređenje, GPU |
| 2.29 | Build korak (esbuild, već je u `node_modules`): minifikacija bez preimenovanja globalnih imena (inline `onclick` zavisi od njih) + **automatsko verzionisanje URL-a po mtime/hash-u** i `max-age` + `immutable` | JS ~1,6 → ~0,7 MB, CSS ~356 → ~270 KB; potpuno keširanje | Srednji (build + deploy tok, ručni `?v=` se zamenjuje) | Smoke test + posle deploya novi kod odmah |
| 2.30 | Mali: debug `console.debug` u `video-stream.js`/`equipment.js` ukloniti; pojedinačni `<style>` po `<video-stream>` u zajednički CSS; `iceServers: []` za LAN (prvo testirati); `unipromet_brand_bg.jpg` (90 KB) nije u upotrebi | Manje šuma, brži ICE | Nizak | — |

**Očekivani rezultat Faze 2:** server bez višesekundnih blokada (legacy, DMS, Navision, Excel nije još), udaljene zavisnosti uklonjene, manje veza i dekodiranja videa, manje zahteva pri startu.

---

## 5. Faza 3 — Veći zahvati, samo ako merenje pokaže da su potrebni

| ID | Izmena | Kada ima smisla |
|---|---|---|
| 3.1 | **Lazy učitavanje modula po stranici** (equipment, nodes, lines, mts, software, dictionaries, switches, networkEquipment, accessRoles/Overview, monitoring*, nolekoPlan, `dms/*` kao jedan paket) + prebaciti auto-init na `onTabActivated`; ~1 MB JS manje pri startu | Ako Faza 1–2 ne daju dovoljno brz prvi prikaz. **Rizik visok**: međusobni globali (`window.EquipmentModule.triggerSyncCheck()` itd.), inline `onclick`, duple funkcije (`escapeHtml`) — zahteva pažljiv red |
| 3.2 | Podela `index.html`: 59 modala (~51%) u šablone koji se ubacuju pri prvom otvaranju | Uz 3.1 |
| 3.3 | `worker_threads` za DMS OCR predobradu (`scanService`) i zip proveru; jedan `AdmZip` po poslu + TTL za `jobs` (150 MB); gašenje tesseract workera posle mirovanja | Ako se potpisi/skeniranje često koriste |
| 3.4 | Excel izvozi: keširan logo, `stream.xlsx.WorkbookWriter` ili worker | Ako izvozi (10.000 redova) blokiraju korisnike |
| 3.5 | Pretraga bez JS funkcije `unorm()` (kolona/tabela normalizovanog teksta ili memorijski keš) | Kad tabele pređu desetine hiljada redova |
| 3.6 | Straničenje kartica (računari, serveri, štampači, RF, WiFi…) ili `content-visibility:auto` | Ako liste postanu velike |
| 3.7 | HTTP/2 (`http2.createSecureServer` sa `allowHTTP1`) | Posle 2.20 verovatno nepotrebno |
| 3.8 | DMS: učitavati samo poslednjih N izveštaja (**promena ponašanja** — odluka korisnika) ili agregirati na serveru | Ako izveštaja bude mnogo |
| 3.9 | Brisanje mrtvog koda: `schedulerService.ts` i `cameraSchedulerService.ts` tajmeri nikad se ne pokreću (a statusi koje prijavljuju zbunjuju), `core/api.js`, `core/modal.js` | Higijena |

---

## 6. Šta se NE dira (zaštita funkcionalnosti)

- Raspored i sadržaj zakazanih zadataka, mejlova, skeniranja; „force"/„skeniraj sada" putanje.
- Logika prava pristupa (role, kamere, AD grupe): optimizuje se samo **koliko puta** se računa, ne **šta** se računa. Odjava i promena role moraju biti trenutne.
- Semantika pretrage (kvačice, „dj→d", reči odvojeno).
- Sadržaj Excel izvoza i izgled stranica (osim eksplicitno odobrene promene u odeljku 8).
- Vrednosti u legacy sinhronizaciji i SSE događaji — samo način i učestalost.
- Cluster/više procesa se **ne uvodi**: stanje je u memoriji (keševi skeniranja, `jobs`, SSE klijenti, jedan go2rtc proces).

---

## 7. Test i puštanje u rad

**Redosled puštanja:** Faza 1 → verzija 1.3.21; 2A → 1.3.22; 2B → 1.3.23; Faza 3 po stavkama. Svaka verzija: build, test na dev (.98), CHANGELOG, zatim tok kroz „GitHub release agent" (dev → main, auto-deploy na .26). Ja ne radim git; predajem tekst za agenta.

**Napomena:** na dev serveru su `SCHEDULER_ENABLED=false` i `LEGACY_SYNC_ENABLED=false`, pa se zakazani poslovi i legacy sync ne mogu proveriti prirodno — za 2.2, 2.4, 2.11 testirati ručnim pokretanjem na dev-u uz privremeno uključivanje na probnoj kopiji, a posle puštanja posmatrati logove na produkciji. Nikad ne uključivati scheduler/legacy sync na Windows dok je Linux produkcija.

**Ručni test (posle svake verzije), po stranicama:** prijava (SSO) i odjava; Dashboard; Računari/Serveri/Ostalo (pretraga); Štampači; Kamere, CCTV (pregled, live modal, playback, snapshot), Monitoring (tabovi, maksimizacija, popup prozor), `/kamera/<id>`; Oprema (filteri, izmena, izvoz u Excel, uživo osvežavanje kroz SSE); Mreža/Čvorišta/Linije/MTS/Softver/Rečnici/Switches; Pristup (role, kamere dozvole, izvoz); DMS (svih 7 izveštaja, potpisi, zakazani mailovi); NOLEKO/AI deo; različiti korisnici sa različitim rolama (proveriti da korisnik bez prava i dalje ne vidi/ne dobija podatke).

**Merenje:** ponoviti Fazu 0 i upisati „pre/posle" u ovaj fajl.

---

## 8. Odluke za korisnika (pre izrade)

1. **Veštačko kašnjenje loadera pri promeni stranice** (450 ms): skratiti na ~100 ms ili zadržati? (utiče na izgled prelaza)
2. **Kašnjenje kucanja u pretrazi** (`SEARCH_DELAY_MS = 800`): spustiti na ~300 ms za lokalne liste?
3. **Osvežavanje AD grupa korisnika:** 30 s → 10 min prihvatljivo? (promena grupe u AD-u važi do 10 min kasnije, ručno osvežavanje i dalje trenutno)
4. **Switches:** pri ulasku na stranicu pozivati bez `force=true` (prinudni SNMP samo na dugme „Osveži")?
5. **Retencija:** `audit_log` koliko meseci čuvati; koliko „pre-sync" kopija baze držati?
6. **Plocice kamera van vidnog polja** da ne streamuju dok se ne skroluje do njih — prihvatljivo?
7. **Apache** (portal.unipromet.local): da li već radi kompresiju? Ako ne, kompresija ide u Node-u (preporuka).

---

## 9. Usputno uočeno (nije optimizacija, ali vredi popraviti)

- `dms.routes.ts:128`: regex za proveru e-pošte ima isti propust (`[^s@]`, `.` bez `\`) — adrese koje sadrže slovo „s" tiho se brišu pri sinhronizaciji DMS korisnika.
- `switchService.ts:65-66`: keš čuva jednu vrednost i ignoriše argument `ip` — drugi switch može dobiti podatke prvog.
- `nodes.js:1605` proverava `data.event` umesto `data.type` (uživo osvežavanje čvorišta možda ne radi).
- `/api/stats` vraća delom izmišljene vrednosti (`activeConnections` je nasumičan broj, „1.420 pregledanih stavki" je konstanta).
- `go2rtc.yaml` trajno čuva `playback_*` tokove sa RTSP lozinkama u čistom tekstu ako se `stop-playback` ne pozove.
- Razvojna kopija je u OneDrive-u: `data/*.db-wal` i `node_modules` (244 MB) prave sync šum i rizik zaključavanja SQLite-a — razmotriti isključivanje iz OneDrive-a.
- `.env` sadrži `CLAUDE_CODE_OAUTH_TOKEN`; proveriti da je `.env` van repozitorijuma i da se ne deli.
