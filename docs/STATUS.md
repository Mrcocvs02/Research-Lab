# Stato

- **Fase:** 0 — fondamenta e impostazioni
- **Onda:** 0.3 — revisione indipendente e di sicurezza
- **Fatto:**
  - onda 0.1 (architect): monorepo, contratti `packages/core`, IPC tipizzato, guscio Electron sicuro, `node:sqlite` con FTS5
  - onda 0.2: archivio dati e importatore (`packages/data`), procedura guidata e impostazioni (`apps/desktop`), testkit, verifiche di generalità e non distruzione (`packages/testkit`, `tools/`)
  - integrazione: backup della cartella dati prima dell'importazione; e2e sull'importazione reale (21 documenti, tassonomia completa, originali intatti)
  - verifiche: typecheck, 171 test unitari, 15 e2e, generalità verdi
- **In corso:** reviewer e security sulla differenza della fase 0
- **Bloccato:** —
- **Prossimo:** correzioni dalla revisione, tag `phase-0`, poi fase 1 (scansione, estrazione, osservatore, FTS5)
