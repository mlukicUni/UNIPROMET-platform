# Istorija verzija - UNIPROMET platforma

Svako puštanje na produkcijski server (spajanje `dev` → `main`) je nova verzija.
Brojevi verzija: `GLAVNA.MANJA.ISPRAVKA` (npr. 1.2.3)

- **ISPRAVKA** (1.0.0 → 1.0.1): ispravke grešaka i sitne izmene postojećih stranica
- **MANJA** (1.0.1 → 1.1.0): nova funkcionalnost (nova stranica, novi modul, nova opcija)
- **GLAVNA** (1.4.2 → 2.0.0): velike promene celog sistema, samo kad korisnik to odluči

Verzija se vodi u `package.json`, a svaka puštena verzija ima git tag `vX.Y.Z` i GitHub Release.
Verzija se vidi na platformi (bočna traka i Kontrolna tabla → informacije o sistemu) i u mejlu „Server ažuriran“.

## [Neobjavljeno]

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
