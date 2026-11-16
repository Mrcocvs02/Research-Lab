# Stato

- **Fase:** 2 — navigazione, organizzazione, progetti (il sostituto di TagSpaces)
- **Onda:** 2.4 — chiusura fase
- **Fatto:**
  - Fasi 0 e 1 chiuse (tag `phase-0`, `phase-1`).
  - Fase 2: backend (tassonomia a livelli liberi, tag in blocco, modifica documenti, apertura file con lista permessa, annulla/ripeti, progetti e collezioni, albero cartelle), interfaccia completa, ordinamento per dimensione, filtri lato server, correzioni da reviewer e security.
  - Verifiche al 2026-11-16: 715 test unitari verdi; suite e2e 37/37 (inclusa importazione reale) con finestre fuori schermo in ~1,5 min, picco ~0,9 GB.
- **In corso:** —
- **Bloccato:** —
- **Prossimo (in ordine):**
  1. Giro di leggerezza: viste del renderer caricate su richiesta (oggi bundle unico da 1,2 MB), meno zod nel renderer, worker di scansione avviato su richiesta e chiuso quando inattivo, canale `documents:ids` per Ctrl+A senza trasferire righe, interruttore "mostra mancanti" (`includeMissing`), budget misurati in automatico (dimensione bundle, memoria a riposo, tempo di avvio).
  2. Suite completa, aggiornamento docs, tag `phase-2`.
  3. Fase 3: lettore PDF con evidenziazioni e note per pagina, stato di studio, miniature della griglia.
- **Da ricordare:** installer (fase 8): `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; test pesanti solo uno alla volta.
