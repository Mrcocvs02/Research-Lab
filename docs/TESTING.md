# Test e verifiche

Tutti i comandi si lanciano dalla radice del repository (in Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"`).

| Comando | Cosa fa |
| --- | --- |
| `npm run typecheck` | `tsc` sui quattro progetti (radice, main, renderer, e2e) |
| `npm test` | Vitest: `packages/*/src`, `apps/*/src`, `tools/**` |
| `npm run test:e2e` | compila l'app e lancia Playwright per Electron (`e2e/`) |
| `npm run check:generality` | cerca percorsi utente, cartelle di sincronizzazione, e-mail reali, nomi dell'elenco locale |
| `npm run check:nondestructive -- <radice> ...` | salva e confronta lo snapshot SHA-256 di una cartella |

## Test unitari

Vitest, file `*.test.ts` accanto al codice. Per un solo pacchetto: `npx vitest run packages/testkit`.

## Test end to end

`npm run test:e2e` esegue sempre prima la build; l'app compilata parte con cartelle utente e locale temporanee (`RL_USER_DATA_DIR`, `RL_LOCAL_DATA_DIR`), quindi non tocca impostazioni, segreti o indici reali. Regole: attese su condizioni (`expect(...).toBeEnabled()`, `expect.poll`), mai tempi fissi.

Helper in `e2e/helpers/`:

- `launchApp(options)` in `launch.ts`:
  - `library`: `'papers' | 'edge' | 'full' | 'it' | 'en'` (libreria sintetica) oppure `'real'` (copia temporanea di `RL_FIXTURE_LIBRARY`); lo snapshot viene preso all'avvio;
  - `dialogPath`: percorso restituito dal selettore cartelle (imposta `RL_E2E=1` e `RL_E2E_DIALOG_PATH`); `true` = radice della libreria. L'override sta nel processo main;
  - `offline`: `true` blocca la rete della sessione Electron (`session.enableNetworkEmulation({offline:true})` più un filtro `onBeforeRequest` su http(s)/ws(s) che annulla e registra gli URL, leggibili con `blockedRequests()`) e imposta `RL_E2E_OFFLINE=1`. Limite: `fetch`/`http` di Node nel main non passano dalla sessione e non sono bloccati; il codice sotto test deve usare `net` di Electron;
  - `env`: variabili aggiuntive. Il valore di `RL_FIXTURE_LIBRARY` non viene mai passato all'app.
  - `verifyLibraryUntouched(exclude?)` fallisce se qualcosa fuori da `.lab/` e dalle cartelle `exclude` è cambiato dall'avvio; `close()` chiude l'app e cancella tutte le cartelle temporanee (e all'uscita del processo c'è comunque una pulizia di riserva).
- `test` in `test.ts`: estensione di Playwright con le fixture `library` e `app` che eseguono il controllo di non distruzione **dopo ogni test**:

  ```ts
  import { test, expect } from './helpers/test';
  test.use({ libraryKind: 'edge', exportDirs: ['export'] });
  test('...', async ({ app }) => { /* app.window, app.library.manifest */ });
  ```

  Con `libraryKind: 'real'` il test viene saltato se `RL_FIXTURE_LIBRARY` non c'è.
- Esempi e test dell'harness stesso: `e2e/qa-harness.spec.ts`.

## Verifica di generalità

`npm run check:generality` scansiona i file tracciati da git in `apps/`, `packages/`, `e2e/`, `tools/` e nella radice (non `docs/`, lockfile, binari; i file nuovi vanno prima aggiunti con `git add`). Esce con 1 elencando `file:riga [regola]`, senza mai stampare il testo trovato. Un'eccezione legittima si segna sulla riga con un commento `generality-allow: <motivo>`; le eccezioni sono contate ed elencate.

L'elenco locale `tools/generality.local.json` (`{ "patterns": ["..."] }`, sottostringhe senza distinzione di maiuscole) è ignorato da git: copialo nel worktree per usarlo, non committarlo. Nei messaggi compare solo l'indice del pattern; i nomi di file che lo contengono sono mascherati con `***`.

## Non distruzione

Libreria `@rl/testkit`: `snapshotTree(root, { exclude })` → mappa percorso relativo → `{ type, sha256, size, mtimeMs }`; `diffSnapshots(prima, dopo)` → `{ added, removed, modified, touched, clean }` (`touched` = stesso contenuto ma mtime diverso, solo avviso).

Da riga di comando:

```
npm run check:nondestructive -- <radice> --exclude .lab --exclude export --snapshot snap.json --save
npm run check:nondestructive -- <radice> --exclude .lab --exclude export --snapshot snap.json
npm run check:nondestructive -- <radice> --exclude .lab --run "<comando>"
```

`--run` salva lo snapshot, esegue il comando e confronta. Codice di uscita 1 se un file è stato aggiunto, rimosso o modificato.

## `@rl/testkit`

Solo per i test: non importarlo dal codice dell'app. Dipendenza dev di qualunque pacchetto: `"@rl/testkit": "*"`.

- `createFixtureLibrary(kind, { seed?, longPath?, parent? })` → `{ root, manifest, cleanup }`. `kind`: `papers` (paper normali con titolo, autori fittizi, abstract, id arXiv e DOI nel testo e nei metadati), `edge` (PDF solo immagine, nomi con spazi e accenti, annidamento, `.md`/`.txt`/`.tex`, PDF ostile con istruzioni nascoste in testo bianco, minuscolo e nei metadati con un canarino `RL-CANARY-...`, percorso oltre 260 caratteri), `full` (entrambi), `it` e `en` (librerie monolingua).
- `manifest.files[]`: `relPath`, `kind`, `format`, `language`, `title`, `authors`, `abstract`, `keywords`, `arxivId`, `doi`, `hasText`, `pages`, `sha256`, `size`, `hostile?`; `manifest.dirs`, `manifest.get(rel)`, `manifest.byKind(kind)`.
- `withRealFixtureCopy()` → copia temporanea (senza `.lab/` in radice) o `null` se `RL_FIXTURE_LIBRARY` non è valorizzata (il test va saltato; `realFixtureSkipReason()` dà il motivo).
- Utilità: `pdfContainsText`, `pdfStreamsText`, `listTree`, `removeTree`, `fsPath` (prefisso `\\?\` per i percorsi lunghi su Windows).

Sui percorsi lunghi: il codice che legge la libreria su Windows deve poter aprire percorsi oltre 260 caratteri (prefisso `\\?\`); le fixture li creano apposta.

## Libreria reale

Il percorso reale non va scritto in nessun file. Si passa solo come variabile d'ambiente al comando:

```
RL_FIXTURE_LIBRARY="<cartella della libreria>" npm run test:e2e
```

In PowerShell: `$env:RL_FIXTURE_LIBRARY = "<cartella>"; npm run test:e2e`. La cartella viene solo letta e copiata (senza `.lab/`) in una cartella temporanea; i test lavorano sulla copia. Senza variabile i test che la usano sono saltati.
