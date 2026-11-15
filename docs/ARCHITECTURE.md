# Architettura (fase 0)

Monorepo npm workspaces, TypeScript strict, ESM. Ogni pacchetto ha un solo punto d'ingresso (`src/index.ts`); nessuno importa file interni di un altro. I pacchetti sono consumati come sorgenti TS (D-008).

## Mappa dei pacchetti

| Pacchetto | Responsabilità | Stato |
| --- | --- | --- |
| `@rl/core` | Contratti: schemi zod e tipi (impostazioni, `library.json`, modello dati), interfacce dei servizi, registro IPC, errori, log, percorsi dati. Isomorfo. | completo |
| `@rl/core/node` | Solo Node: scrittura atomica, `resolveInRoot` (confinamento), SHA-256 in streaming, logger su file. | completo |
| `@rl/data` | Archivio della libreria, scanner, estrattore di testo, importatore del vecchio indice. | stub |
| `@rl/search` | Indice FTS5 su `node:sqlite` (D-007). | stub |
| `@rl/ai` | Fornitori AI (Claude, simulato), chat, comandi, strumenti dell'agente. | stub |
| `@rl/citations` | OpenAlex, arXiv, Semantic Scholar, abbinamento. | stub |
| `@rl/graph` | TF-IDF, similarità, clustering, layout. | stub |
| `@rl/export` | Export second brain. | stub |
| `@rl/mcp` | Server MCP locale. | stub |
| `apps/desktop` | Electron: `src/main` (processo principale), `src/preload`, `src/renderer` (React). | guscio |
| `e2e` | Playwright per Electron (`helpers/launch.ts`). | smoke |
| `tools` | `check-generality`, `check-nondestructive` (da implementare), `spikes/`. | scheletro |

## Dove stanno i contratti

- Tipi e schemi dei dati: `packages/core/src/model/*.ts` (un file per tipo di dato); impostazioni e `library.json`: `core/src/settings.ts`.
- Layout della cartella dati: `core/src/data-paths.ts` (`dataPath.document(id)` ecc.). Usalo sempre, non costruire stringhe a mano.
- Interfacce dei servizi (solo tipi): `core/src/services/*.ts`. Ogni pacchetto esporta fabbriche tipizzate su di esse.
- IPC: `core/src/ipc/` (registro, dispatcher, client). Errori: `core/src/errors.ts` (`AppError` con codici).
- Ogni file di dati ha `schemaVersion`; i campi senza posto naturale in un import vanno in `legacy`.

## Aggiungere un canale IPC

1. In `packages/core/src/ipc/channels/<dominio>.ts`: `export const xChannels = defineChannels('x', { azione: { request: zodSchema, response: zodSchema } })` (le chiavi diventano `x:azione`). Eventi main verso renderer: `defineEvents('x', { nome: schema })`.
2. Aggiungi una riga di import e una nella `mergeRegistries` di `channels/index.ts` (chiavi duplicate = errore all'avvio).
3. In `apps/desktop/src/main/ipc/handlers/<dominio>-handlers.ts`: `(s: MainServices) => DomainHandlers<'x'>`; aggiungila a `buildHandlers` (il compilatore segnala i canali senza handler). Gli handler non importano `electron`: ricevono i servizi da `MainServices`, quindi si provano con Vitest (vedi `handlers.test.ts`).
4. Nel renderer: `await rl.invoke('x:azione', payload)` (da `src/renderer/src/lib/rl.ts`); gli errori arrivano come `AppError`. Eventi: `rl.on('x:nome', cb)`.
5. Regole: i percorsi dal renderer sono relativi alla radice della libreria (`relativePathSchema`), mai assoluti; le uniche eccezioni passano da `dialog:chooseFolder`. Nessun canale restituisce segreti. Il main valida richiesta e risposta: un handler che restituisce dati fuori schema fallisce.

## Scrivere un file di dati

```ts
import { dataPath, documentRecordSchema } from '@rl/core';
import { atomicWriteJson, resolveInRoot } from '@rl/core/node';
const file = await resolveInRoot(dataDir, dataPath.document(id)); // confinato, anche con symlink
await atomicWriteJson(file, documentRecordSchema.parse(record));  // temp + rename, ritenta su EBUSY/EPERM
```

Un file per elemento; mai scrivere fuori dalla cartella dati o negli originali; leggere con `readJsonFile(file, schema)` (NOT_FOUND / SCHEMA_INVALID). Ogni modifica a tag e tassonomia va nel registro (`log/`, per dispositivo, D-011).

## Percorsi

| Cosa | Dove | Sincronizzato |
| --- | --- | --- |
| Libreria: `library.json`, `documents/`, `notes/`, `annotations/`, `citations/`, `projects/`, `taxonomy.json`, `watch.json`, `log/` | `<radice libreria>\<dataDirName>` (default `.lab`) | sì |
| Impostazioni per macchina (profili con percorso radice, utente, lingua) | `<userData>\settings.json` | no |
| Segreti (cifrati con `safeStorage`) | `<userData>\secrets.json` | no |
| Indice di ricerca, cache, vettori, log dell'app | `%LOCALAPPDATA%\ResearchLab` (`localPath.*`) | no |

Per i test: `RL_USER_DATA_DIR` e `RL_LOCAL_DATA_DIR` (cartelle assolute temporanee). La libreria reale di prova: `RL_FIXTURE_LIBRARY`, sempre su copia temporanea (D-004).

## Sicurezza del guscio

`contextIsolation`, `sandbox`, niente `nodeIntegration`; renderer servito da `rl-app://app/` con CSP restrittiva (D-010); preload minimale (`window.rlBridge`); navigazione e `window.open` bloccati; link esterni solo https su host consentiti; permessi negati; IPC da origine non fidata rifiutato.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `npm install` | Installa (versioni bloccate dal lockfile). |
| `npm run dev` | Avvia l'app con HMR (Vite su localhost:5173). |
| `npm run build` | Compila main, preload, renderer in `apps/desktop/out`. |
| `npm run typecheck` | `tsc` sui tre progetti. |
| `npm test` | Vitest su tutti i workspace (`*.test.ts` accanto ai sorgenti). |
| `npm run test:e2e` | Build + Playwright su Electron (cartelle temporanee). |
| `npm run check:generality`, `check:nondestructive` | Predisposti, li implementa qa. |

In Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"`.
