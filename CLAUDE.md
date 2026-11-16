# Research Lab — guida per Claude Code

App desktop (Electron + React + TypeScript, monorepo npm) che organizza librerie di documenti di ricerca. Piano completo in `docs/PLAN.md` (fasi 0–8 con criteri di accettazione).

## Da dove ripartire (sempre, anche dopo una compattazione del contesto)
1. `docs/STATUS.md`: fase, onda, cosa è fatto, in corso, bloccato, prossimo.
2. `docs/HISTORY.md`: cronologia sintetica di fasi, revisioni ed eventi.
3. `docs/RULES.md`: regole assolute, generalità, commit, risorse della macchina, leggerezza.
4. `docs/DECISIONS.md`: decisioni numerate (D-xxx); `docs/ARCHITECTURE.md`, `docs/TESTING.md`.
5. `CLAUDE.local.md` (non versionato): dettagli di questa macchina.

## Come si lavora
- L'agente principale coordina: scrive gli incarichi, integra, verifica, fa commit e push. Le funzioni le scrivono i subagent.
- Subagent: modello Sonnet; Haiku solo per compiti molto semplici e meccanici. Ogni incarico è autosufficiente (obiettivo, contesto, proprietà dei file, criteri, vincoli, rapporto breve).
- Ogni subagent lavora in un worktree `../rl-wt/<ramo>` su un ramo dedicato; l'agente principale fa il merge su `main`, rieseque i test e pubblica.
- Al massimo 2 subagent insieme; uno solo esegue test e2e o pesanti. Mai test pesanti in parallelo con altro lavoro pesante.
- A fine di ogni fase: reviewer indipendente e security (potere di blocco), correzioni, suite completa, tag `phase-N`.
- Aggiornare `docs/STATUS.md` e `docs/HISTORY.md` a ogni fine onda e prima di fermarsi.

## Commit
- Remoto `origin` (GitHub), ramo `main`; push dopo ogni merge o correzione.
- Mai righe `Co-Authored-By` né Claude indicato come coautore. Identità git: quella locale del repository.
- Codice, commenti e commit in inglese; documentazione in italiano.

## Comandi
- `npm test` — unitari (Vitest, max 3 worker, controllo memoria).
- `npm run test:e2e` — Playwright su Electron (finestre fuori schermo; `RL_E2E_SHOW=1` per vederle).
- `npm run test:heavy`, `npm run test:e2e:heavy` — benchmark e file ostili (`RL_HEAVY_TESTS=1`), uno alla volta.
- `npm run typecheck`, `npm run build`, `npm run dev`, `npm run check:generality`.
- In Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"` prima di node/npm.

## Vincoli che non si negoziano
Originali mai modificati; scritture solo nella cartella dati della libreria; segreti solo nell'archivio sicuro; invio all'AI solo per cartelle abilitate; output AI separato dalle note dell'utente; nessun nome, percorso o cartella reale nel codice e nei test; codice leggero ed efficiente, ma la funzionalità viene prima della leggerezza.

## Compattazione automatica
Configurata in `.claude/settings.local.json` (non versionato) della cartella di lavoro: soglia al 60% del contesto (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`), compattazione anche durante l'inattività. L'hook `tools/claude-hooks/compact-hook.mjs` salva lo stato in `.claude/last-compact.md` prima di compattare (PreCompact) e lo restituisce con l'elenco dei file da rileggere subito dopo (SessionStart `compact`).

## Compact instructions
Quando compatti il contesto conserva, in quest'ordine:
- fase e onda correnti, ultimo commit su `main` e tag di fase già creati;
- subagent in corso (ruolo, ramo/worktree, cosa stanno facendo) e rami non ancora uniti;
- difetti aperti dalle revisioni e lavoro non verificato;
- preferenze dell'utente: subagent Sonnet (Haiku per cose semplici), niente coautore Claude nei commit, push a ogni passo, test pesanti uno alla volta, finestre di test fuori schermo, app leggera;
- decisioni prese nella sessione ma non ancora scritte in `docs/DECISIONS.md`.
Tralascia l'output completo di test, diff e log: restano in git e nei file `docs/`.
