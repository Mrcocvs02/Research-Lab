# Stato

> Passaggio di consegne: vedi `docs/HANDOFF.md`.

- **Fase:** 8 completa, tag `phase-8` creato. Tag pubblicati: `phase-0`..`phase-3`, `phase-6`, `phase-7`, `phase-8`; `phase-4` e `phase-5` senza tag. Versioni 1.0, 1.1.0 (tag `v1.1.0`) e 1.2.0 (tag `v1.2.0`) rilasciate; versione 1.3.0 impostata (commit `1c75187`), tag `v1.3.0` pubblicato.
- **Onda:** onda 15 (2026-11-20/21, D-516..D-562, design §20 di `docs/design/ARCHITETTURA-UI.md`) fatta e unita su `main`. Onda 14 (D-492..D-510) e lavoro dopo la 1.1.0 (D-511..D-514) sotto. Nessun lavoro di ondata in corso.
- **HEAD:** vedi `git log`. Ultimo commit di codice: `1c75187` (Set version 1.3.0). La documentazione dell'onda 15 è sul ramo `docs16`, non ancora unita.

- **Fatto** (onda 14):
  - Sorprendimi salta i collegamenti già noti; Discover riduce i classici, visibili con "Includi classici" (D-492).
  - Diagnosi su dati reali (audit "Diagnosi rete e libreria (post 1.0)"); design §19 (D-493..D-501).
  - Vocabolario controllato con alias, rilevatore di quasi-duplicati, controlli di salute, pulizia guidata in 6 passi con "Annulla tutto", anche sui passi sovrapposti (D-504); provenienza mano/AI/import; import e tagging AI legati al vocabolario.
  - Mappa su carta, in blocchi con archi di evidenza: titoli senza collisioni, legenda fuori dalla tela, vicinato, percorso, Indietro/Avanti, vista Vocabolario; si apre raggruppata per Automatica (D-510).
  - Schede della libreria in verticale; multi-selezione solo sui condivisi.
  - Verifiche dell'auditor Opus su dati reali (D-505..D-509): rete chiara sulla libreria reale, 0 fusioni errate, 25/25 titoli a 1280 e 1920.
  - Tetti di budget alzati (D-501..D-503).
  - Test: unitari 3005/3005; heavy verdi; e2e verdi tranne `qa-budget` `firstContentMs` (instabile, noto).
- **Fatto dopo la 1.1.0** (su `main`, non rilasciato; D-511..D-514):
  - Lettore: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z annullano e ripetono evidenziazioni, sottolineature e altre annotazioni (diario delle annotazioni; poi la cronologia della libreria); Annulla/Ripeti nel menu Altro.
  - Riassunto strutturato della nota di letteratura (problema, contributo, metodo, risultati, dati, limiti): "Riassunto ✦" sulla scheda accanto a Leggi e in Altro del lettore; con il consenso AI usuale se manca.
  - Rete: ogni famiglia di "Raggruppa per" è selezionabile; le famiglie parziali mostrano "blocchi parziali" e Riordina i tag; i gruppi con 0 % sono nascosti; i gruppi derivati dalla fonte dei tag (sidecar, manuale) sono stati rimossi. Percorso di vicinato leggibile; Allarga/+8 a destra con interruttore Restringi/−8; Indietro/Avanti si muovono dentro la sezione (discesa di Explore, anelli di vicinato).
  - Tag: "Accetta tutte (N)"; accettazione automatica con quattro modalità (spenta, solo le sicure, sicure + Haiku decide le incerte, tutte); "Lascia decidere a Haiku" (solo nomi, alias e conteggi; anteprima, costo, tetto, annullabile, guardrail) (D-512); gestore dei tag dalla barra laterale "Tag" (con conteggio), Alt+6, tre comandi della tavolozza e "Gestisci i tag…" nel popover e nella scheda.
  - Pannelli laterali ridimensionabili (barra laterale, Claude, DocPanel, lato della Mappa, dettaglio della rete, lato del lettore) con tastiera, doppio clic per ripristinare e larghezze ricordate (D-513). La colonna dei documenti di Explore resta fissa.
  - Tetti di budget alzati: JS totale del renderer 2350 → 2400 KiB, totale 2530 → 2580 (D-511); totale pigro del main 580 → 600 KiB (D-514).
  - Test: la suite completa non è stata rifatta dopo questi merge; ogni agente ha eseguito i test unitari e gli e2e dei file che ha toccato.
- **Fatto** (onda 15, D-516..D-562):
  - Design §20 scritto da Opus (architetto e revisore avversario, 2 round); scelta dell'utente: lo spostamento di macro-area parte selezionato (D-533). Extra approvati per rete e Mappa: stato di lettura, multi-selezione, opere isolate e blocchi senza collegamenti, viste salvate con export PNG/SVG.
  - `vp1`: pacchetto di vocabolario per fisica, informazione quantistica e molti corpi che guida il tagging AI; concetti latenti finché non usati; il Vocabolario mostra solo i concetti usati; attivazione e disattivazione annullabili (D-536).
  - `me2`: Mappa lato principale (mapEdit:move, tag principale fisso, taglio macro-area, viste salvate, stato di lettura `st`, export PNG) (D-546).
  - `be3`: blocchi modificabili (trascinamento di paper tra blocchi, Maiusc rimuove il valore vecchio, rinomina, unione, M e F2, Ctrl+trascinamento per la multi-selezione con barra, proposte di macro-area con il pacchetto) (D-548).
  - `mx4`: segni di lettura nel punto, "Prossimo da leggere", opere isolate e coppie di blocchi senza collegamenti, viste salvate, export PNG/SVG, riga di progetto (D-558).
  - Tetti di budget alzati: D-547, D-548, D-558, D-561.
  - Correzioni dopo la verifica finale: `uf13` (test e i18n; menu ⋯ della Mappa al massimo 7 voci, timeline e minimappa nei Filtri; apertura di una vista salvata con Indietro/Avanti; e2e macro deterministico) (D-559); `pf1` (alias del pacchetto solo varianti vere, 180 termini più stretti → 136 concetti figli) (D-560); `mc2` (taglio macro che unisce i blocchi minuscoli, mira a 4–7 blocchi, anteprima = risultato della Mappa) (D-561); `lf3` (ultima pulizia alias, guardia sugli alias dell'utente, blocco latente limitato a 1100 caratteri) (D-562).
  - Test su `main` prima della 1.3.0: unitari 3212/3212 (24 saltati); pesanti unitari 65/65 (incl. retag e taglio macro su 5000 opere); e2e tutti verdi se eseguiti da soli tranne `qa-budget` `firstContentMs` 595 contro 530 (instabile noto); `packaged-app` verde sulla build 1.3.0 (build di prova e controllo di rilascio). E2e pesanti NON eseguiti (mem-guard: 2,3 GiB liberi, ne servono 2,5).
  - Verifica Opus su copia temporanea della libreria reale (headless, solo aggregati, copia cancellata): pacchetto 30 riconoscimenti sicuri (obiettivo ≥ 40, non raggiunto); 1 fusione sicura errata ("computational methods" vs "numerical study", probabilmente da un alias dell'utente); token del prompt con pacchetto max 272, mediana 257 (≤ 300 ok); macro-aree con pacchetto: 5 blocchi, 86 % chiari, il più grande 31 %, ma un blocco di 1 opera (obiettivo ≥ 2); senza pacchetto 29 % chiari (non garantito, D-562); Applica→Annulla identico. Verifiche visive nell'app NON fatte (la run del verificatore si è bloccata 4 h sulla scansione ed è stata fermata; memoria bassa).
- **Installer 1.3.0:** `apps/desktop/release/ResearchLab-Setup-1.3.0.exe` costruito (125 MB, non provato con installazione) (senza eseguibile di Claude Code, D-474).
- **Fatto dopo la 1.2.0:** 1.2.0 rilasciata (`7a3246a`, tag `v1.2.0`, installer di 125 MB senza Claude Code); `hk1` (`a5d1ea1`) e `vpack` (`9a57b84`) uniti su `main` (D-515).
- **In corso:** nulla.
- **Bloccato:** nulla di bloccante. Le domande aperte all'utente non bloccano (`docs/HANDOFF.md`, sezione 7).
- **Lacune note dopo l'onda 15:** pacchetto con 30 riconoscimenti sicuri su obiettivo ≥ 40; macro-aree con un blocco di 1 opera sui dati reali; senza pacchetto solo 29 % chiari (non garantito); verifica visiva di §20 da fare.
- **Lacune note dopo l'onda 14:** concetti duplicati risolti ~12 su 18 sulla libreria reale (obiettivo 90%); Topic chiarisce il 52% dei blocchi per le macro-aree generiche e piccole dell'utente (si possono unire; Automatica è il default); selettore delle famiglie di tag un tag alla volta; "Suggerisci famiglie"; Rinomina sulla scheda del tema; Cronologia per annullare i collegamenti; dimensioni schede S/M/L; stato di studio in batch.
- **Prossimo:** vedi "Ripresa" qui sotto.
- **Budget:** tetti in `CLAUDE.md`, non più rigidi (D-487), alzati per D-501..D-503; ogni nuovo chunk del renderer ha un tetto di 16 KiB (`renderer.chunkCapsKB`, D-465).
- **Da ricordare:** test pesanti solo uno alla volta; e2e in parallelo solo con cartelle `--output` separate; con poca RAM libera la suite e2e si ferma da sola (mem-sample). Installer: `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; eseguibile di Claude Code non incluso (D-474).

## Ripresa (2026-11-21) — leggere per primo

- Onda 15 **unita su `main`** (design §20 di `docs/design/ARCHITETTURA-UI.md`, D-516..D-562). Ultimo commit di codice `1c75187` (Set version 1.3.0). Versione **1.3.0 impostata**; installer `apps/desktop/release/ResearchLab-Setup-1.3.0.exe` (125 MB) costruito; tag `v1.3.0` (senza Claude Code, D-474); tag `v1.3.0` pubblicato.
- Contenuti: design §20 con 2 round Opus (architetto e revisore avversario); scelta dell'utente: lo spostamento di macro-area parte selezionato (D-533). Extra approvati per rete/Mappa: stato di lettura, multi-selezione, opere isolate e blocchi senza collegamenti, viste salvate con export PNG/SVG.
- Merge: `vp1` pacchetto di vocabolario fisica/QI/molti corpi (D-536); `me2` Mappa lato principale (D-546); `be3` blocchi modificabili (D-548); `mx4` segni di lettura, isolate, viste salvate, export, riga di progetto (D-558). Tetti alzati D-547, D-548, D-558, D-561.
- Correzioni dopo la verifica finale: `uf13` (D-559), `pf1` (D-560), `mc2` (D-561), `lf3` (D-562); dettagli in `docs/HISTORY.md`.
- Test su `main` prima della 1.3.0: unitari 3212/3212 (24 saltati); pesanti unitari 65/65; e2e tutti verdi da soli tranne `qa-budget` `firstContentMs` 595 contro 530 (instabile noto); `packaged-app` verde sulla build 1.3.0 (build di prova e controllo di rilascio). E2e pesanti NON eseguiti (2,3 GiB liberi, ne servono 2,5).
- Verifica Opus su copia temporanea della libreria reale (headless, solo aggregati, copia cancellata): pacchetto 30 riconoscimenti sicuri (obiettivo ≥ 40, non raggiunto); 1 fusione sicura errata ("computational methods" vs "numerical study", probabilmente da un alias dell'utente); token del prompt con pacchetto max 272, mediana 257 (≤ 300 ok); macro-aree con pacchetto: 5 blocchi, 86 % chiari, il più grande 31 %, ma un blocco di 1 opera (obiettivo ≥ 2); senza pacchetto 29 % chiari (non garantito, D-562); Applica→Annulla identico. Verifiche visive nell'app NON fatte (run bloccata 4 h sulla scansione, fermata; memoria bassa).
- **Prossimi passi:**
  1. ~~Installer 1.3.0 e tag `v1.3.0`~~ fatto.
  2. Verifica visiva di §20 nell'app con RAM libera: trascinamento, rinomina, unione, annulla, barra di selezione, segni di lettura contro etichette, viste salvate, export.
  3. E2e pesanti uno alla volta.
  4. Portare i riconoscimenti sicuri del pacchetto verso ≥ 40.
  5. Nessun blocco macro di una sola opera sui dati reali.
  6. Rimuovere i vecchi worktree in `C:\dev\rl-wt` (mai una junction `node_modules`).
- Regole operative ricordate dall'utente: costo in token prima del tempo; agenti al massimo 2; test bomba vietati (D-476); tetti in KiB non vincolanti ma app leggera (D-487); niente Co-Authored-By.
