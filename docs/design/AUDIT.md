# Audit di design di Research Lab (stato attuale, main c1b9ac2)

Autore: agente "designer avversario". Data: 2026-11-17. Stato del documento: **parziale** (vedi "DA COMPLETARE" in fondo).

Metodo: `e2e/design-audit.spec.ts` (saltato senza `RL_DESIGN_AUDIT=1`) avvia l'app compilata su librerie sintetiche (`it`, `en`) con il fornitore AI simulato e la rete tagliata, attraversa la procedura guidata e tutte le viste raggiungibili, salva uno screenshot per schermata in `audit-shots/` (ignorata da git, mai committata) e misura per schermata: clic dalla Libreria, controlli visibili, errori di console, elementi tagliati o fuori finestra, contrasto WCAG del testo, ordine del Tab. Prima esecuzione completa (138 schermate, italiano) in `audit-shots/run1/` con `run1/metrics-it.json`; la seconda esecuzione è stata interrotta di proposito (16 schermate in `audit-shots/`).

Macchina di misura: finestra fuori schermo, `devicePixelRatio` = 1,198 (scala di Windows frazionaria). Tutte le misure sotto sono in pixel CSS salvo dove indicato.

---

## Sintesi: i 15 problemi più gravi (per impatto)

1. **critico — Il PDF nel lettore è deformato e le evidenziazioni finiscono fuori posto.** La regola globale `.page { max-width: 860px; padding: … }` dell'app (`apps/desktop/src/renderer/src/styles.css:451-454`) colpisce anche i `div.page` di pdf.js. Quando la pagina adattata alla larghezza supera 860 px il riquadro viene schiacciato in larghezza mentre l'altezza resta: a 1920×1080 la pagina è 860×1815 invece di 1285×1815 (rapporto 0,474 contro 0,707 del PDF: scala orizzontale 0,67). Lo strato di testo resta largo 1285 px, quindi selezione ed evidenziazioni non coincidono con i glifi e compare una barra di scorrimento orizzontale. Dettagli nella sezione Lettore. Evidenza: `run1/it-046-reader-open-fit-light-1920x1080.png`.
2. **critico — Il CSS di pdf.js (`pdf_viewer.css`, importato globalmente da `views/reader/engine.ts:2`) contamina tutta l'app dopo la prima apertura del lettore.** Le sue regole `.sidebar` (bordo arrotondato, ombra, `width: 239px`, padding) e `.dialog` hanno lo stesso nome delle classi dell'app: dopo aver aperto un PDF la barra laterale diventa una "carta" fluttuante con ombra in tutte le viste, fino al riavvio. Evidenza: confronta `run1/it-010-library-home-light-1280x800.png` (prima) con `run1/it-049-projects-empty-light-1280x800.png` (dopo).
3. **critico — Sottolineare ed evidenziare: flusso "prima seleziono, poi scelgo" e nessuno strumento.** Non c'è una modalità strumento (sposta / evidenziatore / sottolineatura / colore) né la scorciatoia Spazio per alternare l'ultimo pennello: si trascina una selezione, compare una barra in basso (`run1/it-036-reader-selection-bar-light-1280x800.png`) con due pulsanti primari identici "Evidenzia"/"Sottolinea", 5 pallini di colore e un campo commento. Ogni annotazione costa 3 azioni e lo sguardo deve andare in fondo alla finestra. Dopo il salvataggio la vista non resta sul punto annotato (in `run1/it-037-…` la pagina mostrata è la 2, l'evidenziazione era a pagina 1).
4. **alto — Le impostazioni sono un'unica pagina di 7981 px (10,6 schermate a 1280×800), 10 sezioni, 119 controlli, senza indice né ricerca.** Ordine casuale per l'utente (profilo, librerie, libreria attiva, fonti online, AI, MCP, chiavi API, backup, scorciatoie, manutenzione); impostazioni da sviluppatore (id dei modelli, porta MCP, token, prezzi) mescolate con quelle di tutti. Lingua dell'interfaccia presente due volte (barra laterale e impostazioni). Evidenza: `run1/it-068…`, fatto `pre-settings-length` in `run1/metrics-it.json`.
5. **alto — Cambiare account Claude non si può dall'app.** La sezione "Claude (AI)" mostra solo "Fornitore / Accesso / Disponibile" in un elenco non stilizzato (rientri del browser) e un testo che rimanda alla riga di comando di Claude Code; non esiste un pulsante "Esci", "Cambia account" o "Accedi", né l'indicazione di quale account è in uso. La chiave API è un'alternativa nascosta più in basso. Evidenza: `run1/it-073-pre-settings-05-Claude_AI_-light-1280x800.png`, `run1/it-094-settings-ai-account-area-light-1280x800.png`.
6. **alto — Il badge "Arrivi" non dice cosa conta.** Un PDF scaricato direttamente nella cartella della libreria compare subito nella Libreria **e** accende "Arrivi 1": l'utente vede lo stesso documento in due posti senza sapere che deve "confermarlo". Il badge non ha tooltip (`title` assente; solo `aria-label` "1 file nella posta in arrivo"), il nome della sezione è "Arrivi", la scheda interna "Arrivi", la tablist "Posta in arrivo", e le "Proposte dell'AI" stanno nella stessa sezione ma non sono contate dal badge. Evidenza: `run1/it-064-inbox-badge-hover-light-1280x800.png`, `run1/it-065-inbox-flagged-library-file-light-1280x800.png`.
7. **alto — Scansionare una libreria è nascosto.** "Scansiona ora" è un pulsante generico nella seconda riga della barra della Libreria accanto a "Tassonomia", e "Ricostruisci l'indice" è un link isolato su una terza riga; durante la scansione il pulsante diventa "Annulla la scansione" e sposta tutta la barra (`run1/it-025-taxonomy-node-editor-light-1280x800.png`). Nessuna voce nella palette dei comandi per la scansione, nessuno stato visibile fuori dalla barra di stato ("Cerco i file... 0").
8. **alto — Le evidenziazioni non sono nel PDF e l'app non lo dice.** Per regola 1 gli originali non si toccano: corretto, ma nel lettore non c'è una sola riga che spieghi "le evidenziazioni vivono nell'app, non nel file: aprendo il PDF altrove non le vedrai", né un'azione "Esporta una copia annotata". L'unica frase vicina è nella guida ("salvate nella cartella della libreria e viaggiano con essa"). In più la casella "Sottolineato" della barra di studio, che si spunta da sola "dalle tue evidenziazioni", fa credere che il documento sia stato sottolineato davvero.
9. **alto — Nel lettore lo spazio per il PDF è minimo.** Due barre di strumenti (titolo, pagine, zoom, "Adatta alla larghezza", "Cerca", "Note ed evidenziazioni" che va a capo) più una riga "studio" con un paragrafo di scorciatoie di 4 righe occupano 200 px su 800; a 1024×700 l'area del PDF è 405×389 px (`run1/it-047-reader-open-fit-light-1024x700.png`). "di 2" va a capo, le schede del pannello laterale vanno su due righe.
10. **alto — La barra di stato è usata come area di notifica.** Messaggi lunghi ("Aggiornamento delle citazioni fallito: 0/4 fatti, 1 falliti · Una fonte online non è raggiungibile…", "Proposte AI pronte: 5/5 · <$0.01 Rivedi Nascondi") la fanno salire a 2-4 righe con link minuscoli; a 1024 px diventa alta 100 px (`run1/it-131-m-library-light-1024x700.png`). I toast dicono "Seguilo nella barra di stato" mentre la barra mostra già l'errore.
11. **alto — Con la chat aperta la Libreria si rompe.** Il campo di ricerca scende a ~120 px ("Titolo, autore,"), "Ordina per" e i filtri vanno a capo, i titoli sono troncati; a 1024 px la lista mostra due righe larghe 145 px (`run1/it-031-chat-open-no-folders-light-1280x800.png`, `run1/it-138-m-chat-light-1024x700.png`). Due pulsanti "Cronologia" visibili insieme indicano cose diverse (annulla/ripeti della libreria e conversazioni della chat).
12. **medio — Aprire la scheda di un documento richiede un secondo clic non scoperto.** Un clic seleziona e basta; la scheda si apre con un secondo clic sulla riga già selezionata, Invio, il pulsante "Scheda" della barra di selezione o l'icona "≡" che compare al passaggio. Il doppio clic apre il file nel programma esterno, mentre la guida dice "Fai doppio clic su un documento per aprirlo nel lettore" (contraddizione).
13. **medio — Gerarchia visiva piatta e barre affollate.** Tutti i pulsanti hanno lo stesso peso (bordo grigio, testo nero); nella Libreria la prima riga ha ricerca + "Chiedi a Claude" + Annulla + Ripeti + Cronologia, la seconda Elenco/Griglia + Ordina + Mostra mancanti + Tassonomia + Scansiona, la terza un link da solo. Nessuna icona nella barra laterale; nessun titolo di sezione coerente (la Libreria ha il titolo dentro la barra, Progetti ha i pulsanti attaccati al titolo, Rete ha il seme e "Ricostruisci" in alto a destra).
14. **medio — Testi obsoleti e incoerenze di linguaggio.** Dietro la procedura guidata aperta dalla barra laterale compare "Qui sfoglierai e cercherai i tuoi documenti. Questa sezione arriverà in una fase successiva." (`run1/it-095-wizard-again-from-sidebar-light-1280x800.png`). "Chiedi a Claude" accanto alla ricerca apre una ricerca AI, non la chat; "Esporta il secondo cervello" ed "Esporta come secondo cervello…" convivono nella palette; "Proposte dell'AI" sta sotto "Arrivi".
15. **medio — Cartella di arrivo: ogni file è un modulo completo.** La scheda di un arrivo occupa più di una schermata (Dati, Proposta, Tag, nome file, cartella…) anche quando i dati sono già giusti; nessuna vista a elenco con "conferma tutto"; "Modello" è separato dal suo menu e va a capo (`run1/it-062-inbox-empty-light-1280x800.png`, `run1/it-066-inbox-dropped-card-light-1280x800.png`).

---

## Lettore PDF

### Causa della deformazione (root cause)

- `apps/desktop/src/renderer/src/styles.css:451-454`:
  ```css
  .page { max-width: 860px; padding: var(--space-5) var(--space-6) var(--space-6); }
  ```
  È la classe delle pagine dell'app (Impostazioni, Progetti…), ma pdf.js chiama `page` ogni pagina del documento (`div.page[data-page-number]`). Con `box-sizing: border-box` globale (`styles.css:71-75`) il div della pagina riceve `max-width: 860px` e un padding di 24/32 px.
- pdf.js imposta larghezza e altezza della pagina come stile inline (`setLayerDimensions`, `width: round(down, var(--total-scale-factor) * 595px, …)`), e la tela (`canvas`) è `position:absolute; width:100%; height:100%` dentro il div (`pdf_viewer.css`, `.pdfViewer .canvasWrapper canvas`). Quando la larghezza calcolata supera 860 px, `max-width` la taglia; l'altezza resta quella calcolata: la bitmap (proporzioni giuste) viene stirata in un riquadro più stretto. Lo strato di testo (`.textLayer`) non ha la classe `page` e mantiene la larghezza vera.
- In più `apps/desktop/src/renderer/src/views/reader/engine.ts:2` importa `pdfjs-dist/web/pdf_viewer.css` intero: le sue regole `.sidebar` (riga 6168 del CSS di pdf.js) e `.dialog` (riga 418) collidono con le classi dell'app (problema 2).

Misure (`run1/metrics-it.json`, fatti `reader-geometry-*`; PDF A4, MediaBox 595×842, rapporto 0,7067):

| Finestra | Area del PDF | Riquadro pagina (div) | Tela CSS | Bitmap tela | Strato di testo | Rapporto pagina | Effetto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×800, adatta (81%) | 661×557 | 645×910 | 645×910 | 768×1092 | 645×910 | 0,709 | +0,8% in larghezza (arrotondamento a 5 px di pdf.js con DPR 1,198) |
| 1280×800, 100% | — | 790×1120 | 790×1120 | 948×1344 | 790×1120 | 0,705 | quasi esatto |
| 1024×700, adatta (49%) | 405×389 | 390×550 | 390×550 | 462×660 | 390×550 | 0,709 | +1,3% in larghezza |
| 1920×1080, adatta (162%) | 1300×895 | **860×1815** | **860×1815** | 1536×2178 | **1285×1815** | **0,474** | glifi compressi al 67% in larghezza, testo selezionabile largo 1,49× la tela |

Quindi: (a) la deformazione forte (fattore 0,67) avviene appena la pagina supererebbe 860 px, cioè a schermo largo, con il pannello laterale chiuso o con zoom > ~110%; i caratteri appaiono stretti e alti e lo strato di selezione non coincide più con il disegno; (b) sotto quella soglia resta una deformazione piccola ma reale (0,8-1,3%, nella direzione "più largo") dovuta al passo `--scale-round-x: 5px` che pdf.js calcola per un DPR frazionario come 1,198 e applica separatamente a larghezza e altezza. Il punto (a) è quello visibile; il punto (b) spiega un leggero allargamento dei titoli anche in finestre normali.

Come dovrebbe essere: nessuna classe globale generica (`.page`, `.sidebar`, `.dialog`) — classi dell'app con prefisso (`.rl-page`) o regole limitate (`.main > .page`), e il CSS di pdf.js caricato solo dentro un contenitore isolato (`.reader-scroll .pdfViewer …`, o un livello `@layer`/`@scope`); un test e2e che confronta il rapporto del riquadro della pagina con quello della MediaBox (tolleranza 0,5%) a 1280 e 1920 px.

### Altri risultati del lettore

- **alto** — Barra superiore su due righe a 1280 px: "Note ed evidenziazioni" va a capo; il campo pagina è largo quanto un campo di testo; "di 2" su due righe; il titolo è troncato a 241 px su 323 (misurato in 17 schermate). `run1/it-032-reader-open-fit-light-1280x800.png`.
- **alto** — Riga "studio" (Da leggere / In lettura / Letto / Sottolineato) più un paragrafo di scorciatoie lungo 4 righe sempre visibile: è documentazione, non interfaccia. Va in un tooltip o nella guida.
- **alto** — Annotazione: la barra appare in fondo alla finestra, lontana dalla selezione; "Evidenzia" e "Sottolinea" sono entrambi pulsanti primari blu; il colore si sceglie dopo aver selezionato; non c'è anteprima del colore sul testo selezionato; la sottolineatura è un bordo di 2 px che a zoom basso quasi non si vede (`run1/it-038-reader-after-underline-light-1280x800.png`).
  Come dovrebbe essere: barra degli strumenti verticale o in testa con strumenti a stato (Sposta/Seleziona `V`, Evidenziatore `H`, Sottolineatura `U`, colore attivo visibile come pallino sull'icona); con uno strumento attivo il trascinamento sul testo crea subito l'annotazione; Spazio alterna strumento corrente e ultimo usato; Esc torna a Sposta; il commento si aggiunge cliccando l'annotazione (popover accanto, non in fondo).
- **medio** — Clic su un'annotazione: la barra di modifica è in fondo, non vicino al segno (`run1/it-039-reader-annotation-edit-bar-light-1280x800.png`).
- **medio** — Ricerca nel documento: barra con 7 controlli tra cui "Evidenzia il risultato"/"Sottolinea il risultato" — funzione potente ma con etichette lunghe (`run1/it-040-reader-find-light-1280x800.png`).
- **medio** — Pannello laterale con 4 schede ("Evidenziazioni", "Nota di pagina", "Nota del file", "Tutte le note") che vanno su due righe a 340 px; "Nota di pagina" e "Nota del file" potrebbero essere un unico editor con un selettore.
- **medio** — Il lettore sostituisce la Libreria ma resta "dentro" la voce Libreria della barra laterale; il pulsante "← Torna alla libreria" è l'unico modo visibile per uscire (Esc funziona ma è scritto solo nel paragrafo delle scorciatoie).
- **basso** — In tema scuro la pagina PDF bianca sta su uno sfondo quasi nero senza bordo né ombra; in chiaro la pagina bianca su `--surface-2` quasi bianco non ha contorno: non si vede dove finisce il foglio (`run1/it-048-reader-open-fit-dark-1280x800.png`, `run1/it-032-…`).

### Evidenziazioni salvate fuori dal PDF (punto 6 dell'utente)

Comportamento: corretto per la regola 1 (originali mai modificati; annotazioni in `.lab/`). Spiegazione all'utente: **assente** nel lettore, nella barra di annotazione e nell'elenco "Evidenziazioni". La procedura guidata dice "I tuoi documenti non vengono mai modificati" (passo 3) ma l'utente non collega questa frase alle evidenziazioni. Proposta: una riga fissa e discreta nel pannello "Evidenziazioni" ("Salvate in Research Lab, non nel file PDF. Per averle fuori dall'app: Esporta copia annotata…") e una funzione di esportazione di una **copia** del PDF con le annotazioni (scritta nella cartella di export, mai sull'originale). Rinominare la casella "Sottolineato" della barra di studio (ad esempio "Studiato a fondo") o toglierla dal lettore.

---

## Navigazione e struttura generale

- **alto** — Barra laterale: 6 voci solo testo, nessuna icona; "Impostazioni" spinta in basso; sopra il menu un selettore "Libreria attiva" e un link "Nuova libreria"; in fondo un secondo selettore della lingua. La lingua dell'interfaccia (impostazione rara) occupa spazio permanente; la libreria attiva usa un `<select>` nativo.
- **alto** — La chat a scomparsa è un'aletta larga 44 px con un solo "‹" in alto a destra: nessuna etichetta, nessuna icona riconoscibile (`run1/it-010-library-home-light-1280x800.png`).
- **medio** — Annulla / Ripeti / Cronologia ripetuti nelle barre di Libreria, Progetti e Proposte dell'AI, con posizioni diverse; il pannello Cronologia non si chiude con Esc e resta aperto sotto palette e guida (`run1/it-027-palette-light-1280x800.png`, `run1/it-029-guide-dialog-light-1280x800.png`).
- **medio** — Palette comandi (Ctrl+K): le prime 9 voci sono richieste all'AI che "riempiono la casella del messaggio" (non eseguono nulla), poi le navigazioni; le scorciatoie Alt+1… sono mostrate, le richieste AI no. Duplicato "Esporta il secondo cervello" / "Esporta come secondo cervello…".
- **medio** — Toast che si accumulano in basso al centro e coprono contenuto per molti secondi (`run1/it-088-review-after-accept-toast-light-1280x800.png`, `run1/it-089-network-labels-dialog-light-1280x800.png`).
- **basso** — Ordine di tabulazione corretto e focus sempre visibile (misurato su procedura guidata, Libreria, lettore): da tenere.

## Procedura guidata (primo avvio)

- 7 passi, 11 clic fino alla libreria (`wizard-clicks` = 11). Passi: Benvenuto (lingua), Chi sei (5 campi facoltativi), Cartella, Dettagli, Tassonomia, Cartelle abilitate a Claude, Riepilogo.
- **medio** — "Chi sei" chiede ORCID e id OpenAlex al primo minuto d'uso: un dottorando non sa cos'è l'id autore OpenAlex. Va spostato in "Profilo" dopo, con un aiuto.
- **medio** — Passo AI: casella obbligatoria "Ho capito che per ora nulla verrà inviato a Claude" per poter proseguire senza abilitare cartelle: conferma superflua (`run1/it-007-wizard-step6-Cartelle_abilitate_a_Claude-light-1280x800.png`).
- **basso** — "Scegli un'altra cartella…" incollato al riquadro del percorso (nessuno spazio), percorso assoluto completo in monospace.
- **basso** — Riaperta dalla barra laterale, la procedura ha "Annulla" come link sotto i pulsanti e dietro mostra il testo obsoleto "Questa sezione arriverà in una fase successiva" (problema 14).
- Dopo la creazione: la carta di benvenuto occupa 250 px su 800 sopra la Libreria e riduce la lista a 3,5 righe (`run1/it-009-first-screen-welcome-light-1280x800.png`); tre "Nascondi" per tre suggerimenti.

## Libreria

- **alto** — Tre righe di barra (vedi problema 13). "Chiedi a Claude" accanto alla ricerca è la ricerca AI (`run1/it-022-advanced-search-dialog-light-1280x800.png`): l'etichetta fa pensare alla chat.
- **medio** — Il suggerimento della sintassi di ricerca (`Parole, "frasi esatte", prefisso*, a OR b, author:, tag:, type:, year:2018-2022, venue:`) è sempre visibile sotto il campo: utile ma rumoroso; con la chat aperta va su tre righe.
- **medio** — Barra di selezione: 6 azioni su due righe come pulsanti uguali ("Modifica i tag", "Aggiungi al progetto…", "Proponi con l'AI…", "Aggiorna citazioni", "Esporta come secondo cervello…", "Deseleziona") (`run1/it-013-library-selection-bar-light-1280x800.png`).
- **medio** — Icone delle righe (≡ ↗ ⌂) piccole, senza etichetta, visibili solo al passaggio.
- **medio** — "Aggiorna citazioni" su una libreria senza rete: toast "avviato, seguilo nella barra di stato" e insieme, in barra di stato, "fallito 0/4, 1 falliti" (`run1/it-017-library-bulk-citations-light-1280x800.png`).
- **basso** — Badge del tipo di file: "MD" verde su bianco contrasto 4,37 (sotto 4,5); "PDF" rosso su selezione scura 2,5 in tema scuro (unici fallimenti di contrasto misurati, `run1/metrics-it.json`).
- **basso** — Vista Griglia: miniature piccole (70×75 px) al centro di carte da 330×180, molto spazio vuoto (`run1/it-011-library-grid-light-1280x800.png`).
- Ricerca: risultati immediati, sintassi ricca, etichetta "nelle tue note"/"nell'evidenziazione" sul risultato: **da tenere**.

## Tassonomia

- **medio** — È una "modalità" della Libreria (pulsante "Tassonomia" nella barra, poi "Torna alla libreria" dentro il pannello), non un luogo: l'utente non la trova nella barra laterale.
- **medio** — Editor del nodo lungo e denso: colore (12 pallini + selettore), alias, genitori, implica, unione, deprecazione in una colonna con scorrimento (`run1/it-025-taxonomy-node-editor-light-1280x800.png`).
- **basso** — Creare due tag ha avviato una scansione ("Cerco i file... 0", barra che cambia forma).

## Progetti

- **medio** — "Crea" porta direttamente dentro il progetto appena creato (ok) ma la pagina di dettaglio mette "Tutti i progetti" come pulsante a sinistra del titolo, due badge "Attivo"/"Progetto" e "Esporta come secondo cervello…" sulla stessa riga (`run1/it-050-projects-list-light-1280x800.png`).
- **medio** — Progetto vuoto: il testo dice di andare in Libreria e usare "Aggiungi al progetto", nessuna azione diretta "Aggiungi documenti…".
- **basso** — "Progetto" / "Collezione" scelti con radio accanto al pulsante "Crea" senza spiegare la differenza (`run1/it-049-projects-empty-light-1280x800.png`).

## Scopri / citazioni

- **medio** — Quattro schede (Da leggere dopo, Novità, Pubblicati, Fonti) tutte vuote finché non si fa "Aggiorna citazioni" dalla Libreria: lo stato vuoto lo dice, ma non offre il pulsante per farlo da qui (`run1/it-051-discover-first-light-1280x800.png`).
- **basso** — "Ambito" e "Minimo di documenti citanti" sopra il messaggio vuoto: controlli prima dei contenuti.

## Rete

- **medio** — "Seme" (casella numerica) in alto a destra a fianco di "Costruisci il modello": parametro da sviluppatore in primo piano (`run1/it-056-network-first-light-1280x800.png`).
- **medio** — Mappa con 4 documenti: tre quadratini rossi di 4 px e un'etichetta "sintetici, doi, rltest" al centro; cluster a destra con "Esporta" come link (`run1/it-057-network-built-light-1280x800.png`).
- **medio** — Scheda "Rete": 3 selettori, 6 caselle "Espandi per", 5 pulsanti disabilitati e una legenda prima del grafo vuoto (`run1/it-059-network-tab2-light-1280x800.png`). "Esplora": "Qui non c'è nulla." e pulsanti disabilitati in fondo (`run1/it-060-…`).
- **basso** — "Colora per" su due righe; "Livello 1" come pulsante seguito da "nessuno(1)" incollato nel dialogo delle etichette (`run1/it-089-…`).

## Arrivi (cartella di arrivo) e proposte dell'AI

- Badge: vedi problema 6. Misura: `inbox-badge` = `{ text: "1", aria: "1 file nella posta in arrivo", title: null }`.
- **alto** — Il file trovato nella libreria ("trovato nella libreria") e quello trascinato ("trascinato") hanno lo stesso modulo, ma il primo è già in libreria: l'azione richiesta all'utente non è spiegata (`run1/it-065-inbox-flagged-library-file-light-1280x800.png`).
- **medio** — Senza rete: "senza connessione · Riprova" come badge grigio, poco visibile.
- **medio** — Proposte dell'AI: carte grandi, una per campo, con "Accetta / Modifica / Rifiuta" ripetuti; titolo del documento in maiuscolo grigio più un chip con lo stesso titolo; utile la marcatura viola "Generato dall'AI" (`run1/it-087-review-view-light-1280x800.png`).
- **basso** — Sovrapposizione di trascinamento (`run1/it-067-inbox-drop-hint-light-1280x800.png`): da verificare con un vero trascinamento.

## Chat, AI, lavori in blocco

- **medio** — Pannello chat: "Modello" e "Ragionamento" come due grandi menu sempre visibili sotto il campo di testo, "Invia" piccolo, una riga di scorciatoie fissa (`run1/it-081-chat-open-enabled-light-1280x800.png`).
- **medio** — L'anteprima "Inviare a Claude?" a ogni messaggio (impostazione predefinita) è corretta per la regola 4 ma senza "non chiedere più per questa conversazione" diventa un attrito a ogni domanda (`run1/it-082-chat-preview-dialog-light-1280x800.png`).
- **medio** — Risposta: il blocco strumento `search_library` mostra il nome tecnico e "Searched the library for…" in inglese nell'interfaccia italiana (dal fornitore simulato; da verificare con quello reale) (`run1/it-083-chat-answer-light-1280x800.png`).
- **medio** — Dialogo "Proponi con l'AI": 5 caselle, 2 menu, "Proponi di nuovo", poi 4 righe di riepilogo e un riquadro; il pulsante di conferma è sotto la piega a 1280×800 (`run1/it-085-job-dialog-light-1280x800.png`). Senza cartelle abilitate il dialogo si apre comunque e dice in fondo "non c'è nulla da inviare" (`run1/it-015-…`).

## Impostazioni (punto 3 dell'utente)

- **alto** — Pagina unica di 7981 px, vedi problema 4. Misure per sezione (altezza px / controlli): Tu e l'interfaccia 759/8, Librerie 227/3, Impostazioni della libreria 602/6, Fonti online 325/4, Claude (AI) 1378/24, Server MCP 1177/7, Chiavi API 199/3, Backup 883/6, Scorciatoie 1242/50, Manutenzione 852/8.
- **alto** — Elenchi "Stato" (AI e MCP) resi con `<dl>` senza stile: rientri del browser, etichette e valori disallineati (`run1/it-073-…`, `run1/it-074-…`).
- **alto** — Modelli: si modificano a mano id (`claude-haiku-5-5`) ed etichetta, con "Rimuovi": è materia da sviluppatore.
- **medio** — Tre posti diversi per le chiavi: "Chiave API Anthropic" (sezione AI), "Chiave API di OpenAlex" (Fonti online), "Chiavi API" (solo Gemini, sezione a parte).
- **medio** — Backup: con la destinazione dentro la libreria compare un errore rosso, ma "Scegli cartella…" resta grigio e "Esegui il backup ora" disabilitato con la frase "Scegli prima una cartella di destinazione" mentre una cartella è stata appena scelta (rifiutata): messaggi in conflitto (`run1/it-090-settings-backup-after-choose-light-1280x800.png`).
- **medio** — Ogni sezione ha il proprio "Salva" (Profilo, Libreria, AI) mentre altre si applicano subito (lingua, tema, MCP): modello di salvataggio misto.
- **basso** — Scorciatoie: tabella di 17 righe × 3 pulsanti (Cambia / Spegni / Predefinito) = 50 controlli (`run1/it-091-settings-restore-attempt-light-1280x800.png` mostra l'inizio).

### Inventario completo delle impostazioni attuali

Legenda "chi": T = tutti, P = utente esperto, S = sviluppatore. Fonte: `packages/core/src/settings.ts`, `apps/desktop/src/renderer/src/settings/*.tsx`, schermate `run1/it-068…106`.

| Impostazione | Dove (sezione) | Predefinito | Ambito di salvataggio | Chi |
| --- | --- | --- | --- | --- |
| Lingua dell'interfaccia | Tu e l'interfaccia; anche barra laterale e procedura guidata | `it` | app (questo computer) | T |
| Aspetto (sistema/chiaro/scuro) | Tu e l'interfaccia | `system` | app | T |
| Nome | Tu e l'interfaccia; procedura guidata | vuoto | app | T |
| Nomi con cui compari tra gli autori | Tu e l'interfaccia; procedura guidata | vuoto | app | P |
| Email | Tu e l'interfaccia | vuoto | app | P |
| ORCID | Tu e l'interfaccia | vuoto | app | P |
| Id autore OpenAlex | Tu e l'interfaccia | vuoto | app | P |
| Elenco librerie: attiva, rinomina, rimuovi dall'elenco, nuova | Librerie; selettore nella barra laterale | — | app | T |
| Cartella dati della libreria (`dataDirName`) | solo procedura guidata (`wizard-data-dir`) | `.lab` | app | S |
| Nome della libreria | Impostazioni della libreria | dal nome scelto | library.json | T |
| Lingua dei documenti | Impostazioni della libreria; procedura guidata | `it` | library.json | T |
| Cartelle escluse | Impostazioni della libreria | nessuna | library.json | P |
| Preset di export (nome, sorgenti none/paths/copies, profondità citati 0-3, includi citati, note, annotazioni) | Impostazioni della libreria; dialogo export | nessun preset (valori del preset: none, 1, no, sì, sì) | library.json | P |
| Estensioni scansionate | nessuna interfaccia | pdf, md, txt, tex, rst, docx, pptx, ipynb | library.json | S |
| Estensioni solo per nome | nessuna interfaccia | nessuna | library.json | S |
| Giorni prima di eliminare i record dei file cancellati | nessuna interfaccia | 30 | library.json | S |
| Invia a OpenAlex l'email del profilo | Fonti online | spento | app | P |
| Chiave API OpenAlex | Fonti online | non salvata | archivio sicuro | P |
| Programma Claude Code (percorso, Automatico/Scegli…) | Claude (AI) | automatico | app | S |
| Fornitore AI (claude-agent-sdk / anthropic-api / gemini / mock) | Claude (AI) (solo stato; `ai-provider`) | `claude-agent-sdk` | library.json | S |
| Chiave API Anthropic | Claude (AI) | non salvata | archivio sicuro (app) | P |
| Cartelle abilitate a Claude (tutta la libreria, file nella radice, cartelle) | Claude (AI); procedura guidata | nessuna | library.json | T |
| Chiedi conferma con anteprima prima di ogni invio | Claude (AI) | acceso | library.json | T |
| Modelli (id, etichetta; prezzi solo nei dati) | Claude (AI) | Haiku 5.5, Sonnet 5.5, Opus 5.5 | library.json | S |
| Modello predefinito | Claude (AI) | `claude-haiku-5-5` | library.json | P |
| Ragionamento predefinito | Claude (AI) / menu di chat e dialoghi | `low` | library.json | P |
| Tetto di spesa mensile (USD) | Claude (AI) | nessuno | library.json | P |
| Conferma i lavori in blocco sopra (USD) | Claude (AI) | 0,50 | library.json | P |
| Registro "Cosa è stato inviato a Claude" | Claude (AI) | — (sola lettura) | locale | P |
| Server MCP acceso | Server MCP | spento | library.json | P |
| Scrittura MCP (proposte di campi AI) | Server MCP (con conferma) | spenta | library.json | S |
| Porta MCP | Server MCP | automatica (1024-65535) | locale | S |
| Copia comando / voce `.mcp.json` | Server MCP | — | — | S |
| Cambia il token MCP | Server MCP (con conferma) | — | archivio sicuro | S |
| Registro chiamate MCP | Server MCP | — (sola lettura) | locale | S |
| Chiave API Gemini | Chiavi API | non salvata | archivio sicuro (libreria) | S |
| Cartella di destinazione dei backup | Backup e ripristino | nessuna | app | T |
| Backup automatico (spento/giornaliero/settimanale/mensile) | Backup e ripristino | spento | app | T |
| Backup automatici da conservare | Backup e ripristino | 5 (1-50) | app | P |
| Includi cronologia chat, contatori d'uso e stato di lettura (backup manuale) | Backup e ripristino | acceso | — (per esecuzione) | P |
| Ripristino (radice, nome, impostazioni, segreti, dati locali) | dialogo di ripristino | — | — | P |
| Scorciatoie da tastiera (17 comandi, cambia/spegni/predefinito) | Scorciatoie da tastiera | vedi `packages/core/src/shortcuts.ts` | app | P |
| Diagnostica, log, memoria, pulizia, rapporto | Manutenzione e prestazioni | — | — | S |
| Benvenuto visto / suggerimenti chiusi | carta di benvenuto | falso / nessuno | app | T (implicito) |
| Vista Libreria (elenco/griglia), scheda laterale, chat aperta, pannello del lettore | interfaccia, `localStorage` (`rl.libraryView`, `rl.libraryTab`, `rl.chatOpen`, `rl.readerSide`) | elenco, cartelle, chiusa, aperto | browser locale | T (implicito) |
| Variabili d'ambiente `RL_AI_PROVIDER`, `RL_USER_DATA_DIR`, `RL_LOCAL_DATA_DIR`, `RL_WORKER_*_MS`, `RL_E2E*`, `RL_PACKAGED_TEST` | nessuna interfaccia | — | ambiente | S (solo sviluppo/test) |

Proposta di raggruppamento per l'architetto: **Generale** (lingua, aspetto, profilo essenziale), **Libreria** (nome, lingua documenti, cartelle escluse, scansione), **Claude** (account e accesso con stato chiaro, cartelle abilitate, conferma, tetto di spesa), **Backup**, **Scorciatoie**, **Sviluppatore** (programma Claude Code, fornitore, modelli e prezzi, MCP completo con porta/token/scrittura/registro, chiave Gemini, estensioni scansionate, giorni di pulizia, cartella dati, manutenzione e diagnostica, registri).

---

## Cosa funziona e va tenuto

- La **ricerca**: immediata, sintassi ricca (frasi, prefissi, OR, campi), indica dove ha trovato il testo (nota, evidenziazione, pagina), risultato vuoto chiaro. È il riferimento di qualità.
- **Contrasto e focus**: in 138 schermate i soli testi sotto WCAG AA sono i badge "MD"/"PDF"; il focus è sempre visibile e l'ordine del Tab è logico.
- **Trasparenza sull'AI**: anteprima di cosa viene inviato, costo stimato, registro, marcatura "Generato dall'AI" separata dai campi dell'utente.
- **Sicurezza dei dati**: originali intatti, testi che lo ripetono nei punti giusti (procedura guidata, export, backup).
- Procedura guidata breve e in un dialogo chiaro, con passo e totale ("Passo 3 di 7").
- Temi chiaro/scuro coerenti nei token (salvo i problemi indicati), testo leggibile, buon uso dei messaggi vuoti con istruzioni.
- Annulla/Ripeti con cronologia per ogni modifica di dati.

---

## DA COMPLETARE

Interrotto su richiesta (prima esecuzione completa, seconda esecuzione fermata a 16 schermate). Mancano:

- Esecuzione in inglese (`en`): controllo di lunghezze e terminologia inglese (nessuna schermata ancora).
- Scheda del documento (pannello di dettaglio), "Simili" e "Citazioni" del documento, assegnazione di un tag dalla scheda: il clic doppio dello script non apre la scheda (anche nella seconda esecuzione): va aperta con il pulsante "Scheda" della barra di selezione o con Invio.
- Misura dell'errore di posizione delle evidenziazioni a 1920 px (passo `reader-1920-selection` aggiunto allo script, non ancora eseguito).
- Dialogo di export completo (destinazione, esecuzione, risultato), export da progetto e da cluster.
- Server MCP acceso (il clic sulla casella non ne cambiava lo stato nella prima esecuzione: da capire se serve la conferma o se è disabilitato).
- Backup verso una destinazione valida, verifica, ripristino completo (serve un percorso fuori libreria: il dialogo di test restituisce sempre la radice della libreria).
- Registrazione di una scorciatoia e conflitti; manutenzione (diagnostica), registro AI.
- Lista dei progetti con più progetti, piano di lettura, note del progetto; schede di Scopri con dati (Fonti: modulo nuova fonte).
- Vero trascinamento di un PDF (non automatizzabile) e stato di errore del lettore (PDF protetto o danneggiato).
- Dialoghi aperti dopo il caricamento del lettore: verificare l'effetto della regola `.dialog` di pdf.js.

Screenshot presi finora: `audit-shots/run1/it-001…it-138*.png`, `run1/it-welcome-card-only.png`, `run1/it-inbox-card-detail.png`, misure in `run1/metrics-it.json`; seconda esecuzione parziale `audit-shots/it-001…it-015*.png`, `audit-shots/metrics-it.json`.

Come riprendere: in Git Bash, `export PATH="/c/Program Files/nodejs:$PATH"`, dalla radice del worktree `npm run build`, poi `RL_DESIGN_AUDIT=1 npx playwright test -c e2e/playwright.config.ts e2e/design-audit.spec.ts` (circa 6 minuti per lingua; `-g "Italian UI"` o `-g "English UI"` per una sola; `RL_DESIGN_AUDIT_FULL_EN=1` per il giro completo anche in inglese). Spostare prima le schermate esistenti in una sottocartella di `audit-shots/` perché i nomi si sovrascrivono.
