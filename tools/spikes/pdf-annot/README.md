# Prova S2: scrittura di annotazioni nel PDF per aggiornamento incrementale

Prototipo dell'onda 0 (ARCHITETTURA-UI §8.3.13). Nessun file dell'app è toccato: tutto sta in `tools/spikes/pdf-annot/`. Serve a misurare peso, tempi e rischi **prima** del compito G4a; il codice non è quello definitivo (manca il piano di riconciliazione a tre, la cifratura dei contenuti per G4c e la verifica completa del passo 6).

## Cosa c'è

| File | Contenuto |
| --- | --- |
| `objects.ts` | modello degli oggetti PDF, lexer con limiti (profondità 64, stringhe 64 KiB), serializzatore, testo UTF-16BE |
| `doc.ts` | lettura ad accesso casuale (`Source`): catena xref (tabella, stream xref con predittore PNG, ibridi con `/XRefStm`, `/Prev` con rilevamento di cicli), stream di oggetti, albero delle pagine con `/Count` |
| `classify.ts` | classificatore dei rifiuti; controllo della password utente vuota (gestore standard R2-R6, senza decifrare contenuti) |
| `writer.ts` | `buildUpdate()`: aggiunta e rimozione di `/Highlight` e `/Underline` (`/NM`, `/QuadPoints`, `/C`, `/AP`), sezione xref dello stesso tipo dell'ultima, `/Prev`, `/ID`; `listOurs()` |
| `geom.ts` | `pageGeometry()` e `toPdfRects()` (CropBox, `/Rotate`, `/UserUnit`) |
| `*.test.ts`, `pdfs.ts`, `pdfjs.ts` | test con PDF sintetici (pdf-lib e testo scritto a mano) riletti con pdf.js `getAnnotations()` |
| `bench.test.ts`, `library-scan.test.ts`, `sync-probe.test.ts`, `samples.test.ts` | prove a richiesta (variabili d'ambiente, vedi sotto), saltate nei test normali |
| `samples/` | 5 PDF sintetici da aprire a mano |

Nessuna dipendenza nuova: pdf-lib serve solo a generare i PDF di prova, pdf.js solo a rileggerli.

```
npx vitest run tools/spikes/pdf-annot                       # 23 test, circa 1 s
RL_S2_BENCH=1 [RL_S2_SIZES=1,20,100] npx vitest run tools/spikes/pdf-annot/bench.test.ts
RL_FIXTURE_LIBRARY=<cartella> npx vitest run tools/spikes/pdf-annot/library-scan.test.ts   # sola lettura, solo conteggi
RL_S2_SAMPLES=1 npx vitest run tools/spikes/pdf-annot/samples.test.ts                      # rigenera samples/
```

## Peso del codice (soglia di arresto: 44 KiB)

| Misura | Valore |
| --- | --- |
| Sorgente TypeScript (objects, doc, classify, writer, geom), con tipi e commenti | 747 righe, 35,1 KiB |
| Bundle come lo includerebbe la build principale (rolldown, ESM, senza minificazione né commenti, solo `node:*` esterni) | **29,3 KiB**, 974 righe non vuote |
| Stesso bundle minificato (solo informativo) | 18,4 KiB |

**29,3 KiB: sotto la soglia di 44 KiB.** Dentro ci sono già il classificatore e il controllo della password vuota (R2-R6, circa 3 KiB). Non ci sono: il piano di riconciliazione a tre (stima 250 righe, 6-8 KiB), la verifica strutturale del passo 6 oltre a `listOurs()` (1-2 KiB), la cifratura per oggetto di G4c (6-8 KiB, contata a parte nel budget). Proiezione onesta per G4a completo: **circa 37-40 KiB**, ancora sotto 44 ma con poco margine; G4c si somma come previsto da D-380.

## Tempi per scrittura (PDF sintetici da 1, 20 e 100 MB)

Un PDF valido di 20 pagine più una revisione con un grande flusso di riempimento, generato in una cartella temporanea nell'area di lavoro (mai versionata). Mediana di 3 prove, disco locale con cache calda per la lettura. Ultima sezione xref: tabella classica e stream xref, risultati equivalenti.

| Dimensione | Piano (classificare + costruire l'aggiornamento) | SHA-256 dell'intero file | Commit `'rename'` (copia + scrittura + `fsync` + rinomina) | Commit `'append'` (`r+`, scrittura, `fsync`) |
| --- | --- | --- | --- | --- |
| 1 MB | 1,3 ms | 1,8 ms | 4,4 ms | 1 ms |
| 20 MB | 1,3-2,1 ms | 10 ms | 51-55 ms | 2 ms |
| 100 MB | 1,4-2,3 ms | 42 ms | 325-362 ms | 4 ms |

Il 100 MB è stato eseguito con 2,3 GB di RAM libera (soglia 2 GB), un file alla volta. Il piano non dipende dalla dimensione (il parser legge solo coda, xref e oggetti toccati); il costo del commit `'rename'` è tutto nella copia. L'hash completo (necessario in entrambi i modi) pesa circa 0,4 s ogni GB a cache calda; a freddo sarà dominato dal disco. Il tempo massimo di 10 s per file nel worker è lontanissimo.

## Rifiuti sulla libreria di prova (sola lettura, solo conteggi)

La cartella è stata solo **aperta in lettura** (21 PDF, 103 MB in totale, nessuno solo nel cloud): nessuna scrittura, copia o modifica, nessun nome nel rapporto.

| Voce | Conteggio |
| --- | --- |
| PDF esaminati | 21 |
| Accettati dal classificatore | 21 |
| Piano di aggiunta costruibile in memoria (poi scartato) per gli accettati | 21 su 21 |
| Rifiutati per motivo (`encrypted`, `permission`, `signed`, `xfa`, `damaged`, `unsupported`) | 0, 0, 0, 0, 0, 0 |
| Cifrati con password utente vuota | 0 su 21 (0%) |
| Con dati dopo l'ultimo `%%EOF` | 0 su 21 (0%) |
| Ultima sezione xref: tabella classica / stream xref / ibrida | 13 / 8 / 0 |
| Con più di una revisione (già aggiornati in modo incrementale) | 3 |
| Tempo di classificazione per file (massimo / totale) | 4,6 ms / 33 ms |

Il campione è piccolo: con 21 file, "0 cifrati" è compatibile con una quota reale fino a circa il 14% (limite superiore al 95%), quindi **non basta a decidere** le soglie del 2% (G4c) e del 5% (`damaged`). La decisione D-375 di fare G4c sempre resta quella giusta. Il classificatore separa comunque le due categorie e le conta (`library-scan.test.ts` può girare su una libreria più grande senza cambiare nulla).

I test sintetici coprono tutti i motivi: cifrato (gestore diverso, password non vuota, password vuota con e senza il bit 6 di `/P`), `/SigFlags 3` con firma (un campo firma vuoto non rifiuta, D-351), `/XFA`, troncato, `startxref` errato, `/Prev` ciclico (su sé stesso e in anello attraverso una revisione scritta), dati dopo `%%EOF` (accettati e riportati come `trailingBytes`), 300 mutazioni casuali senza eccezioni non gestite.

## Doppio disegno (§8.3.7): scelta (a)

Verificato con pdf.js (`double-draw.test.ts`, sul `getOperatorList` con `annotationMode`): in un file con un'annotazione nostra e una di un altro programma, `ENABLE` disegna 2 annotazioni, `DISABLE` 0, e `ENABLE_STORAGE` con `annotationStorage.setValue('<objNum>R', { noView: true })` ne disegna **1: salta la nostra e lascia quella estranea**. L'identificatore di pdf.js è `<objNum>R` (più la generazione se diversa da 0), cioè deriva da `pdf.objNum/gen` già salvati nell'annotazione dell'app: non serve leggere `/NM` dal lettore.

- **(a) annotationStorage, scelta consigliata**: l'app ha sempre la sua sovrapposizione come unica a disegnare le proprie annotazioni, anche quelle scritte e anche quelle modificate in attesa di una nuova scrittura; la tela non le disegna mai, quindi nessun doppio disegno in nessuno stato (criterio di §8.3.7). Le annotazioni di altri programmi restano disegnate dalla tela.
- (b) saltare gli oggetti `/NM (rl-…)` filtrando gli `annotationId`: è lo stesso meccanismo di (a) (pdf.js non ha un filtro per annotazione oltre allo storage, e `annotationMode: DISABLE` spegne anche le estranee); si riduce ad (a).
- (c) non sovrapporre le scritte e ridisegnare dopo ogni scrittura: mostra la versione vecchia di una modifica (colore, commento) finché non arriva la scrittura successiva (fino a 10 minuti, D-349), cioè esattamente il doppio disegno o l'incoerenza che il criterio vieta; scartata.

Costo di (a): ridisegnare la tela della pagina quando cambia l'insieme degli id nascosti (già necessario alla prima scrittura di una nuova annotazione).

## `rl-doc://` tiene il file aperto?

Letto `apps/desktop/src/main/doc-protocol.ts` e `ipc/handlers/doc-files.ts`: **no, solo durante la risposta**. A ogni richiesta (anche a intervalli, `Range`) `openPdfHandle` apre il file in `'r'`; per `HEAD`, intervallo non soddisfacibile e corpo vuoto la maniglia si chiude subito (`fh.close()`), altrimenti il flusso `createReadStream({ autoClose: true })` la chiude a fine trasmissione o quando il lettore annulla. Nessuna maniglia o cache vive tra una richiesta e l'altra. Una richiesta lunga (file da centinaia di MB scaricato in streaming) tiene la maniglia per la sua durata.

Misura utile per §8.3.4, fatta con Node su Windows: la rinomina con sostituzione sopra un file che un'altra maniglia ha aperto in lettura **fallisce con `EPERM`** (anche con le condivisioni di Node), quindi i tentativi a 200/600/1500 ms e lo stato `pending: locked` servono davvero per `'rename'` mentre una richiesta `rl-doc://` è in corso; l'aggiunta in coda (`'append'`) riesce invece anche con il file aperto in lettura altrove.

## `commitStrategy`: `'rename'` contro `'append'` (cartella sincronizzata di prova)

Prova locale con il client di sincronizzazione in esecuzione, in una cartella sincronizzata di prova creata apposta con 4 PDF sintetici (2 per modo, uno con stream xref), un flusso `Zone.Identifier` aggiunto a ciascuno, attesa di 30-45 s dopo ogni giro. Due esecuzioni: 4 giri a 1,5 s e 8 giri a 0,1 s. La cartella è stata **cancellata del tutto** al termine.

| Osservazione | `'rename'` | `'append'` |
| --- | --- | --- |
| Identità del file (`fsutil file queryfileid`) | **cambia** a ogni scrittura | invariata |
| Data di creazione | **diventa quella della scrittura** | invariata |
| Attributo `ReparsePoint` (segnaposto del servizio) | **sparisce subito** e ricompare dopo la sincronizzazione (entro 40 s) | sempre presente |
| Flusso `Zone.Identifier` | conservato (`CopyFileW`) | conservato |
| Copie in conflitto o file strani nella cartella | nessuna | nessuna |
| Tempo a 100 MB (senza hash) | 325-362 ms | 4 ms |
| Atomicità, verifica prima della visibilità | sì | no (finestra di pochi ms; recupero col registro) |

Limiti della prova: un solo computer, quindi le copie in conflitto vere (due computer che scrivono prima di sincronizzarsi) non si possono riprodurre qui; la cronologia delle versioni e il numero di caricamenti non sono osservabili in locale. Nessuno dei due modi ha prodotto copie in conflitto, nemmeno con scritture ogni 100 ms.

**Raccomandazione:** tenere `'rename'` come predefinito (D-349). Il file diventa visibile solo dopo la verifica e resta atomico; gli effetti misurati (nuova identità, data di creazione, segnaposto momentaneamente perso) sono quelli già accettati nel §8.3.3 passo 5 e non hanno causato conflitti. `'append'` è molto più economico e conserva tutto, ma non è atomico e richiede registro di troncamento e revisione security: da considerare solo se l'uso reale con due computer mostrasse copie in conflitto o perdita di segnaposto con `'rename'. Resta una decisione nuova, come scritto nel §8.3.4.

## File sintetici da aprire a mano in Edge e Chrome

In `samples/` (tutti sotto 4 KB, contenuto sintetico; ogni pagina dice cosa aspettarsi). Verificati con pdf.js (sottotipi, colori, rettangoli) e il 1 e il 3 disegnati su canvas con pdf.js e guardati: giallo e blu corretti, testo leggibile sotto l'evidenziazione, la pagina ruotata segue il testo.

1. `sample-1-classic.pdf`: tabella xref classica; evidenziazione GIALLA sulla riga 1, sottolineatura BLU sulla riga 2.
2. `sample-2-xref-stream.pdf`: stream xref e stream di oggetti; evidenziazione VERDE, sottolineatura ROSSA.
3. `sample-3-rotated-90.pdf`: pagina ruotata di 90 gradi; evidenziazione ROSA e sottolineatura ARANCIO che seguono il testo.
4. `sample-4-cropbox.pdf`: `CropBox` spostato; evidenziazione GIALLA e sottolineatura BLU.
5. `sample-5-comments.pdf`: con `/Contents`; il commento deve comparire al passaggio del mouse o nell'elenco delle annotazioni.

Da controllare a mano: colore giusto, sottolineatura sotto la riga (non attraverso il testo), testo ancora leggibile sotto l'evidenziazione (Edge e Chrome usano `/AP`, quindi la miscelazione `Multiply` dev'essere rispettata).

## Rischi e limiti emersi

- La linearizzazione si perde dopo un aggiornamento (pdf.js e gli altri lettori leggono il file normalmente, ma perdono la visualizzazione veloce): atteso, non è un errore.
- Negli ibridi la precedenza è: voci in uso della tabella, poi `/XRefStm`, poi i liberi della tabella, poi `/Prev` (gli oggetti negli stream di oggetti sono "liberi" nella tabella): testato.
- Offset xref relativi a un'intestazione preceduta da spazzatura, e flussi con `/Length` sbagliato fuori dagli stream xref/ObjStm, non sono gestiti: finirebbero in `damaged` (nessuno nella libreria di prova).
- Tutti i file sintetici riletti da pdf.js mostrano le annotazioni; non è però una prova su PDF reali di terze parti oltre ai 21 della libreria (per i quali si è costruito, non scritto, l'aggiornamento).
- Cifrati con password vuota: qui solo riconosciuti (R2-R6, con un test sintetico R3); scriverci richiede la cifratura per oggetto di G4c.
- Un test di mutazione casuale (300 casi) non ha prodotto eccezioni diverse dall'errore tipizzato del parser; il corpus ostile completo resta alla revisione security di G4a.
