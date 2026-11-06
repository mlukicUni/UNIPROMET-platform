# Istorija verzija - UNIPROMET platforma

Svako puštanje na produkcijski server (spajanje `dev` → `main`) je nova verzija.
Brojevi verzija: `GLAVNA.MANJA.ISPRAVKA` (npr. 1.2.3)

- **ISPRAVKA** (1.0.0 → 1.0.1): ispravke grešaka i sitne izmene postojećih stranica
- **MANJA** (1.0.1 → 1.1.0): nova funkcionalnost (nova stranica, novi modul, nova opcija)
- **GLAVNA** (1.4.2 → 2.0.0): velike promene celog sistema, samo kad korisnik to odluči

Verzija se vodi u `package.json`, a svaka puštena verzija ima git tag `vX.Y.Z` i GitHub Release.
Verzija se vidi na platformi (bočna traka i Kontrolna tabla → informacije o sistemu) i u mejlu „Server ažuriran“.

## [Neobjavljeno]

## [1.3.0] - 2026-11-06
- Korisnici i role: članovi AD grupe „DMS-Admins“ vide stranicu „Korisnici i role“, ali samo DMS role (obične role bez ijedne dozvole van sekcije DMS Analiza podataka i bez kamera). Mogu da ih prave, kopiraju, menjaju, brišu i dodeljuju korisnicima i AD grupama; u matrici dozvola vide samo sekciju DMS, a server odbija svaku dozvolu van nje. Pristup kamerama, grupe kamera, provera korisnika, evidencija i sve ostale role ostaju samo Super adminu. Ako Super admin DMS roli doda dozvolu van DMS-a, DMS administrator je više ne vidi
- Osvežavanje grupa korisnika iz Microsoft Entra: spisak grupa se zamenjuje novim, pa grupa iz koje je korisnik uklonjen nestaje i sa njom prava (ranije su se grupe samo dodavale, a uklonjene ostajale do nove prijave)
- Nova sekcija u meniju „DMS Analiza podataka“ (prenet samostalni projekat „DMS - analiza podataka“) sa pet stranica: Izveštaji i analitika (učitavanje DMS Excel izveštaja, vremenska linija, KPI kartice, trend i sedam pogleda: aktivnost korisnika, kreirani dokumenti po sektorima, nagle oscilacije, SEF statusi, vrste dokumenata, zaposleni, ispravnost dokumentacije), Korisnici i službe, Podsetnik za overu računa, Zakazani mailovi i Provera potpisa (elektronski potpisi u PDF-ovima iz zip-a i OCR skenova). Pristup preko rola (nova sekcija i akcije „Učitavanje i brisanje izveštaja“, „Slanje mejlova…“, „Slanje podsetnika“); mejlovi se šalju sa adrese platforme. Podsetnik administratorima 8., 9. i 10. u mesecu u 08:00 je novi automatski servis. Podaci stare aplikacije prenose se skriptom `src/db/migrateDmsFromFolder.ts` (zakazani mailovi se prenose isključeni). OCR jezički fajlovi su u `resources/tessdata`

## [1.2.1] - 2026-11-05
- Video nadzor → Monitoring: zatvoreni dodeljeni (deljeni) tab se ponovo otvara i preko dugmeta „+“: kad ih ima, „+“ otvara meni sa „Novi tab“ i spiskom zatvorenih dodeljenih tabova (sa imenom vlasnika); bez njih „+“ odmah otvara pravljenje novog taba kao ranije. Poruka posle zatvaranja to i kaže

## [1.2.0] - 2026-11-05
- Video nadzor → Lista kamera: uz svaku kameru dugme „Dodaj u monitoring tab“ otvara prozor za dodavanje u postojeći tab (izbor polja, zamena kamere ili proširenje rasporeda na sledeći šablon kad je tab pun) ili u novi tab sa izabranim šablonom; posle dodavanja poruka sa dugmetom „Otvori tab“. Dugme je sivo za kamere koje korisnik nema pravo da gleda uživo
- Evidencija kamera: novo dugme „Dodaj po IP adresi“ pored „Pronađi Novu Kameru“. Korisnik unese IP adresu, sistem proveri samo tu adresu (bez skeniranja opsega) i, ako je kamera nađena, otvara formu za unos detalja; ako kamere nema ili je adresa već u evidenciji, javlja to korisniku. Dozvoljene su samo adrese iz lokalnih mreža. Zahteva pravo izmene evidencije kamera
- Video nadzor → Monitoring: deljenje tabova sa rolama. Nova akcija „Deljenje tabova sa rolama“ (Uloge i prava → Monitoring) dozvoljava vlasniku taba (npr. šefu obezbeđenja) da u meniju taba (desni klik) ili dugmetom „Podeli“ pored „Izmeni“ izabere role; nude se samo role koje imaju pristup Monitoringu; uz svaku rolu piše za koliko kamera iz taba njeni članovi nemaju pravo uživo. Članovi izabranih rola vide taj tab pored svojih (plav, sa ikonicom deljenja i imenom vlasnika), samo za gledanje: mogu da ga uvećaju, otvore u zasebnom prozoru i uključe u rotaciju, da naprave svoju kopiju ili da ga sakriju za sebe (vraća se dugmetom sa okom u traci). Izmena kod vlasnika odmah važi za sve. Polja sa kamerama bez prava prikazuju „Nema pristupa“. Deljenja se upisuju u evidenciju (audit)
- Video nadzor → Monitoring → „Prečica za radnu površinu…“: prozor sa izborom pretraživača (Edge, Chrome, Opera ili Firefox) i komandom koja sadrži punu putanju do programa, pa je Windows čarobnjak „Create Shortcut“ prihvata (ranije je za „msedge“ javljao da fajl ne može da se nađe). Edge i Chrome otvaraju prozor bez adresne trake i tabova, Opera običan novi prozor (nema „app“ režim), Firefox preko celog ekrana (kiosk). Izbor se pamti
- Prijava ističe tek posle 7 dana bez korišćenja platforme; dok korisnik radi, rok se pomera (ranije je isticala 7 dana od prijave bez obzira na korišćenje)
- Prijava preko Microsoft 365: uvek se nudi izbor naloga, pa posle odjave može da se prijavi drugi nalog (ranije se automatski ponovo prijavljivao isti)

## [1.1.0] - 2026-11-02
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
