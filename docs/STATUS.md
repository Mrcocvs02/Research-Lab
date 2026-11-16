# Stato

- **Fase:** 2 — navigazione, organizzazione, progetti (il sostituto di TagSpaces)
- **Onda:** 2.4 — chiusura fase
- **Fatto:**
  - Fasi 0 e 1 chiuse (tag `phase-0`, `phase-1`).
  - Fase 2: backend (tassonomia a livelli liberi, tag in blocco, modifica documenti, apertura file con lista permessa, annulla/ripeti, progetti e collezioni, albero cartelle), interfaccia completa, ordinamento per dimensione, filtri lato server, correzioni da reviewer e security.
  - Giro di leggerezza (D-170..D-177) unito: JS iniziale del renderer 1202 -> 350 KiB, viste su richiesta, dizionario solo della lingua attiva, worker avviato su richiesta e chiuso dopo 60 s di inattività, canale `documents:ids`, interruttore "Mostra documenti mancanti", budget automatici (`npm run check:budget`, `e2e/qa-budget.spec.ts`). Nessuna funzione tolta; main non minificato per stack trace leggibili; pannello di dettaglio prelevato a riposo.
  - Verifiche al 2026-11-16 dopo il merge: 723 test unitari verdi; suite e2e completa verde (ultimi 7 test rieseguiti dopo aver liberato memoria).
- **In corso:** subagent sul ramo `p2-bulk` (worktree `../rl-wt/p2-bulk`): azioni in blocco oltre 5000 documenti (tag fino a `idsMax`, progetti fino al limite dei membri con messaggio chiaro, avviso se Ctrl+A supera `idsMax`, stato di attesa). Decisioni da D-178.
- **Bloccato:** —
- **Prossimo (in ordine):**
  1. Merge di `p2-bulk`, test unitari ed e2e di libreria e progetti, tag `phase-2`.
  2. Fase 3: lettore PDF con evidenziazioni e note per pagina, stato di studio, miniature della griglia.
- **Da ricordare:** installer (fase 8): `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; test pesanti solo uno alla volta; con poca RAM libera la suite e2e si ferma da sola (mem-sample): far liberare memoria all'utente e rieseguire solo i test mancanti.
