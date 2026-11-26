# AI platforma — Uni AI i AI administracija

Konačan plan izrade, usaglašen sa Markom Lukićem (2026-11-10 do 2026-11-26).
Ovaj fajl je jedini izvor istine za izradu. Odluke iz njega se ne preispituju bez korisnika.

---

## 1. Cilj

- Platforma dobija sopstveni AI sistem: **AI jezgro** koje sve čita iz baze, više provajdera i modela, piramidu agenata (master → sekcijski → servisni), bazu znanja, memoriju korisnika i potpunu kontrolu potrošnje.
- **Promena provajdera ne dira bazu.** Naša baza je jedini izvor istine za razgovore, pravila, znanje i potrošnju. Provajder je samo adapter.
- Korisnici AI koriste na jednom mestu: **Uni AI**. Sekcije platforme nemaju svoj chat; one su agenti iza master agenta.
- Sve se uvodi postepeno: prvo samo Marko, zatim par ljudi iz IT tima, pa ostali.

## 2. Ključne odluke

| Tema | Odluka |
|---|---|
| Provajder | **Anthropic API** (`@anthropic-ai/sdk`). Kredit 220 $ mesečno služi i za razvoj i testiranje; Console već blokira trošenje preko limita. |
| Claude CLI | Samo **rezervni adapter** (kad API ne radi ili nema kredita; Super admin prebacuje). Kod iz NOLEKO prototipa se prepravlja u adapter, ne baca se. |
| Lokalni LLM | Kasnije, takođe preko API-ja: adapter „OpenAI-kompatibilni" (Ollama, vLLM). Sada samo oznaka sekcije „osetljivi podaci" i spisak dozvoljenih provajdera po sekciji. |
| API ključ | Jedan `ANTHROPIC_API_KEY` u `.env`, isti za dev i prod. Baza čuva samo **naziv** promenljive. `.env` se nikad ne čita ni ispisuje; ključ upisuje korisnik. |
| Lažni provajder | **Ne pravi se.** Testira se na pravom API-ju. |
| Pristup | Sekcija **AI ADMINISTRACIJA** samo Super admin. Stranica **Uni AI** kroz role (stavka u katalogu dozvola). |
| Korisnički razgovori | Samo u Uni AI: nova, preimenuj, obriši, zvezdica (zadrži). |
| Master agent | **Koordinator**: sekcijske agente poziva kao alate (može više njih, paralelno) i sastavlja odgovor. Vidi **samo sekcijske agente dozvoljene korisniku** (filtrira kod pre poziva). Sekciji šalje samo podzadatak, ne ceo razgovor. Brz, jeftin model (Haiku 5.5, nizak trud). Opcija „pitaj direktno" jednog sekcijskog agenta. |
| Smer poziva | Samo nadole: master → sekcijski → servisni. Nikad nagore. Ograničena dubina, zabrana petlji, budžet lanca. |
| Memorija korisnika | Tri nivoa: lična (cela Uni AI), sekcijska, konverzacijska. Agent predlaže nivo, upis **tek posle potvrde korisnika**. Panel „Moja memorija". Ograničena veličina po nivou. Uvek ispod pravila. Super admin vidi **samo broj stavki i veličinu**, ne sadržaj. |
| Izmena pravila | Važi odmah i za otvorene razgovore: provera verzija pri **svakom** pozivu, sistemska napomena agentu i neutralna oznaka „Pravila su ažurirana" u chatu. Pravila idu **nacrt → probni upit / test skup → Objavi**, sa povratkom na prethodnu verziju. Verzije se upisuju uz svaki poziv. |
| Potrošnja korisnika | Korisnik vidi **samo procenat svog limita**, bez dolara. Dolare vidi Super admin. |
| Čuvanje | Korisnički razgovori 180 dana od poslednje aktivnosti (zvezdica izuzima), najviše 200 po korisniku. Brisanje od strane korisnika = odmah trajno. `ai_runs` bez sadržaja 90 dana. Mesečni zbirovi trajno. Sadržaj jednokratnih servisnih zadataka 30 dana. Noćno čišćenje kao zakazani servis. Oznaka „ističe za X dana" 14 dana pre. |
| Odlazak korisnika | Noćna provera preko Graph-a (aplikacija već ima `User.Read.All`): nalog isključen ili obrisan → posle 30 dana brišu se memorija i razgovori. |
| Lični podaci | **Matični broj (employee_no) i imena zaposlenih nikad ne idu AI provajderu** — maskiraju se (vidi poglavlje 8). **MTS brojevi isključeni** iz prve verzije. |
| Unapređenje | 👍/👎, „Ispravi", opcija „Podeli ovaj primer radi unapređenja" (samo podeljeni primeri idu agentima za unapređenje). Agenti za unapređenje jednom nedeljno + ručno. Pravila se nikad ne objavljuju automatski. |
| Pretraga znanja | **Bez vektorske baze za sada.** Sloj za pretragu je hibridan po dizajnu: FTS5 (trigram) odmah; `sqlite-vec` u istom SQLite fajlu + lokalni višejezični embeddings (Ollama, CPU) kada stigne prvi skup dokumenata. AI nikad ne piše slobodan SQL. |
| Prva sekcija | **EVIDENCIJA** (bez MTS brojeva), alati samo za čitanje. |

## 3. Arhitektura

```
Uni AI (korisnici)     AI administracija (Super admin)     Kod platforme (pozadina, servisi)
        └──────────────────────┬────────────────────────────────────┘
                    AI JEZGRO (src/services/ai/)
  sastavljanje pravila po piramidi · memorija · znanje · alati · maskiranje
  budžet (pre poziva) · logovanje · provera verzija · rokovi i rezerva
                               │  interfejs provajdera
          Anthropic API adapter  |  Claude CLI (rezerva)  |  (kasnije) OpenAI-kompatibilni
```

### Piramida instrukcija (redosled u sistemskom delu, ujedno redosled za keš)

1. Globalna pravila platforme (Super admin) — ne mogu se zaobići
2. Pravila master agenta (Super admin)
3. Pravila sekcije (Super admin) — vrhovna za tu sekciju
4. Uloga servisnog agenta (kod servisnih sesija)
5. Znanje (podaci, ne naredbe; jasno označeno kao referentni materijal)
6. Memorija korisnika (najniži prioritet, uz napomenu da pravila iznad pobeđuju)
7. Razgovor

„Vrhovna pravila" se sprovode i tehnički: korisnički tekst nikad ne ulazi u sistemski deo; agent ima samo alate koje sekcija dozvoli; svaki alat u kodu proverava prava korisnika; strukturirani odgovori se validiraju.

### Interfejs provajdera

Jedan ugovor, otprilike: `run({ sistem (slojevi), poruke, alati, model, trud, oblik odgovora, signal za prekid, onDelta }) → { tekst, pozivi alata, tokeni (ulaz/keš upis/keš čitanje/izlaz), kontekst, model, id zahteva, stop razlog }`. Adapter prevodi naš neutralni format poruka i alata u format provajdera i nazad. Podaci samog provajdera (npr. ID CLI sesije) idu u `ai_provider_state` i smeju se obrisati.

## 4. Tabele (SQLite, `data/unipromet.db`)

Napomena: stare tabele prototipa se zovu `ai_conversations` i `ai_messages` i brišu se u F0. Nove tabele namerno nemaju ta imena.

| Grupa | Tabela | Ključne kolone |
|---|---|---|
| Provajderi | `ai_providers` | id, tip (`anthropic`, `claude_cli`, `openai_compat`), naziv, base_url, api_key_env, lokalni (0/1), uloga (`primary`/`reserve`), aktivan |
| | `ai_models` | id, provider_id, model_id (tačan naziv), naziv za prikaz, kontekst, max izlaz, cene (ulaz, izlaz, keš upis, keš čitanje po 1M), mogućnosti (json), status (`aktivan`/`zastareo`) |
| Struktura | `ai_sections` | id, permission_key (veza na katalog dozvola), naziv, osetljivi podaci, dozvoljeni provajderi (json), aktivna |
| | `ai_section_models` | section_id, model_id, podrazumevani |
| | `ai_agents` | id, vrsta (`master`/`section`/`service`/`improvement`), ključ, naziv, opis, section_id (nullable), model, trud, režim pamćenja (`trajna`/`bez_pamcenja`), šema ulaza/izlaza (json), kartica sposobnosti, aktivan |
| | `ai_agent_links` | caller_agent_id, callee_agent_id (koji agent sme da poziva kog; master → sekcije ide automatski po pravima korisnika) |
| Pravila | `ai_instructions` | id, nivo (`global`/`master`/`section`/`agent`), scope_id, naslov, objavljena verzija |
| | `ai_instruction_versions` | instruction_id, verzija, sadržaj, status (`nacrt`/`objavljeno`/`arhivirano`), procena tokena, ko i kada |
| Znanje | `ai_knowledge` | id, naslov, tip (tekst/dokument/generisano), izvor, objavljena verzija, važi od, procena tokena |
| | `ai_knowledge_versions` | knowledge_id, verzija, sadržaj, status, ko i kada |
| | `ai_knowledge_chunks` | knowledge_id, verzija, redni broj, tekst, kontekst-rečenica, strana/poglavlje (kolona za vektor dolazi u F4b) |
| | `ai_knowledge_links` | knowledge_id, target_type (`section`/`agent`), target_id |
| | `ai_knowledge_fts` | FTS5 (trigram) nad delovima |
| Razgovori | `ai_sessions` | id, vrsta (`user`/`service`), user_id, user_email, agent_id (master ili direktni), naslov, provider_id, model_id, zvezdica, status, created_at, last_activity_at, poslednji kontekst (tokeni/prozor), verzije pravila (json) |
| | `ai_session_messages` | id, session_id, uloga, sadržaj (neutralni json: tekst, prilozi, pozivi alata), agent_id, run_id, created_at |
| | `ai_pseudonyms` | session_id, token (npr. `Z-17`), vrsta (`employee`), lokalna referenca (employee_no) — nikad ne ide provajderu |
| Memorija | `ai_user_memory` | id, user_id, nivo (`personal`/`section`/`session`), scope_id, sadržaj, izvor (`manual`/`file`/`agent`), procena tokena, created_at |
| Unapređenje | `ai_feedback` | run_id, user_id, ocena, razlog, ispravka, podeljeno (0/1) |
| | `ai_test_cases` | section_id, vrsta (`obican`/`napadni`), pitanje, očekivano / kriterijum, izvor |
| | `ai_test_runs` | verzija konfiguracije, rezultat, cena, trajanje, detalji |
| | `ai_proposals` | agent_id, vrsta (znanje/pravilo/model/alat), sadržaj, rezultat testa, status (`na_cekanju`/`odobren`/`odbijen`) |
| | `ai_findings` | tabla nalaza: sadržaj, izvor (agent), sekcija, važi do |
| Potrošnja | `ai_runs` | id, root_run_id, parent_run_id, session_id, user_id, poreklo (`user`/`service`/`code`), agent_id, section_id, provider, model, tokeni (4 vrste), **cena izračunata u trenutku poziva**, trajanje, status, greška, verzije, id zahteva provajdera, created_at — **bez sadržaja** |
| | `ai_usage_monthly` | mesec, dimenzija (korisnik/sekcija/agent/model), tokeni, cena — trajno |
| | `ai_budgets` | scope (`global`/`section`/`agent`/`user`), scope_id, period (`day`/`month`), limit $, prag upozorenja %, akcija (`warn`/`block`) |
| Keš | `ai_provider_state` | session_id, provider_id, podaci (json) — sme se obrisati |
| Audit | postojeći `audit_log` | sve izmene konfiguracije (pravila, agenti, modeli, budžeti) |

## 5. Faze izrade

Za svaku fazu: test na dev-u (https://192.168.120.98:3000), unos u `CHANGELOG.md` `[Neobjavljeno]`, zatim tekst za sesiju „GitHub release agent" (git i izdanja radi isključivo ona).

### F0 — Uklanjanje NOLEKO prototipa

- Ukloniti stranicu „AI agent prototip": stavka `noleko.agent_prototip` iz `permissionCatalog.ts`, pravilo `/ai-agent/**` iz `routeAccess.ts`, ruta iz `routes/index.ts`, `aiAgent.routes.ts`, `aiAgentDb.ts`, `public/js/aiAgent.js`, CSS, deo u `index.html`, `app.js` (tabInfo, tabSectionMap, activateTab) i `access.js`.
- Obrisati redove `role_permissions` sa ključem `noleko.agent_prototip`.
- Obrisati tabele `ai_conversations`, `ai_messages` i folder `data/ai-agent-workspace` (razgovori nisu bitni).
- Logiku pokretanja CLI-ja iz `aiAgentService.ts` sačuvati za rezervni adapter u F1 (premestiti, ne brisati).
- Stranice „AI razvojni plan" i „Fazni razvoj" ostaju netaknute.
- Korisnik sam uklanja `CLAUDE_CODE_OAUTH_TOKEN` iz `.env` samo ako odluči da CLI rezerva ne treba (za sada ostaje, jer je CLI rezerva).

### F1 — Temelj (jezgro, tabele, provajderi)

- Paket `@anthropic-ai/sdk`. Korisnik dodaje `ANTHROPIC_API_KEY` u `.env` na oba servera.
- Sve tabele iz poglavlja 4 (bez F4b vektora).
- Interfejs provajdera + **Anthropic adapter** (streaming, alati, strukturirani odgovori, keš) + **Claude CLI rezervni adapter**.
- Obračun cene po pozivu, upis u `ai_runs`, **provera budžeta pre poziva**.
- Rokovi po pozivu i alatu, delimični odgovori, automatski prelazak na rezervni adapter.
- Higijena konteksta od starta: redosled slojeva za keš, keš 1h za česte sekcije, praćenje stope pogodaka.
- Početni podaci: provajder Anthropic (primary) i Claude CLI (reserve); modeli Haiku 5.5, Sonnet 5.5, Opus 5.5 sa cenama; master agent na Haiku 5.5 sa niskim trudom; globalni budžet 200 $ na prod-u, 20 $ na dev-u; lični limit 0,50 $ dnevno / 5 $ mesečno (IT tim više).

### F2 — AI ADMINISTRACIJA (samo Super admin)

Nova sekcija u bočnom meniju sa tri stranice (API rute nisu u `routeAccess` pravilima → automatski samo Super admin; nema stavki u katalogu dozvola):

- **AI agent menadžment** — provajderi i modeli (test veze, status zastareo), globalna pravila, master agent, servisni agenti (probni upit), baza znanja, predlozi za unapređenje.
- **AI sekcije** — sekcije, pravila sa nacrtom / probnim upitom / objavom / povratkom, dozvoljeni modeli i provajderi, osetljivi podaci, znanje, servisni agenti, budžeti, test skup (obični + napadni), broj otvorenih sesija i memorija (samo broj i veličina), **testiranje kao rola**.
- **AI logovi** — pozivi i stablo lanca poziva, greške, potrošnja po korisniku / sekciji / agentu / modelu, najskuplji pozivi, ušteda od keša, procena preostalog kredita (ručno unet iznos i datum), dnevnik izmena konfiguracije.

### F3 — Uni AI + sekcija EVIDENCIJA

- Stranica **Uni AI** (stavka u katalogu dozvola, pristup kroz role): spisak konverzacija (nova, preimenuj, obriši, zvezdica, „ističe za X dana"), odgovor se ispisuje dok nastaje, prikaz popunjenosti konteksta, **procenat ličnog limita**.
- Master kao koordinator, **paralelni** pozivi sekcija, **JSON ugovor** između agenata `{odgovor, cinjenice, izvori, sigurnost, sta_nedostaje}`, opcija „pitaj direktno".
- **Brza staza**: master dobija i direktne alate za prostu pretragu (samo dozvoljene korisniku).
- Provera verzija pri svakoj poruci, napomena „Pravila su ažurirana".
- Memorija na tri nivoa + panel „Moja memorija" + upload `.md`/`.txt`.
- 👍/👎, „Ispravi", „Podeli ovaj primer radi unapređenja".
- **Linkovi ka platformi** u odgovorima (oprema, soba, linija otvaraju karticu stavke).
- Model poruka unapred predviđa priloge (slike, PDF) — sama funkcija kasnije.
- Sekcijski agent **Evidencija** (poglavlje 7) i početni test skup (25–30 običnih + 10–15 napadnih pitanja).

### F4 — Baza znanja

- Sloj za pretragu kao poseban modul (`pretrazi znanje za pitanje u sekcijama koje korisnik sme da vidi`), sa zamenljivom pozadinom.
- FTS5 trigram, delovi dokumenata, **prava pristupa pre rangiranja**, **izvori u odgovoru** (dokument + strana), verzije i „važi od".
- Uvoz PDF/DOCX/TXT; skenirani PDF kroz postojeći OCR iz DMS-a (tesseract); kontekst-rečenica po delu (Haiku preko Batch-a).
- Automatski generisano „živo znanje" Evidencije (šifarnici, lokacije, zgrade, sobe, statistika) — noćno.
- **F4b** (kad stigne prvi skup dokumenata): `sqlite-vec` + lokalni embeddings (bge-m3 ili multilingual-e5 preko Ollama-e) + hibridna pretraga.

### F5 — Servisni agenti i unapređenje

- `ai.callService(kljuc, ulaz)` iz koda, sa validiranim JSON odgovorom; Batch za zadatke koji ne moraju odmah.
- Pozivi sekcija → servis po `ai_agent_links`, dubina, petlje, budžet lanca.
- Agenti za unapređenje (nedeljno + ručno): analitičar kvaliteta, urednik znanja, urednik pravila, optimizator (model/trud/keš/predlog novog alata).
- Svaki predlog se automatski pokreće na test skupu sekcije (tačnost, cena, vreme u odnosu na trenutnu verziju) i ide u „Predlozi za unapređenje".
- Kartice sposobnosti sekcija i primeri rutiranja za mastera, ažurirani iz povratnih informacija.
- Tabla nalaza `ai_findings`.

### F6 — Održavanje i proširenja

- Noćni zakazani servisi (seed u `scheduledServicesDb.ts` + grana u `unifiedSchedulerManager.ts`; na dev-u je scheduler isključen): čišćenje (180 / 90 / 30 dana), mesečni zbirovi, provera odlaska korisnika preko Graph-a (30 dana zaštite).
- Mejlovi Super adminu (postojeći `mailService`): 80% i 100% budžeta, nagli porast grešaka, API ne radi, prelazak na rezervu, model označen kao zastareo.
- Kasnije, po merenju: eskalacija Haiku → Sonnet / savetnik, agenti pokretani događajima platforme, OpenAI-kompatibilni adapter za lokalni LLM, NOLEKO kao sekcija.

## 6. Potrošnja i kontrola

- Cena se računa u trenutku poziva iz `ai_models` i čuva uz poziv (promena cenovnika ne menja istoriju).
- Dva pogleda: **ko je izazvao** (korisnik — ceo lanac ide njemu; ili servis/kod) i **gde je potrošeno** (master, sekcija, servisni agent, model).
- Budžeti: globalni, po sekciji, po agentu, po korisniku (dan/mesec); po pitanju: maks. dužina odgovora, maks. broj poziva agenata, maks. dubina.
- 80% → upozorenje i mejl; 100% → odbijanje novih zahteva sa jasnom porukom (za servise: blokiraj ili samo javi, po podešavanju).
- Dev i prod imaju odvojene baze, a isti ključ: svaka strana broji samo svoje; „preostali kredit" je označen kao procena.

## 7. Sekcija EVIDENCIJA (prva)

Podaci (dev, 2026-11-24): `equipment` 1.413 (+ `equipment_details`, `equipment_history` 4.909, `equipment_categories`, `equipment_statuses`, `equipment_locations`, `equipment_buildings`, `equipment_rooms`), `equipment_software` 619, `equipment_lines` 37. Ljudi su vezani preko `employee_no` (imena iz Navision-a, `navisionService`).

Alati **samo za čitanje**; svaki alat postoji samo ako korisnik ima pravo na tu podsekciju (`evidencija.*` iz kataloga) i proverava prava u kodu:

| Podsekcija | Alati |
|---|---|
| Računarska i mrežna oprema | pretraga (zaposleni — preko tokena, inventarski broj, kategorija, lokacija, zgrada, soba, status, IP/MAC), detalji stavke, istorija stavke, brojanje i grupisanje |
| Čvorišta i linije | linije po sobi / čvorištu / patch panelu, trasa |
| Software | softver po uređaju, uređaji sa određenim softverom, licenciran ili ne — **`license_key` nikad ne ide modelu** |
| Šifarnici | kategorije, statusi, lokacije, zgrade, sobe |
| ~~MTS brojevi~~ | **isključeno iz prve verzije** |

- Najviše 50 redova po odgovoru + ukupan broj; sabiranje i skraćivanje u kodu.
- Opcioni „alat za upit sa filterima": samo dozvoljena polja i filteri, upit sastavlja kod.
- Izmene (zaduženje, razduženje) nisu u prvoj verziji; kasnije samo uz potvrdu korisnika u ekranu.
- Početno znanje: značenje kategorija i statusa, čitanje inventarskih brojeva i šifara soba, proces zaduženja/razduženja (opise piše Marko) + automatski pregled šifarnika.

## 8. Maskiranje ličnih podataka

- **Matični broj (`employee_no`) i imena zaposlenih nikad ne idu provajderu.**
- Alati umesto osobe vraćaju token (`Z-17`), stabilan unutar konverzacije (`ai_pseudonyms`). Model koristi token u sledećim pozivima alata; jezgro ga lokalno prevodi u `employee_no`.
- Platforma u ekranu zamenjuje token imenom i prezimenom (provera prava pri prikazu). Korisnik vidi ime, model je video samo token.
- Kad korisnik u pitanju napiše ime ili matični broj, jezgro ga pre slanja prepozna (spisak zaposlenih iz Navision-a) i zameni tokenom. Nepoznato ime ili nadimak → agent kaže da ne prepoznaje osobu.
- Slobodan tekst iz baze (komentari, istorija opreme) se pre slanja propušta kroz isto prepoznavanje imena i brojeva.
- Napadni test skup obavezno sadrži pokušaje izvlačenja matičnog broja i imena.

## 9. Uvođenje

1. Samo Marko (dev, pa prod).
2. Par ljudi iz IT tima.
3. Postepeno ostali korisnici, kroz role.

## 10. Pravila rada za sesiju koja gradi

- Sav UI prati postojeći dizajn platforme (nav-section / nav-tab-btn, CSS promenljive iz `public/css/base/variables.css`, komponente iz `public/css/components`, lucide ikone, srpska latinica).
- Nova `/api` ruta: pravilo u `src/services/routeAccess.ts` (bez pravila = samo Super admin). Nova stranica: `permissionCatalog.ts` + `index.html` + `app.js` (`tabInfo`, `tabSectionMap`, `activateTab`) + `access.js`.
- `public/` je odmah živ na dev-u (pravi `location.reload()`); `src/` traži `npx tsc --noEmit`, `npm run build` i restart dev servera.
- Nikad ne čitati ni ispisivati `.env`. Nikad ne raditi git ni izdanja — samo tekst za sesiju „GitHub release agent".
- Za Anthropic API koristiti skill `claude-api` (tačni nazivi modela bez datuma: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`; trud preko `output_config.effort`; na Opus 5.5 i Sonnet 5.5 nema prinudnog `tool_choice` any/tool niti isključivanja razmišljanja; obrada `stop_reason: "refusal"`).
