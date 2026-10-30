/**
 * Početni sadržaj stranice NOLEKO AI → AI razvojni plan (Markdown).
 * Prenet iz dokumenta "NOLEKO_PRIVATE_AI_Plan_implementacije.docx" (radna verzija 1.0, oktobar 2026).
 * Upisuje se u bazu samo ako plan još ne postoji; dalje izmene se rade na platformi.
 */
export const NOLEKO_AI_PLAN_SEED = `# NOLEKO PRIVATE AI 1.0 i NOS 2030

**Plan implementacije AI**

*Radna verzija 1.0 · Oktobar 2026 · Živ dokument, dorađuje se*

## 1. Cilj i obuhvat

Cilj je uvođenje veštačke inteligencije u poslovanje kao kontrolisanog sloja iznad postojećih sistema. Zaposleni brže dolaze do pouzdanih informacija, a rukovodstvo dobija proverljive podatke za odlučivanje.

Obuhvat je NOLEKO i Unipromet. Implementacija počinje pilot projektom na jednom poslovnom procesu, a zatim se proširuje na ostale funkcije.

Plan ne menja poslovne sisteme (ERP, DMS). On ih povezuje, a upis u njih ostaje pod kontrolom odgovornih lica.

## 2. Principi

- Jedan zvanični izvor po tipu podatka: ERP za finansije i robu, CRM za prodajne aktivnosti, DMS za dokumentaciju. SharePoint služi kao portal, bez nekontrolisanih kopija.
- AI nasleđuje prava korisnika i ne prikazuje dokumente koje korisnik ne sme da vidi.
- U prvoj fazi AI samo čita i predlaže. Svaki upis, knjiženje, ugovor ili plaćanje zahteva odobrenje ovlašćenog lica i trag u evidenciji.
- Svaki odgovor AI o internom pravilu navodi izvor, verziju i datum. Ako izvor nije dostupan, to se jasno navodi.
- Oprema se ne kupuje i softver se ne razvija pre dokazanog pilota.
- Procesi se opisuju tekstualno, grafički i kontrolnim listama. Isti materijal služi za obuku.
- Arhitektura ne zavisi od jednog modela ili dobavljača.

## 3. Ciljna arhitektura

Zahtev korisnika prolazi kroz identitet i gateway, a zatim orkestrator bira izvor podataka ili agenta. Odgovor se vraća uz izvor, a svaki korak se beleži u evidenciji. Ako je potreban spoljni servis, zahtev ide isključivo kroz gateway, uz anonimizaciju kada je potrebno.

| Sloj | Funkcija | Komponente |
| --- | --- | --- |
| Korisnici | Pitanja, analize, izveštaji, zadaci | Teams, web portal, mobilni telefon |
| Identitet i ovlašćenja | Prijava, višefaktorska autentifikacija, prava po ulozi | Microsoft Entra ID |
| AI Security Gateway | Jedina tačka izlaza ka spoljnim servisima; pravila, anonimizacija, zaštita podataka, evidencija | Politike, lista odobrenih izvora, log |
| AI orkestracija i agenti | Razume zahtev, bira alat ili agenta | Agenti za kontrolu projekata, podataka i ugovora |
| Korporativno znanje (RAG) | Pretraga odobrenih dokumenata uz izvor i verziju | DocLoop, SharePoint, vektorska baza |
| Poslovni sistemi | Izvor istine; AI čita, upis samo po odobrenju | NAV 2016 (kasnije Business Central), CRM, Power BI, projektna dokumentacija |

## 4. Režimi rada

Osnovni režim je hibridni. Jezgro sistema radi i bez interneta, a pristup spoljnim izvorima postoji samo kroz kontrolisani gateway. Air-gapped režim se koristi samo za posebno osetljive procese.

| Režim | Internet | Model | Podaci napuštaju firmu | Primena |
| --- | --- | --- | --- | --- |
| Potpuno offline (on-prem) | Nije dostupan | Lokalni | Ne | Osetljivi procesi; demonstracija bez interneta |
| Hibridni (osnovni) | Samo kroz gateway, za odobrene izvore | Lokalni; spoljni po odobrenju | Samo kontrolisano i anonimizovano | Svakodnevni rad |
| Air-gapped | Fizički blokiran | Lokalni; ažuriranje kontrolisanim postupkom | Ne | Najosetljiviji podaci |

## 5. Oblasti primene i prioriteti

| Oblast | Problem koji se rešava | Prioritet | Faza |
| --- | --- | --- | --- |
| Projekti i marža | Praćenje troškova i marže po projektu; rano upozorenje na odstupanje od minimalne marže | Visok | Pilot |
| Kalkulacije, ponude i upiti | Priprema tehničkog upitnika i nacrta ponude; provera kompletnosti | Visok | Pilot |
| Šifarnici i podaci | Otkrivanje duplih šifara, nepotpunih i nepravilnih podataka | Visok | Prototip |
| Ugovori i predmeri | Izdvajanje obaveza, rokova, finansijskih uslova i rizika | Srednji | Prototip |
| Dokumentacija i procedure | Pretraga važećih procedura uz izvor; kontrola potpunosti | Visok | Temelji i pilot |
| Finansije i KPI | Katalog pokazatelja, dospela potraživanja, projektni cash flow | Visok | Prototip |
| Prodaja i CRM | Pipeline, aktivnosti, sledeći koraci za prilike | Srednji | Produkcija |
| Nabavka | Poređenje ponuda; kontrola cena i rokova dobavljača | Srednji | Produkcija |
| Zadaci i odobravanja | Registar zadataka, podsetnici, evidencija odluka | Srednji | Pilot |
| Obuka | Grafički tokovi, kontrolne liste, kratki testovi | Srednji | Kontinuirano |

## 6. Faze implementacije

Trajanja su okvirna i zavise od dostupnosti integratora i test podataka. Faza počinje tek kada se zatvori prethodna kapija.

### Faza 0: Priprema (10 radnih dana)

- Potvrda obima pilota, vlasnika projekta i pilot procesa.
- Inventar sistema i licenci; provera postojećih Microsoft 365 i Copilot mogućnosti.
- Tri ponude za iznajmljenu infrastrukturu i poređenje dobavljača.
- Bezbednosni okvir i troškovnik.

> **Rezultat:** potvrđena arhitektura za pilot, troškovnik i obim pilota. **Kapija 0.**

### Faza 1: Istraživanje i dizajn (dani 1–15)

- Inventar procesa (stanje pre uvođenja AI), mapa podataka i klasifikacija.
- Izbor pilot procesa i PV/BESS predmeta za simulaciju.
- Preliminarni ukupni trošak vlasništva (TCO).

> **Rezultat:** arhitektura i plan pilota. **Kapija 1:** odobrenje arhitekture.

### Faza 2: Temelji (dani 16–30)

- Registar dokumenata: procedure, obrasci, standardi; označene važeće i povučene verzije.
- Portal za pristup, minimalna CRM specifikacija i prototip.
- Test skup od najmanje 20 dokumenata i test prava pristupa.

> **Rezultat:** pouzdan izvor znanja i potvrđena prava pristupa. **Kapija 2:** bezbednosna provera.

### Faza 3: Prototip (dani 31–60)

- AI pretraga znanja sa izvorima i verzijama.
- CRM pilot i prvo čitanje iz ERP-a (samo za čitanje).
- Prototip KPI pokazatelja i grafički tok pilot procesa.

> **Rezultat:** funkcionalni prototip na test podacima. **Kapija 3:** prihvatni test.

### Faza 4: Pilot i odluka (dani 61–90)

- Agenti za kontrolu projekata, podataka i ugovora u ograničenoj upotrebi.
- Obuka korisnika i merenje rezultata.
- Konačni troškovi i plan širenja.

> **Rezultat:** merljiva korist i odluka o nastavku. **Kapija 4:** GO, MODIFY ili STOP.

### Faza 5: Proširenje (posle odluke GO)

- Proširenje na nabavku, projektovanje, kontroling i ostale funkcije.
- Prelazak sa NAV 2016 na Business Central bez ponovne izgradnje sistema.

Simulacija procesa na jednom PV/BESS predmetu počinje u prvoj nedelji, a prvi funkcionalni prototip do treće nedelje. Integracije mogu zahtevati više vremena od plana.

## 7. Kapije odlučivanja

| Kapija | Kriterijumi za prolazak | Odluka |
| --- | --- | --- |
| 0 | Potvrđen obim pilota, vlasnik, troškovnik i ponude dobavljača | Nastavak ili zadržavanje |
| 1 | Arhitektura potvrđena; mapa podataka i klasifikacija gotovi | Odobrenje arhitekture |
| 2 | Test prava prolazi; nema curenja kroz pretragu; MFA i log aktivni | Ulaz u prototip |
| 3 | Tačnost i izvori na test skupu; korisnost na pilot procesu | Ulaz u pilot |
| 4 | KPI merljivi; nema kritičnih bezbednosnih proboja; troškovi u okviru | GO, MODIFY ili STOP |

## 8. Pilot projekat

- **Proces:** od upita kupca do odobrene ponude za integrisano PV/BESS rešenje.
- **Funkcije:** kontrola projekta i marže, kontrola šifarnika i podataka, analiza ugovora i predmera.
- **Korisnici:** 3 do 5 ovlašćenih korisnika, na ograničenom skupu odobrenih procedura.
- **Testiranje:** najmanje 30 realističnih pitanja, 10 kontrolnih scenarija, 5 scenarija nedozvoljenog pristupa i 5 scenarija zastarelih dokumenata.
- **Modeli:** najmanje tri modela različitih veličina i jedan komercijalni model za poređenje. Izbor se zasniva na kvalitetu rada na srpskom jeziku, tačnosti, pouzdanosti strukturisanih izlaza, brzini i ceni po zadatku.

## 9. Tehnologija i infrastruktura

| Komponenta | Predlog | Napomena |
| --- | --- | --- |
| Računarski kapacitet | GPU klasa NVIDIA L40S 48 GB (alternativa A100 80 GB) u iznajmljenom privatnom okruženju | Bez kupovine pre pilota; konfiguracija se potvrđuje ponudama |
| Serverski deo | 16–32 vCPU, 64–128 GB RAM, 500 GB do 1 TB NVMe | Integracije i obrada dokumenata |
| AI softver | vLLM ili Ollama; vektorska baza Qdrant | Testirati oba rešenja |
| Operativni sistem | Ubuntu Server LTS | Standardna server platforma |
| Pristup | VPN, višefaktorska autentifikacija, ograničene IP adrese | Pristup samo ovlašćenim korisnicima |
| Backup | Šifrovan, sa definisanim rokom čuvanja | Plan oporavka se testira |
| Poslovni sistemi | NAV 2016 (samo čitanje), DocLoop, SharePoint, Microsoft 365, Dynamics 365 Sales, Power BI | Provera API-ja i licenci pre integracije |
| Projektni alati | SOLSET, NEO, PVSYST, CAD | Izvori podataka za pilot |

Iznajmljeni računarski kapacitet rešava samo računanje. Najveći rizici su kvalitet podataka i integracija sa poslovnim sistemima, pa im se prioritet daje u planu.

## 10. Budžet (planska procena)

| Stavka | Procena | Napomena |
| --- | --- | --- |
| Iznajmljena GPU infrastruktura, 90 dana | 900 do 2.700 € | 300 do 900 € mesečno; zavisi od režima korišćenja |
| Pomoćni server, skladište, backup, mreža, 90 dana | 630 do 1.800 € | Procesor i RAM, SSD, backup i mrežni saobraćaj |
| **Infrastruktura PoC, ukupno** | **1.530 do 4.500 €** | Potvrđuje se ponudama |
| Rad integratora, AI agenata i priprema podataka | Prema ponudama | Nije uključeno u infrastrukturu |
| **Ukupan poslovni PoC** | **30.000 do 40.000 €** | Procena do potvrde ponudama |

Svi iznosi su planska procena i potvrđuju se ponudama pre ugovaranja.

## 11. Merenje uspeha

Ciljne vrednosti se utvrđuju pre testa. Merljivi pokazatelji su:

- Tačnost odgovora uz navedeni izvor, na test skupu.
- Broj odstupanja koje korisnik potvrdi kao stvarna.
- Vreme pripreme ponude, predmera ili kalkulacije pre i posle uvođenja.
- Broj zastarelih dokumenata prikazanih kao važeći (cilj je nula).
- Broj bezbednosnih incidenata (cilj je nula kritičnih).
- Broj korisnika koji redovno koriste sistem u svom procesu.

## 12. Bezbednost i usklađenost

- Klasifikacija podataka: lični, finansijski, ugovorni i tehnički. Svaka klasa ima pravila pristupa i čuvanja.
- Usklađenost sa Zakonom o zaštiti podataka o ličnosti i pravilima čuvanja podataka.
- Višefaktorska autentifikacija, servisni identiteti i upravljanje tajnama.
- Enkripcija u prenosu i u mirovanju; evidencija svih upita i odgovora.
- Plan incidenta i test oporavka pre produkcije.
- Testovi napada kroz upit (prompt injection) i curenja podataka kroz pretragu.
- U pilotu je zabranjeno: autonomno plaćanje, potpisivanje ugovora, knjiženje i izmena šifarnika.
- Ugovor o obradi podataka sa dobavljačem infrastrukture, uz potpuno brisanje podataka po završetku.

## 13. Rizici i mere

| Rizik | Mera | Odgovornost |
| --- | --- | --- |
| Slanje poverljivih podataka spoljnom servisu | Gateway, anonimizacija, spoljni servis samo po odobrenju | IT |
| Curenje dokumenata kroz pretragu | Nasleđivanje prava, negativni testovi pre upotrebe | Administrator DMS i Microsoft 365 |
| Zastareli dokumenti prikazani kao važeći | Metapodaci o verziji i datumu; izvor uz svaki odgovor | Vlasnici procesa |
| Kašnjenje integracije sa ERP-om | Read-only servis; plan za Business Central | ERP stručnjak |
| Nedostatak kompetencija | Integrator za specifične delove; plan obuke | Vlasnik projekta |
| Nepouzdani rezultati modela | Test skup, kapija 3, ljudska provera rezultata | Vlasnici procesa |
| Odstupanje troškova | Tri ponude, provera dostupnosti i uslova | Tehnički vođa PoC |
| Duplirana evidencija | Jedan izvor po tipu podatka | Vlasnik projekta |
| Otpor promeni | Obuka, pilot na stvarnim zadacima, vidljivi rezultati | Vlasnici procesa |

## 14. Organizacija i odgovornosti

Mali interni tim vodi projekat. Angažuje se u okviru radnog vremena, uz spoljnog integratora za specifične delove.

| Uloga | Odgovornost |
| --- | --- |
| Sponzor (rukovodstvo) | Prioriteti, budžet, odluke na kapijama, prihvatanje rezultata |
| Vlasnik projekta | Vodi plan, koordinira sektore, izveštava o kapijama |
| Vlasnici procesa | Procedure, pilot slučajevi, KPI u svom procesu, kvalitet odgovora |
| IT Uniprometa | Arhitektura, bezbednost, integracije, testiranje i održavanje |
| ERP stručnjak | Mapiranje tabela i interfejsa; poznavanje prilagođenja NAV-a |
| Administrator DMS i Microsoft 365 | DocLoop, SharePoint, Teams, Entra ID, licence i dozvole |
| Tehnički vođa PoC | Ponude infrastrukture, konfiguracija okruženja, koordinacija integratora |
| Spoljni integrator (po potrebi) | Specifični konektori, agenti i dokumentovana primopredaja |

## 15. Promena i obuka

- Tri nivoa obuke: osnovna upotreba; rad sa izvorima i odgovornost za proveru; administracija.
- NOLEKO Academy: grafički tokovi, kontrolne liste i kratki testovi za svaki pilot proces.
- Poruka za zaposlene: AI pomaže u pripremi posla, a odluka ostaje na čoveku.
- Uključivanje sektora kroz radionice na stvarnim procesima, a ne kroz opšte prezentacije.

## 16. Odluke potrebne pre početka

- Potvrditi hibridni režim kao osnovu arhitekture.
- Imenovati vlasnika projekta i vlasnike procesa.
- Izabrati pilot proces i PV/BESS predmet.
- Potvrditi granicu za spoljne AI servise i pravila anonimizacije.
- Odobriti Fazu 0 i budžet pripreme.
- Potvrditi raspored faza; kalendarske datume odrediti posle Faze 0.

## 17. Otvorena pitanja

- Stvarni obim Microsoft 365 i Copilot licenci po korisniku.
- Da li DocLoop ima dokumentovan API za dokumente, metapodatke i tokove odobravanja.
- Koji NAV 2016 servisi (SOAP ili OData) mogu da se aktiviraju i kakav read-only pristup je moguć.
- Vremenski plan migracije na Business Central i uticaj na integraciju.
- Dostupnost GPU kapaciteta u regionu koji ispunjava zahteve za podatke.
- Uslovi ugovora sa dobavljačem infrastrukture, uključujući brisanje podataka.

## 18. Sledećih 10 radnih dana (Faza 0)

- [ ] Potvrditi vlasnika projekta i pilot proces.
- [ ] Popisati Microsoft 365 i Copilot licence po korisniku.
- [ ] Zatražiti potvrdu NAV servisa i read-only pristupa.
- [ ] Zatražiti dokumentaciju DocLoop API-ja.
- [ ] Izraditi zahtev za ponudu za iznajmljenu GPU infrastrukturu i poslati ga trima dobavljačima.
- [ ] Pripremiti listu najmanje 20 dokumenata za pilot test.
- [ ] Izraditi bezbednosni okvir i klasifikaciju podataka.
- [ ] Pripremiti troškovnik za tri godine: licence, implementacija, podrška.

## 19. O dokumentu

Ovo je radna verzija plana. Dorađuje se posle odluka iz odeljka 16 i rezultata Faze 0. Svaka promena trajanja, budžeta ili obima beleži se u novoj verziji dokumenta.
`;
