# Decisioni

Formato: `D-NNN · data · scelta — motivo`.

- D-001 · 2026-11-15 · Repository in `C:\dev\research-lab`; Node.js 26.13.1 LTS installato con winget (approvato dall'utente) — Node mancava; il piano vuole il codice fuori da OneDrive.
- D-002 · 2026-11-15 · Tutti i subagent usano Sonnet 5.5 — istruzione esplicita dell'utente; prevale sulla nota "Modelli" della sezione 9.
- D-003 · 2026-11-15 · Identità git locale neutra ("Research Lab dev agent") — nessuna identità globale configurata; l'utente può cambiarla con `git config user.name/user.email`.
- D-004 · 2026-11-15 · La libreria reale di prova non entra nel repository: i test la leggono da `RL_FIXTURE_LIBRARY` e lavorano su una copia temporanea; le fixture committate sono sintetiche e generate da script — contiene documenti amministrativi riservati e nomi di terzi, in conflitto con la regola di generalità.
- D-005 · 2026-11-15 · La verifica di generalità usa schemi generici (percorsi assoluti utente, nomi di servizi di sync) più un elenco locale non committato (`tools/generality.local.json`) — l'elenco dei nomi reali non deve finire a sua volta nel codice.
