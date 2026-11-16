# Stato

- **Fase:** 1 — indice e ricerca
- **Onda:** 1.2 — revisione indipendente e di sicurezza
- **Fatto:**
  - Fase 0 chiusa (tag `phase-0`).
  - Fase 1, onda 1.1: scanner incrementale, estrattore (pdfjs-dist, fflate), osservatore (`packages/data`); indice FTS5 con pagine nei risultati (`packages/search`); runtime nel main con worker thread; canali `scan:*`, `search:*`, `documents:*`, `index:rebuild`; vista di ricerca; corpus sintetico e spec e2e `qa-*`.
  - Criterio fase 1 verificato: scansione da zero della libreria reale = importazione (id, percorsi, dimensioni 100%; DOI e arXiv presenti nel testo ritrovati al 100%; titoli simili in media 0,958); ricerca su 1000 documenti p95 8,8 ms nell'app e 68 ms nel benchmark dell'indice; prova offline verde (3 su 3).
- **In corso:** reviewer e security sulla differenza `phase-0..main`
- **Bloccato:** —
- **Da ricordare:** per l'installer (fase 8) `pdfjs-dist` e `fflate` sono esterni al bundle del main e vanno tra le dipendenze del pacchetto (D-052); le fasi 2-3 devono chiamare `LibraryRuntime.reindexDocument(docId)` dopo modifiche a tag, note e annotazioni; i backup della cartella dati all'avvio si accumulano (serve una politica di conservazione).
- **Prossimo:** correzioni dalla revisione, tag `phase-1`, fase 2 (navigazione, tassonomia con annulla, progetti)
