# Stato

- **Fase:** 2 — navigazione, organizzazione, progetti (il sostituto di TagSpaces)
- **Onda:** 2.1 — da avviare
- **Fatto:**
  - Fase 0 chiusa (tag `phase-0`).
  - Fase 1 chiusa (tag `phase-1`): scanner incrementale, estrattore (pdfjs-dist, fflate) indurito contro documenti ostili, osservatore, indice FTS5 con pagine nei risultati, runtime nel main con worker supervisionato (watchdog, rispawn, un solo scrittore dei record), canali `scan:*`, `search:*`, `documents:*`, `index:rebuild`, vista di ricerca.
  - Criterio fase 1: scansione da zero della libreria reale = importazione (id, percorsi, dimensioni 100%; DOI/arXiv presenti nel testo ritrovati al 100%; titoli simili in media 0,958); ricerca su 1000 documenti p95 5,5 ms nell'app; prova offline verde.
  - Revisioni fase 1: reviewer (7 importanti corretti), security (4 bloccanti corretti e ricontrollati).
  - Verifiche al 2026-11-16: 577 unitari + 40 pesanti, 30 e2e + 2 pesanti, generalità, tutti verdi in locale con memoria misurata.
- **In corso:** —
- **Bloccato:** —
- **Da ricordare:** installer (fase 8): `pdfjs-dist` e `fflate` esterni al bundle del main (D-052); fasi 2-3 devono chiamare `LibraryRuntime.reindexDocument(docId)` dopo modifiche a tag, note, annotazioni; test pesanti solo uno alla volta (RULES, TESTING).
- **Prossimo:** fase 2 — data-engineer (tassonomia a livelli, annulla/ripeti, progetti, modifica documenti, apertura file, canali IPC) poi frontend (albero cartelle, elenco/griglia, filtri, scheda documento, gestione tassonomia, progetti).
