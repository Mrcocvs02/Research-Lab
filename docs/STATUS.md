# Stato

> Passaggio di consegne: vedi `docs/HANDOFF.md`.

- **Fase:** 8 completa, tag `phase-8` creato. Tag pubblicati: `phase-0`..`phase-3`, `phase-6`, `phase-7`, `phase-8`; `phase-4` e `phase-5` senza tag. Versione 1.0 rilasciata; feedback dell'utente dopo la 1.0.
- **Onda:** onda 14 (dopo la 1.0, D-492..D-510): rete e libreria leggibili, multi-selezione, Sorprendimi, Discover, qualità dei tag. Nessun lavoro in corso.
- **HEAD:** vedi `git log`. L'aggiornamento di documentazione dell'onda 14 è sul ramo `docs14`.
- **Fatto** (onda 14):
  - Sorprendimi salta i collegamenti già noti; Discover riduce i classici, visibili con "Includi classici" (D-492).
  - Diagnosi su dati reali (audit "Diagnosi rete e libreria (post 1.0)"); design §19 (D-493..D-501).
  - Vocabolario controllato con alias, rilevatore di quasi-duplicati, controlli di salute, pulizia guidata in 6 passi con "Annulla tutto", anche sui passi sovrapposti (D-504); provenienza mano/AI/import; import e tagging AI legati al vocabolario.
  - Mappa su carta, in blocchi con archi di evidenza: titoli senza collisioni, legenda fuori dalla tela, vicinato, percorso, Indietro/Avanti, vista Vocabolario; si apre raggruppata per Automatica (D-510).
  - Schede della libreria in verticale; multi-selezione solo sui condivisi.
  - Verifiche dell'auditor Opus su dati reali (D-505..D-509): rete chiara sulla libreria reale, 0 fusioni errate, 25/25 titoli a 1280 e 1920.
  - Tetti di budget alzati (D-501..D-503).
  - Test: unitari 3005/3005; heavy verdi; e2e verdi tranne `qa-budget` `firstContentMs` (instabile, noto).
- **In corso:** nulla.
- **Bloccato:** nulla di bloccante. Le domande aperte all'utente non bloccano (`docs/HANDOFF.md`, sezione 7).
- **Lacune note dopo l'onda 14:** concetti duplicati risolti ~12 su 18 sulla libreria reale (obiettivo 90%); Topic chiarisce il 52% dei blocchi per le macro-aree generiche e piccole dell'utente (si possono unire; Automatica è il default); selettore delle famiglie di tag un tag alla volta; "Suggerisci famiglie"; Rinomina sulla scheda del tema; Cronologia per annullare i collegamenti; dimensioni schede S/M/L; stato di studio in batch.
- **Prossimo (in ordine):**
  1. Versione 1.1.0.
  2. Installer.
  3. Tag `v1.1.0`.
- **Budget:** tetti in `CLAUDE.md`, non più rigidi (D-487), alzati per D-501..D-503; ogni nuovo chunk del renderer ha un tetto di 16 KiB (`renderer.chunkCapsKB`, D-465).
- **Da ricordare:** test pesanti solo uno alla volta; e2e in parallelo solo con cartelle `--output` separate; con poca RAM libera la suite e2e si ferma da sola (mem-sample). Installer: `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; eseguibile di Claude Code non incluso (D-474).
