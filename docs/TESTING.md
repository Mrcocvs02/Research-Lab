# Test e verifiche

Tutti i comandi si lanciano dalla radice del repository (in Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"`).

| Comando | Cosa fa |
| --- | --- |
| `npm run typecheck` | `tsc` sui quattro progetti (radice, main, renderer, e2e) |
| `npm test` | Vitest: `packages/*/src`, `apps/*/src`, `tools/**` |
| `npm run test:e2e` | compila l'app e lancia Playwright per Electron (`e2e/`) |
| `npm run test:phase1` | compila e lancia i quattro spec del criterio della fase 1 (vedi sotto) |
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

## Variabili `RL_*`

`RL_E2E`, `RL_E2E_DIALOG_PATH`, `RL_USER_DATA_DIR`, `RL_LOCAL_DATA_DIR` ed `ELECTRON_RENDERER_URL` valgono solo per l'app non impacchettata (sviluppo e test); l'app installata le ignora (D-014, D-015).

## Criterio della fase 1 (scansione, ricerca, osservatore)

`npm run test:phase1` compila l'app e lancia `qa-offline`, `qa-scan-nondestructive`, `qa-search-perf`, `qa-watcher` (in `e2e/`). Un singolo spec: `npx playwright test -c e2e/playwright.config.ts qa-watcher` (dopo `npm run build`). I tempi (scansione, mediana/p95/massimo delle query) escono nel log come righe `[perf]` e nelle annotazioni del test (`scan-ms`, `search-p95-ms`).

| Spec | Cosa verifica |
| --- | --- |
| `qa-offline.spec.ts` | app con `offline: true` su un corpus sintetico da 40 documenti; libreria creata dalla procedura guidata (override del dialog), attesa della scansione, ricerca di una parola sentinella del titolo e di una del corpo di un PDF (documento giusto e pagina giusta), `blockedRequests()` vuoto, nessun file fuori da `.lab` cambiato |
| `qa-scan-nondestructive.spec.ts` | libreria `full` (accenti, percorso oltre 260 caratteri, PDF ostile, PDF solo immagine) e, se c'è `RL_FIXTURE_LIBRARY`, copia di quella reale: dopo la scansione nulla fuori da `.lab` è aggiunto, rimosso, modificato o toccato (mtime); `.lab/documents` ha un file `<id>.json` per documento, senza file temporanei né percorsi assoluti |
| `qa-search-perf.spec.ts` | corpus da 1000 documenti su disco; scansione cronometrata (nessuna soglia); 20 query tipiche via `search:query` dal renderer: p95 sotto 200 ms; le query con risposta certa devono dare risultati |
| `qa-watcher.spec.ts` | file aggiunto alla radice con l'app aperta: compare nella ricerca; rinominato: stesso id (`documents:get`) e nessun duplicato; modificato: stesso id; gli originali presenti all'avvio restano identici |
| `security-hostile-scan.spec.ts` | PDF ostile generato a runtime (un milione e mezzo di operatori di testo) tra i documenti normali, con i tempi del watchdog accorciati (`RL_WORKER_FILE_TIMEOUT_MS`, `RL_WORKER_PAGE_TIMEOUT_MS`, solo in sviluppo): la scansione termina, i normali sono cercabili, scan:cancel non blocca, l'app si chiude. Nel log di test esce l'esito (`[hostile-scan]`) |

**Salto pulito.** Ogni canale viene chiamato con un payload non valido (`42`, mai un'azione); se non esiste (`UNKNOWN_CHANNEL`) o non ha un gestore (`NOT_IMPLEMENTED`) il test è saltato con il messaggio "phase 1 runtime not merged yet: missing IPC channel(s) ...". Con il runtime unito i test girano per intero.

**Dipendenze dai contratti.** Gli spec usano i test id `search-input`, `search-result`, `scan-status` e i canali `scan:start`, `search:query` (payload `{ text, limit }`), `documents:list` (`{ limit }`, poi `{}`), `documents:get` (`{ id }`, poi `{ docId }`). Le risposte si leggono in modo tollerante (un array, o un oggetto che ne contiene uno; id da `docId`/`id`, titolo, pagina): se il runtime sceglie altre forme basta adattare `e2e/helpers/phase1.ts`. La fine della scansione è decisa dal numero di documenti e, per librerie di dimensione ignota, dalla sua stabilità.

Helper in `e2e/helpers/phase1.ts`: `ipc`/`ipcData` (chiamata dal renderer con `window.rlBridge.invokeRaw`), `skipUnlessChannels`, `createLibraryViaWizard`, `waitForScan`, `waitForScanSettled`, `searchViaUi`, `searchHits`, `getDocument`, `percentile`. `launchApp` accetta anche `library: { corpus: N, options }` (generato da `generateCorpus`; manifest in `app.library.corpus`).

### Generatore di corpus (`@rl/testkit`)

- `generateCorpus(n, opts)` → `{ root, manifest, cleanup }`: `n` documenti (almeno 6) in una cartella temporanea, per lo più Markdown e testo, quota `pdfShare` di PDF piccoli (default 5%), cartelle e sottocartelle, vocabolario inventato (termini scientifici, sigle, parole italiane con accenti), contenuto unico per documento (ogni file ha il suo id). Stesso `seed`, stesso corpus. Mille documenti in circa 1,3 s.
- Parole sentinella (`SENTINEL_WORDS`, una sola occorrenza in tutto il corpus): `zorquantel` nel titolo, `velmarixon` nell'abstract, `quillanbrox` nel corpo di un PDF a pagina `sentinelPage` (default 3), `drivostenal` nel corpo di un Markdown, `ménagèrix` (con accenti) in un titolo. `manifest.sentinel('title' | 'abstract' | 'body', formato?)` dà parola, forma senza accenti (`folded`), pagina, percorso e titolo.
- `manifest.files[]` (titolo, autori, abstract, pagine, hash, `topicTerm` presente solo in quel documento), `manifest.queries` (20 query tipiche: termini rari, coppie, parole comuni, sigle, accenti, sentinelle; `expectRelPath` quando la risposta è certa), `manifest.get(relPath)`.
- `generateIndexableDocuments(n, opts)` → `{ documents: IndexableDocument[], manifest }`: gli stessi documenti come oggetti per benchmark dell'indice, senza disco. `generateCorpusManifest(n, opts)` dà solo il manifest.

`apps/desktop/src/main/library/watchdog.test.ts` lancia un VERO worker thread (compilato al volo con vite in `apps/desktop/out/test-worker`) con un estrattore finto che si blocca in un ciclo sincrono (`hang-*`), esaurisce la memoria (`oom-*`) o termina il thread (`crash-*`): watchdog, cancel, close e ripartenza del worker.

## Test leggeri e pesanti, memoria

I test pesanti girano solo con `RL_HEAVY_TESTS=1`, uno script alla volta e mai in parallelo con altro lavoro pesante:
- `npm run test:heavy`: benchmark dell'indice (1000 documenti + 25 lunghi), worker che esaurisce la memoria, file ostili che si gonfiano a 64-256 MiB;
- `npm run test:e2e:heavy`: spec con tag `@heavy` (ricerca su 1000 documenti, scansione con PDF ostile).

Picchi di memoria misurati con `tools/mem-sample.mjs` (2026-11-16, macchina di sviluppo): `npm test` ~0,6 GiB; `npm run test:e2e` ~0,9 GiB (più la build); test pesanti ~1,1 GiB ciascuno.
Ogni script controlla prima la memoria disponibile (`tools/mem-guard.mjs`: 1,2 GiB unitari, 2 GiB e2e, 2,5 GiB pesanti) e interrompe il comando se durante l'esecuzione la memoria disponibile scende sotto la soglia di `--abort-below` (`tools/mem-sample.mjs`). `RL_SKIP_MEM_GUARD=1` salta solo il controllo iniziale.

## Fase 3, dati dello studio
- Unitari: `apps/desktop/src/main/doc-protocol.test.ts` (intervalli, 416, 404/403 senza percorsi, altra libreria, giunzione fuori radice, CORS solo per `rl-app://app`, OPTIONS) e `apps/desktop/src/main/ipc/study-handlers.test.ts` (`reader:open`, `reader:openLink`, note: conflitto, corpo vuoto, concorrenza, reindicizzazione ed evento; annotazioni: limite, `stale`, flag "sottolineato", file originale mai scritto).
- E2E: `e2e/study-data.spec.ts` (una libreria sintetica `papers`): `fetch` con `Range` dal renderer verso `rl-doc`, rifiuti, note e annotazioni che sopravvivono a chiusura e riapertura, ricerca per una parola presente solo in una nota o in un'annotazione, SHA-256 dei PDF identico prima e dopo. Si lancia da solo, più `smoke` e `qa-security` quando cambia la CSP.

## Budget di leggerezza
- `tools/budgets.json` fissa le soglie: JS iniziale del renderer (script di `index.html`, import statici e dizionario della lingua attiva), JS e totale del renderer, JS del main, preload, memoria totale a riposo e tempo al primo contenuto. Valori misurati dopo l'ottimizzazione più il 15 %; alzarli richiede una decisione in `DECISIONS.md`.
- `npm run check:budget` (dopo `npm run build`) controlla le dimensioni dei bundle e dice quale soglia è superata e quali chunk carica la prima schermata; `node tools/check-budget.mjs --json` stampa i valori misurati.
- `e2e/qa-budget.spec.ts` (`npx playwright test -c e2e/playwright.config.ts qa-budget`, dopo la build): libreria sintetica di 40 documenti creata e scansionata, poi secondo avvio; misura il tempo dall'avvio del processo alle prime righe della vista Libreria e la somma dei working set di `app.getAppMetrics()` dopo 10 s di inattività (il worker si chiude dopo 3 s con `RL_WORKER_IDLE_MS`). Stampa `BUDGET-MEASURE {...}`. Le soglie di tempo dipendono dalla macchina: un superamento isolato va ripetuto prima di indagare.

## Studio (fase 3, dati)
- Unit: `apps/desktop/src/main/doc-protocol.test.ts` (intervalli, 416, rifiuti, CORS) e `ipc/study-handlers.test.ts` (lettore, note, annotazioni, flag).
- E2E: `e2e/study-data.spec.ts` (dopo `npm run build`): `fetch` con `Range` di `rl-doc://` dal renderer, id estraneo rifiutato, note e annotazioni dopo il riavvio, ricerca per una parola presente solo nella nota, SHA-256 dei PDF invariato.

## Miniature della griglia (onda 3.2)

- Unit: `apps/desktop/src/main/thumbs.test.ts` (list, put, pulizia, schema `rl-thumb`), `thumbs-native.test.ts` (`nativeImage` finto: successo, errore, scadenza, icona/vuota/uniforme, piattaforma non supportata, memo di sessione, confinamento), `renderer/src/lib/thumbs.test.ts` (coda, un disegno alla volta, ripiego da nativo a pdf.js), `thumbDraw.test.ts` (dimensioni, qualità, pulizia, worker), `views/library/thumbs.test.ts` (cablaggio della griglia).
- E2E: `e2e/thumbs.spec.ts` (dopo `npm run build`): accetta come sorgente sia la miniatura del sistema sia il disegno con pdf.js (la macchina può non avere un gestore PDF); un'immagine `rl-thumb:` con `naturalWidth` > 0, dopo il riavvio `thumbs:list` dà URL e `drawable: false`, SHA-256 dei PDF invariato. Si lancia con `ui-library`, `study-ui` e `qa-security` (cambia la CSP), in serie.

