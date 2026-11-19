# GeoTeren 3D

Interaktivni 3D model terena sa bušotinama, CPT/CPTu i DPSH-B ispitivanjima, interpretiranim geološkim modelom i geotehničkim presecima koji se crtaju mišem.

## Pokretanje

```powershell
npm install
npm run dev        # http://localhost:5178
```

Samostalna verzija (jedan HTML fajl, radi bez servera i bez interneta):

```powershell
npm run build      # → dist/index.html
```

## Šta radi

| | |
|---|---|
| **Teren** | Delaunay TIN iz topografskih tačaka (tačno kroz snimljene tačke), hipsometrija, izohipse (svaka 5. deblja), koordinatna mreža u GK koordinatama. Lokalni koordinatni početak sprečava gubitak tačnosti na koordinatama reda 7 456 000 m. |
| **Bušotine** | Stub po slojevima u bojama litoloških jedinica, NPV disk, ušće. |
| **CPT / CPTu** | 3D stub: poluprečnik ~ log q<sub>c</sub>, boja po SBTn zoni (Robertson 2009: q<sub>t</sub>, γ po Robertson & Cabal 2010, Q<sub>tn</sub>, F<sub>r</sub>, I<sub>c</sub> iterativno) ili po q<sub>c</sub>. |
| **DPSH-B** | Kvadratni stepenasti stub: širina i boja po N20 ekvivalentu. Podržani su zapisi N20 (standard, SRPS EN ISO 22476-2) i N10. |
| **Geološki model** | Zatvorena tela litoloških jedinica (blok-dijagram). Debljine se interpoliraju IDW metodom i slažu od terena naniže, pa model prolazi tačno kroz bušotine. Ima providnost, razmicanje slojeva i skrivanje pojedinih jedinica. |
| **Presek mišem** | Klikovi po terenu zadaju poligonalnu liniju (Shift = korak od 15°). Rezultat: 3D „zavesa“ sa teksturom profila i 2D profil (SVG) sa šrafurama, bušotinama, q<sub>t</sub> krivama, SBTn trakama, DPSH stubićima, NPV linijom, stacionažama, kotama terena i razmernikom. Istražni radovi iz koridora ±X m projektuju se na presek uz oznaku L/D i rastojanje. |
| **Izmena preseka** | Klik kod bušotine ili sonde (ili njene oznake) hvata teme tačno u ušće. Dok je presek otvoren, temena se prevlače mišem, desni klik briše teme, a dvoklik na liniju dodaje novo. |
| **NPV** | Diskovi u sondama i providna površ NPV (ravan trenda + IDW). Isti model daje i liniju NPV u preseku. |
| **Automatsko čuvanje** | Projekat se čuva u pregledaču (IndexedDB) i vraća pri sledećem otvaranju. Za prenos na drugi računar koristi se izvoz u `.json`. |
| **Odsecanje** | Odseca teren i model po ravni preseka. Dugme „⊥ 3D pogled“ postavlja kameru upravno na presek. |
| **Merenje** | Horizontalno i koso rastojanje, Δz i nagib između dve tačke. |
| **Izvoz** | Projekat (.json), CSV tabele (isti format kao za uvoz), profil u SVG/PNG, snimak 3D prikaza. |

Prečice: `P` presek · `M` merenje · `H` ceo model · `T` pogled odozgo · `Esc` zatvaranje.

## Formati za uvoz

Fajlovi se prevlače na prozor ili učitavaju preko dugmeta **Uvoz**, i može ih biti više odjednom. Vrsta tabele se prepoznaje po zaglavlju. Primeri svih formata nalaze se u `primeri/` (`npm run primeri`).

```
Tačke:            ID;tip;Y;X;Z;dubina;NPV          tip = B | CPT | DPSH
Slojevi bušotina: ID;od;do;sredina;opis
CPT / CPTu:       ID;dubina;qc;fs;u2               qc [MPa ili kPa — automatski], fs i u2 [kPa]
DPSH-B:           ID;dubina;N20   (ili N10)
Topografija:      Y;X;Z   ili   .xyz bez zaglavlja
Legenda (opc.):   sredina;naziv;boja;redosled
```

- Separator može biti `;`, `,` ili tab. Uz `;` dozvoljen je decimalni zarez.
- Gaus-Krigerove koordinate (Y = istok, X = sever) prepoznaju se automatski. Kolone mogu da se zovu i `E;N`.
- NPV i dubine mere se od kote ušća. Z je kota ušća (ako nedostaje, uzima se sa terena).
- Ako nema legende, redosled jedinica određuje se po medijani dubine pojavljivanja, a šrafura po prvoj imenici u opisu („glina prašinasta“ → glina).
- Ako nema topografije, teren se interpolira iz kota ušća (ravan trenda + IDW) i aplikacija na to upozorava.

## Ograničenja (važno za tumačenje)

- Geološki model između bušotina je **interpretacija**. Ne može da predvidi sočiva i isklinjavanja koja nijedna bušotina nije zahvatila. U 2D profilu su interpretirane granice isprekidane.
- CPT i DPSH-B ne ulaze u interpolaciju slojeva. Služe za proveru modela.
- SBTn zone 2–7 određuju se po I<sub>c</sub>, a zone 1, 8 i 9 po približnim granicama na Q<sub>tn</sub>–F<sub>r</sub> dijagramu (Robertson 2010). DPSH klase su indikativne.

## Struktura

```
src/core/      terrain.js (TIN + raster upiti), geology.js (IDW model), cpt.js, dpsh.js
src/data/      io.js (uvoz/izvoz), sample.js (demo lokacija)
src/scene/     viewer.js, terrainMesh.js (šejder izohipsi), probes.js, blockModel.js
src/section/   compute.js (proračun preseka), profileSvg.js (2D), sectionTool.js (crtanje, 3D zavesa, odsecanje)
src/ui/        charts.js (dijagrami u info panelu)
tests/fixtures/stari-format/   CSV iz prethodne HTML verzije (provera kompatibilnosti)
```
