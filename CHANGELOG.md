# Istorija verzija - UNIPROMET platforma

Svako puštanje na produkcijski server (spajanje `dev` → `main`) je nova verzija.
Brojevi verzija: `GLAVNA.MANJA.ISPRAVKA` (npr. 1.2.3)

- **ISPRAVKA** (1.0.0 → 1.0.1): ispravke grešaka i sitne izmene postojećih stranica
- **MANJA** (1.0.1 → 1.1.0): nova funkcionalnost (nova stranica, novi modul, nova opcija)
- **GLAVNA** (1.4.2 → 2.0.0): velike promene celog sistema, samo kad korisnik to odluči

Verzija se vodi u `package.json`, a svaka puštena verzija ima git tag `vX.Y.Z` i GitHub Release.
Verzija se vidi na platformi (bočna traka i Kontrolna tabla → informacije o sistemu) i u mejlu „Server ažuriran“.

## [Neobjavljeno]
- Gornja traka i Kontrolna tabla prikazuju zvaničnu adresu portala iz `PUBLIC_URL` (na serveru `https://portal.unipromet.local`) umesto IP adrese i porta 3000
- Nova sekcija u meniju „NOLEKO AI Development“ sa stranicama AI agent prototip, AI razvojni plan i Fazni razvoj (Fazni razvoj za sada prazan); dodata i u prava pristupa po rolama
- NOLEKO AI → AI razvojni plan: prikaz plana implementacije (iz Word dokumenta) sa sadržajem odeljaka, tabelama i kontrolnom listom; dugme Izmeni otvara uređivač sa pregledom uživo (samo uz nivo Izmena), svaka izmena je nova verzija sa istorijom i mogućnošću vraćanja stare verzije
- NOLEKO AI → AI agent prototip: chat sa AI agentom preko Claude Code CLI (lični razgovori sačuvani u bazi, indikator čekanja dok ne stigne ceo odgovor, dugme Stop, status agenta, izbor modela Sonnet/Opus/Haiku i nivoa truda Low/Medium/High/Extra/Max po poruci, indikator popunjenosti konteksta razgovora); agent radi bez alata i bez pristupa podacima platforme. Na serveru traži instaliran Claude CLI i `CLAUDE_CODE_OAUTH_TOKEN` u `.env`
- Kamere → „Pronađi Novu Kameru“: pretraga ide sporije i ravnomerno zbog Sophosa: jedna nova adresa na 250 ms, najviše 3 u isto vreme, bez obzira na to kako mreža odgovara; za 125.x duže čekanje odgovora (1 s), da spore kamere ne promaknu. Opseg je isti (124.11–230, 125.46–246). Redovna provera kamera iz evidencije nije menjana
- Kamere → spisak pronađenih novih kamera: posle upisa jedne kamere (ili odustajanja) spisak se ponovo otvara sa preostalim kamerama, pa se sve mogu upisati bez novog skeniranja. Adrese pronađenih kamera se beleže i u log servera

## [1.0.2] - 2026-10-29
- Štampač KV uprava (Canon iR C5235i, 192.168.121.40): greška „izlazna fioka prepunjena“ se privremeno ne prijavljuje mejlom (kvar čeka servisera)

## [1.0.1] - 2026-10-29
- deploy.log beleži ishod mejla o ažuriranju: poslat (sa odgovorom SMTP servera), greška, ili primalac nije podešen

## [1.0.0] - 2026-10-28
Prva zvanična verzija, puštena na produkcijski Linux server (192.168.121.26).

- Mreža: računari, serveri, ostali uređaji, štampači, kamere i snimači, RF čitači, WiFi pristupne tačke, svičevi
- Evidencija: računarska i mrežna oprema, čvorovi, linije, MTS brojevi, softver, šifarnici
- Video nadzor: kamere uživo i monitoring (tabovi sa rasporedom kamera, rotacija tabova, zaseban prozor sa rotacijom)
- Server: kontrolna tabla, zakazani servisi, logovi, podešavanja, uloge i prava pristupa
- Prijava preko Microsoft naloga (Entra ID), prava po ulogama
- Automatsko ažuriranje servera sa GitHub grane `main`, dnevni backup baze, rotacija logova
- UNIPROMET ikonica na svim tabovima pretraživača
- Prikaz verzije platforme u bočnoj traci i na Kontrolnoj tabli; verzija u mejlu o ažuriranju servera
