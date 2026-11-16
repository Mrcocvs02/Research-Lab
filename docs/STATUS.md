# Stato

- **Fase:** 3 — lettore PDF, annotazioni, note, miniature (da avviare)
- **Onda:** 3.2 — miniature della griglia, poi revisione e security di fase 3
- **Fatto:**
  - Fasi 0, 1 e 2 chiuse (tag `phase-0`, `phase-1`, `phase-2`).
  - Fase 2: backend (tassonomia a livelli liberi, tag in blocco, modifica documenti, apertura file con lista permessa, annulla/ripeti, progetti e collezioni, albero cartelle), interfaccia completa, ordinamento per dimensione, filtri lato server, correzioni da reviewer e security.
  - Giro di leggerezza (D-170..D-177) unito: JS iniziale del renderer 1202 -> 350 KiB, viste su richiesta, dizionario solo della lingua attiva, worker avviato su richiesta e chiuso dopo 60 s di inattività, canale `documents:ids`, interruttore "Mostra documenti mancanti", budget automatici (`npm run check:budget`, `e2e/qa-budget.spec.ts`). Nessuna funzione tolta; main non minificato per stack trace leggibili; pannello di dettaglio prelevato a riposo.
  - Azioni in blocco su selezioni grandi (D-178..D-181): tag fino a 50000 documenti in una sola modifica con un solo annulla, progetti fino a 20000 membri con messaggio chiaro, avviso se Ctrl+A supera 50000, stato di attesa; nel registro il riassunto compare una volta per gruppo, `undoOf` su ogni voce.
  - Revisione del delta (leggerezza e azioni in blocco): nessun bloccante; corretti gruppi del registro letti a metà (mai annullati a metà, D-182), ErrorBoundary e un nuovo tentativo per le viste su richiesta, ciclo di vita del worker (D-183).
  - Verifiche finali di fase 2 (2026-11-16): 747 test unitari verdi; e2e 38/38 (inclusa importazione reale); budget rispettati (JS iniziale 353 KiB, memoria a riposo ~435 MB, primo contenuto ~430 ms, misurato come il migliore di due avvii).
  - Fase 3, onda 3.1 unita (D-184..D-193): lettore pdf.js su richiesta (pagine virtualizzate, Ctrl+F, link interni ed esterni su clic), evidenziazioni e sottolineature salvate a parte con flag sottolineato, note per file e per pagina con conflitto, stato di studio nel lettore, risultati di ricerca "nelle note" / "nelle evidenziazioni"; risorse di pdf.js (font, CMap, decodificatori JS) servite su richiesta. Criterio verificato in e2e: si evidenzia, si chiude, si riapre e si ritrova; hash del PDF identico. Verifiche: 806 unitari, e2e 40/40, budget rispettati (JS iniziale 358 KiB, memoria a riposo ~430 MB, avvio ~410 ms).
- **In corso:** —
- **Bloccato:** —
- **Prossimo (in ordine):**
  1. Onda 3.2: miniature della prima pagina nella griglia (contratti da scrivere: generazione nel renderer, cache locale non sincronizzata).
  2. Revisione indipendente e security di fase 3, correzioni, tag `phase-3`.
- **Da ricordare:** installer (fase 8): `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; test pesanti solo uno alla volta; con poca RAM libera la suite e2e si ferma da sola (mem-sample): far liberare memoria all'utente e rieseguire solo i test mancanti.
