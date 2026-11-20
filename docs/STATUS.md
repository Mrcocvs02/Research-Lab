# Stato

> Passaggio di consegne: vedi `docs/HANDOFF.md`.

- **Fase:** 8 completa, tag `phase-8` creato. Tag pubblicati: `phase-0`..`phase-3`, `phase-6`, `phase-7`, `phase-8`; `phase-4` e `phase-5` senza tag. Versione 1.0 rilasciata; versione 1.1.0 rilasciata (tag `v1.1.0`).
- **Onda:** onda 14 (dopo la 1.0, D-492..D-510): rete e libreria leggibili, multi-selezione, Sorprendimi, Discover, qualità dei tag. Dopo la 1.1.0: lavoro su `main` non ancora rilasciato (D-511..D-514, vedi sotto). Nessun lavoro in corso.
- **HEAD:** vedi `git log`. La documentazione dell'onda 14 è su `main`; quella del lavoro dopo la 1.1.0 è sul ramo `docs15`, non ancora unita.
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
- **In corso:** nulla.
- **Bloccato:** nulla di bloccante. Le domande aperte all'utente non bloccano (`docs/HANDOFF.md`, sezione 7).
- **Lacune note dopo l'onda 14:** concetti duplicati risolti ~12 su 18 sulla libreria reale (obiettivo 90%); Topic chiarisce il 52% dei blocchi per le macro-aree generiche e piccole dell'utente (si possono unire; Automatica è il default); selettore delle famiglie di tag un tag alla volta; "Suggerisci famiglie"; Rinomina sulla scheda del tema; Cronologia per annullare i collegamenti; dimensioni schede S/M/L; stato di studio in batch.
- **Prossimo:** vedi "Ripresa" qui sotto (1.2.0 rilasciata; `hk1` e `vpack` uniti; poi progetto Opus sul vocabolario di base e 1.3.0).
- **Budget:** tetti in `CLAUDE.md`, non più rigidi (D-487), alzati per D-501..D-503; ogni nuovo chunk del renderer ha un tetto di 16 KiB (`renderer.chunkCapsKB`, D-465).
- **Da ricordare:** test pesanti solo uno alla volta; e2e in parallelo solo con cartelle `--output` separate; con poca RAM libera la suite e2e si ferma da sola (mem-sample). Installer: `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; eseguibile di Claude Code non incluso (D-474).

## Ripresa (2026-11-20, sera) — leggere per primo

- Rilasciata **v1.2.0** (`7a3246a`, tag `v1.2.0`), installer `apps/desktop/release/ResearchLab-Setup-1.2.0.exe` (125 MB, senza Claude Code, non provato con installazione). Test: unitari 3044/3044, pesanti verdi, e2e verdi tranne `qa-budget` (instabile noto).
- **Uniti su `main` dopo la 1.2.0** (spinti; nessun ramo in corso):
  - `hk1` **unito** (`a5d1ea1`): "Lascia decidere a Haiku" con avanzamento visibile ("120/600", chip Attività, Annulla che tiene il parziale, riepilogo), tutte le domande in una corsa (anteprima con costo totale e tetto), prompt condiviso inviato una volta con cache e domande a centinaia per chiamata (riportare i token prima/dopo), "Vai al documento"/"Inizia da qui" spostati a destra nel vicinato. D-515.
  - `vpack` **unito** (`9a57b84`): vocabolario di base (topic 161 con 12 macro-aree, method 79, system 42, paperType 12; termini scritti da zero, solo categorie arXiv come indizi; PhySH non usato: licenza non dichiarata) del campo dell'utente (fisica, informazione quantistica, molti corpi, materia condensata, metodi numerici, AI, fisica matematica) in `packages/core/src/vocab/packs/physics-qi-manybody.json` + schema zod + test + `docs/design/vocab-packs.md`; licenze da verificare (PhySH CC0?).
- **Prossimi passi:**
  1. ~~Unire `hk1` e `vpack`~~ fatto (`a5d1ea1`, `9a57b84`).
  2. Progetto Opus: il vocabolario di base guida tagging, macro-aree e blocchi (il Vocabolario mostra solo i concetti usati in libreria; il vocabolario evolve con i paper); correzioni a mano nella panoramica a blocchi (trascinare un paper in un altro blocco = cambia il valore della famiglia, rinominare/unire blocchi); migliorare la scelta delle macro-aree. **La panoramica a blocchi va tenuta** (piace all'utente).
  3. Sonnet implementa; Opus verifica su una copia della cartella UL (sola lettura, copia temporanea, niente percorso nei file).
  4. Giro completo dei test (unitari; e2e due alla volta, ognuno con `--output` suo; pesanti), documenti, versione 1.3.0.
- Regole operative ricordate dall'utente: costo in token prima del tempo; agenti al massimo 2; test bomba vietati (D-476); tetti in KiB non vincolanti ma app leggera (D-487); niente Co-Authored-By.
