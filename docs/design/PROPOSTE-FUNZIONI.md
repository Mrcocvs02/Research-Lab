# Proposte di nuove funzioni (da confermare con l'utente)

Stato: proposta, nulla è implementato. Data: 2026-11-17. Aggiornamento: le scelte dell'utente sul giro 1 (D-389 … D-393) e il giro 2 di proposte (27-55) sono in fondo al documento.

## Metodo

1. Letti PLAN, STATUS, RULES, ARCHITETTURA-UI (§1-§4, §14, §15) e l'elenco delle decisioni, per sapere cosa esiste già e cosa il piano ha già messo a bassa priorità o escluso (cloud proprio, mobile, collaborazione, 3D, OCR di tutto).
2. Ricerca web con query generiche su strumenti comparabili (Zotero e plugin, Obsidian con Zotero e Readwise, ResearchRabbit, Litmaps, Connected Papers, Inciteful, Elicit, Scite, Semantic Scholar) e su cosa gli utenti lodano o lamentano. Per Sioyek, Heptabase, Polar, Paperpile, ReadCube e Notion le ricerche non hanno dato risultati utili: per quegli strumenti ci si basa su conoscenza generale, quindi con meno certezza.
3. Filtro: scartato ciò che contraddice le regole (account cloud, telemetria, invio di contenuti senza consenso, modifica dei documenti fuori dalle eccezioni decise).

Segnali emersi dalla ricerca:
- I plugin Zotero più amati riguardano note migliori, chiavi di citazione per LaTeX, traduzione dei PDF, azioni e tag automatici, ordine degli allegati.
- Il dolore ricorrente è la fragilità delle catene di plugin e il lavoro con i word processor (citazioni che si rompono passando da Word a Google Docs).
- Nei flussi Obsidian + Zotero si vogliono note di letteratura con le evidenziazioni importate e con link indietro al PDF.
- Litmaps è lodato per gli avvisi sulle novità di una mappa; ResearchRabbit per la vista dei coautori; Connected Papers per la leggibilità del grafo; Elicit per l'estrazione di dati strutturati in tabella; Scite per il contesto delle citazioni (a favore o contro).
- Su Readwise e sul ripasso periodico le fonti trovate non erano esplicite: la proposta è motivata dal piano, che già la elenca a bassa priorità.

Legenda: sforzo S/M/L; peso = impatto su dipendenze, budget (main 932/950 KiB, quasi al tetto; il design propone 1080) e memoria; priorità alta/media/bassa; "Rete" indica se qualcosa esce dal computer.

## Le 8 raccomandate

| N. | Funzione | Area | Sforzo | Peso | Rete | Priorità |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Schede di appunti dalle evidenziazioni con ripasso periodico | Lettura | M | basso | nessuna | alta |
| 2 | Note di letteratura per documento (esportabili in Markdown) | Lettura | S | nullo | nessuna | alta |
| 3 | Lettura affiancata di due paper | Lettura | M | medio | nessuna | media |
| 6 | Metadati verificabili, correzione in blocco e unione dei duplicati | Organizzare | M | basso | solo OpenAlex già consentito | alta |
| 7 | Importazione da Zotero (BibTeX, CSL JSON, RDF) | Organizzare | M | basso | nessuna | alta |
| 10 | Digest delle novità per progetto | Scoperta | S | basso | OpenAlex già consentito | media |
| 13 | Esportazione bibliografica (BibTeX, RIS, CSL JSON) con chiavi stabili | Scrittura | M | basso | nessuna | alta |
| 16 | Tabella di confronto dei paper con colonne personalizzate | AI | L | medio | Claude, con consenso | alta |

## Elenco completo per area

### Lettura e annotazione

**1. Schede di appunti dalle evidenziazioni con ripasso periodico** (top 8)
- Cosa: ogni evidenziazione può diventare una scheda (frase, nota, pagina, link al punto del PDF); una vista "ripasso" ne propone poche al giorno con intervalli crescenti.
- Perché: trasforma la lettura in memoria; è l'uso tipico di Readwise ed è già previsto dal piano a bassa priorità.
- Sforzo M. Peso basso: vista caricata su richiesta, un file JSON per elemento nella cartella dati. Rete: nessuna. Dipende da: evidenziazioni, note per pagina. Priorità alta.

**2. Note di letteratura per documento** (top 8)
- Cosa: un modello (problema, metodo, risultati, limiti, citazioni utili) con le evidenziazioni inserite e link ai punti del PDF; esportabile in Markdown con link relativi.
- Perché: è il flusso Zotero + Obsidian più usato, qui senza plugin fragili.
- Sforzo S. Peso nullo. Rete: nessuna. Dipende da: note, evidenziazioni, export. Il contenuto scritto da Claude resta marcato e separato (regola 5). Priorità alta.

**3. Lettura affiancata di due paper** (top 8)
- Cosa: due lettori nello stesso pannello, scorrimento sincronizzabile, una nota condivisa.
- Perché: confrontare metodi o versioni di un preprint; il piano la elenca a bassa priorità.
- Sforzo M. Peso medio: seconda istanza di pdf.js solo quando serve. Rete: nessuna. Dipende da: lettore (onde di §14). Priorità media.

**4. Copia di una citazione con riferimento**
- Cosa: copiare la frase selezionata come "(Autore, anno, p. N)" con link al punto; scorciatoia nel lettore.
- Perché: evita di perdere la fonte mentre si scrive; piccolo e molto utile.
- Sforzo S. Peso nullo. Rete: nessuna. Dipende da: lettore, metadati. Priorità media.

**5. Modalità a colonna singola per paper a due colonne**
- Cosa: riflusso del testo estratto in una colonna leggibile su schermi piccoli.
- Perché: richiesta frequente per leggere su portatile (conoscenza generale, non verificata dalle fonti).
- Sforzo L. Peso medio. Rete: nessuna. Dipende da: estrazione del testo. Priorità bassa.

### Organizzare

**6. Metadati verificabili, correzione in blocco e duplicati** (top 8)
- Cosa: per ogni documento mostra da dove vengono titolo, autori, anno e DOI (testo del PDF, OpenAlex, manuale) con affidabilità; correzione in blocco; unione dei duplicati (stesso DOI o titolo).
- Perché: metadati sbagliati rompono citazioni, rete e raccomandazioni; la deduplicazione è fra le richieste più comuni nei gestori di riferimenti.
- Sforzo M. Peso basso. Rete: solo OpenAlex già consentito. Dipende da: cartella di arrivo, tag in blocco, annulla/ripeti. Priorità alta.

**7. Importazione da Zotero e da altri gestori** (top 8)
- Cosa: lettura di un'esportazione (BibTeX, CSL JSON, RDF) con tag, collezioni e note, abbinata ai file già presenti per percorso o hash; mai spostare gli originali.
- Perché: abbassa l'ostacolo di adozione per chi ha anni di libreria altrove.
- Sforzo M. Peso basso (parser scritti a mano, nessuna dipendenza). Rete: nessuna. Dipende da: importatore del vecchio indice, progetti e collezioni. Priorità alta.

**8. Regole automatiche sui nuovi documenti**
- Cosa: regole semplici ("se la cartella è X e l'autore è Y allora tag Z e progetto W") applicate nella cartella di arrivo, sempre come proposta da confermare.
- Perché: ispirato ai plugin di azioni e tag automatici di Zotero, tra i più usati.
- Sforzo M. Peso basso. Rete: nessuna. Dipende da: inbox, tag in blocco, registro. Priorità media.

**9. Viste salvate con filtri combinati**
- Cosa: salvare una ricerca con filtri (stato di lettura, anno, tipo, progetto) come vista fissa nella barra laterale.
- Perché: equivalente delle collezioni dinamiche dei gestori di riferimenti.
- Sforzo S. Peso nullo. Rete: nessuna. Dipende da: ricerca, filtri lato server. Priorità media.

### Scoperta

**10. Digest delle novità per progetto** (top 8)
- Cosa: un riepilogo periodico, dentro l'app e senza email, di nuovi paper che citano o sono vicini ai documenti di un progetto, con il motivo.
- Perché: gli avvisi sono il punto di forza di Litmaps; qui riusa il monitoraggio della fase 5.
- Sforzo S. Peso basso, eseguito solo su apertura o su richiesta. Rete: OpenAlex, già con consenso. Dipende da: Scopri, progetti. Priorità media.

**11. Contesto delle citazioni**
- Cosa: nel "citato da", mostrare la frase del citante dove disponibile e se è a favore, contro o neutra, da dati aperti.
- Perché: l'idea di Scite, utile per valutare le fonti.
- Sforzo L. Peso medio. Rete: fonte aperta con consenso; la copertura è incompleta. Dipende da: citazioni. Priorità bassa.

**12. Vista dei coautori e dei gruppi**
- Cosa: nella rete, filtro per coautori e istituzioni, "chi pubblica su questo tema".
- Perché: la vista dei coautori è un punto di forza di ResearchRabbit; la rete va già verso autori e temi.
- Sforzo M. Peso basso. Rete: solo dati già scaricati. Dipende da: rete, citazioni. Priorità media.

### Scrittura e citazione

**13. Esportazione bibliografica con chiavi stabili** (top 8)
- Cosa: esporta documenti, progetti o collezioni in BibTeX, RIS e CSL JSON; chiave di citazione deterministica (autore-anno-parola) stabile nel tempo; copia rapida di `\cite{}` o `[@chiave]`.
- Perché: è il motivo principale per cui si usa un gestore di riferimenti e un dolore ricorrente con i word processor; il piano la elenca a bassa priorità ma è la lacuna più evidente.
- Sforzo M. Peso basso (serializzazione a mano, nessun motore CSL). Rete: nessuna. Dipende da: metadati, export. Priorità alta.

**14. Bibliografia formattata in uno stile scelto**
- Cosa: elenco formattato (APA, IEEE, stile personalizzato) da incollare.
- Perché: utile senza plugin per Word.
- Sforzo L. Peso medio-alto: un motore di stili come citeproc-js va motivato in DECISIONS; alternativa, 3-4 stili scritti a mano. Rete: nessuna. Dipende da: funzione 13. Priorità bassa.

**15. Bozza di "stato dell'arte" dalle note di un progetto**
- Cosa: Claude ordina note ed evidenziazioni scelte in uno schema con riferimenti ai documenti; resta in un'area AI marcata, mai nelle note dell'utente.
- Perché: accorcia la fase di sintesi; i link ai documenti permettono di verificare.
- Sforzo M. Peso basso. Rete: Claude, con consenso e anteprima. Dipende da: chat, progetti, regola 5. Priorità media.

### AI

**16. Tabella di confronto dei paper** (top 8)
- Cosa: si scelgono da 3 a 30 paper e le colonne ("dataset", "metodo", "metrica", "limiti"); Claude compila ogni cella con la pagina di riferimento; le celle sono modificabili ed esportabili in CSV.
- Perché: è la funzione distintiva di Elicit per le revisioni di letteratura.
- Sforzo L. Peso medio (vista su richiesta, nessuna dipendenza nuova). Rete: Claude, con stima del costo, tetto di spesa e consenso per cartella. Dipende da: lavori AI in blocco. Priorità alta.

**17. "Cosa manca?" sul progetto**
- Cosa: Claude individua lacune (metodi non coperti, autori centrali assenti) usando rete e Scopri.
- Perché: guida la lettura successiva.
- Sforzo M. Peso basso. Rete: Claude con consenso. Dipende da: rete, "da leggere dopo". Priorità media.

**18. Una riga di sintesi e domande di verifica per documento**
- Cosa: sintesi di una riga e tre domande di controllo, marcate come AI.
- Perché: i riassunti brevi di Semantic Scholar sono molto apprezzati nelle liste.
- Sforzo S. Peso nullo (riassunti e descrizioni esistono già). Rete: Claude. Priorità bassa.

### Mappa e visuale

**19. Linea del tempo di un tema o progetto**
- Cosa: asse temporale con i documenti e i loro riferimenti, per raccontare la storia di un campo.
- Perché: aiuta a strutturare introduzioni e rassegne.
- Sforzo M. Peso basso (canvas già usato dalla mappa). Rete: nessuna. Dipende da: rete, anni. Priorità bassa.

**20. Lavagna libera di paper, evidenziazioni e note**
- Cosa: tela su cui trascinare schede e collegarle, salvata per progetto.
- Perché: apprezzata da chi pensa in modo visivo (stile Heptabase, conoscenza generale).
- Sforzo L. Peso medio-alto: rischio di duplicare la mappa e di sforare il budget. Rete: nessuna. Da valutare solo dopo la riprogettazione. Priorità bassa.

### Sincronizzazione e backup

**21. Cronologia consultabile per singolo elemento**
- Cosa: vedere e ripristinare versioni precedenti di una nota o di un file di annotazioni, non solo l'intero backup.
- Perché: rete di sicurezza prima di attivare la scrittura nei PDF; il piano la elenca a bassa priorità.
- Sforzo M. Peso basso (snapshot per elemento con limite). Rete: nessuna. Dipende da: backup, scritture atomiche. Priorità media.

**22. Conflitti di sincronizzazione guidati**
- Cosa: se il servizio di sincronizzazione crea copie in conflitto nella cartella dati, l'app le segnala e propone l'unione.
- Perché: mitiga un rischio aperto nel design (§15).
- Sforzo M. Peso basso. Rete: nessuna. Priorità media.

### Flusso di lavoro e automazione

**23. Importazione da DOI, arXiv o URL incollato**
- Cosa: si incolla un identificatore; l'app ricava i metadati e, se il PDF è ad accesso aperto, lo propone nella cartella di arrivo.
- Perché: la raccolta con un clic dal browser è la funzione più amata di Zotero; qui in forma minima senza estensione.
- Sforzo M. Peso basso. Rete: solo su azione esplicita, con conferma prima di scaricare un file. Dipende da: inbox. Priorità media.

**24. Strumenti MCP di scrittura facoltativi**
- Cosa: oltre alla lettura, strumenti che creano proposte nell'area AI (note, tag proposti).
- Perché: Claude Code può preparare note di progetto.
- Sforzo S. Peso nullo. Rete: solo locale. Dipende da: MCP; restano disattivati di default (regola 7). Priorità bassa.

### Qualità della vita

**25. "Riprendi da dove avevo lasciato"**
- Cosa: pagina iniziale con ultimi documenti letti, pagina e nota in sospeso, coda di lavoro (da leggere, da taggare, da rivedere).
- Perché: riduce l'attrito di rientro dopo giorni.
- Sforzo S. Peso nullo. Rete: nessuna. Dipende da: stato di studio, inbox. Priorità media.

**26. Operatori di ricerca e frase di contesto**
- Cosa: sintassi (`"frase esatta"`, `autore:`, `anno:`) e risultati con la frase attorno.
- Perché: potenza per chi cerca spesso.
- Sforzo S. Peso nullo (FTS5 già presente). Rete: nessuna. Priorità media.

## Note per la decisione

- Il main è a circa 1009/1010 KiB (tetto proposto dal design: 1080): le funzioni 13, 7 e 6 toccano il main (serializzazione e parser); le altre sono viste del renderer caricate su richiesta.
- Nessuna proposta introduce account cloud o telemetria. Quelle con rete (10, 11, 16, 17, 23) usano fonti già consentite o richiedono consenso e anteprima come da regola 4.
- Si consiglia di avviarle dopo le onde H0 e R0 e dopo la scrittura nei PDF, per non aggravare il rischio sui file originali.

## Fonti

https://www.obsidianstats.com/tags/zotero
https://www.g2.com/products/zotero/reviews
https://www.trustradius.com/products/zotero
https://paperguide.ai/blog/litmaps-vs-researchrabbit/
https://paperguide.ai/blog/connected-papers-alternatives/
https://libguides.hkust.edu.hk/citation-chaining/citation-mapping-tools-comparison
https://intuitionlabs.ai/articles/ai-literature-mapping-tools-guide
https://paperguide.ai/blog/elicit-vs-scite/
https://ai.ctlt.ubc.ca/?p=3048
https://guides.library.oregonstate.edu/ailitreviewtools
https://community.obsidian.md/plugins/zotlit
https://community.obsidian.md/plugins/stratum
https://forums.zotero.org/discussion/90421/readwise
https://groundwater.usu.edu/blog/2023/A-Zotero-to-Obsidian-Workflow/

## Scelte dell'utente (giro 1)

Data: 2026-11-17. Parole dell'utente (tradotte; le citazioni restano nella lingua originale): le proposte erano «all super interesting» e ne vuole altre (giro 2, sotto). Decisioni registrate in `docs/DECISIONS.md` (D-389 … D-393).

| N. | Funzione | Scelta | Note |
| --- | --- | --- | --- |
| 1 | Schede di appunti con ripasso periodico | **No** | esce anche dalle funzioni a bassa priorità del piano |
| 2 | Note di letteratura per documento | **Sì, estesa** | «one of the greatest features»; contenuto sotto (D-390) |
| 3 | Lettura affiancata di due paper | **Sì** | |
| 6 | Metadati verificabili e duplicati | Forse, più avanti | |
| 7 | Importazione da Zotero + BibTeX gestito direttamente | **Indispensabile** | importare le esportazioni di Zotero e leggere/scrivere i `.bib` direttamente (D-391) |
| 13 | Esportazione bibliografica con chiavi stabili | inclusa con la 7, **da confermare** | |
| 10 | Digest delle novità | sostituita | diventa la variante periodica di "Estendi la bibliografia" (D-392) |
| nuova | **Estendi la bibliografia** | **Indispensabile** | «should have been there from the start»; contenuto sotto (D-392) |
| 11 | Contesto delle citazioni | **Sì** | |
| 12 | Coautori e gruppi | **Sì, su richiesta** | non automatica: panoramica in Markdown dei gruppi di ricerca dietro un paper o un gruppo di paper (D-393) |
| 16 | Tabella di confronto | **Sì** | «super good» |
| 19 | Linea del tempo | **Sì, su richiesta** | come opzione, non vista fissa |
| 23 | Importazione da DOI, arXiv o URL | **Sì** | |
| 25 | "Riprendi da dove avevo lasciato" | **Sì** | |
| 26 | Operatori di ricerca e frase di contesto | in sospeso | non era chiara: spiegazione ed esempio sotto |
| 4, 5, 8, 9, 14, 15, 17, 18, 20, 21, 22, 24 | — | in sospeso | non citate dall'utente |

Gusto che emerge, usato per il giro 2: sintesi in Markdown strutturate scritte dall'AI e marcate, crescita della bibliografia, esplorazione visiva, interoperabilità con Zotero e BibTeX, funzioni **su richiesta** più che automatiche.

### Note di letteratura estese (2)

- **Un file Markdown per paper**, nella cartella dati, separato dalle note dell'utente (regola 5), con queste sezioni:
  1. Problema.
  2. Soluzione o contributo.
  3. Metodo di ricerca.
  4. Risultati.
  5. Dati usati (dataset, campioni, fonti; con i link a codice e dati se presenti, vedi proposta 48).
  6. Figure e grafici, quando ci sono: ognuno con didascalia e riferimento alla pagina; l'immagine è quella incorporata nel PDF (estratta così com'è) oppure, per i grafici vettoriali, la zona della pagina resa come immagine (vedi proposte 27 e 28).
  7. Limiti e prospettive.
- Ogni parte scritta da Claude è marcata (✦, modello, data) e diventa dell'utente solo se lui la approva o la riscrive; ogni affermazione porta il link alla pagina (`lab://doc/<id>?page=N`); le evidenziazioni dell'utente entrano come citazioni con pagina.
- Su richiesta, per uno o più paper, con anteprima di cosa si invia, stima del costo e consenso per cartella (regola 4); esportabile con link relativi.

### Estendi la bibliografia (nuova, indispensabile)

- **Da dove parte:** un progetto intero oppure una selezione di paper (dalla Libreria, dalla Mappa o da un progetto).
- **Come trova i candidati:** riferimenti dei paper di partenza (all'indietro), lavori che li citano (in avanti), co-citazione (lavori citati spesso insieme ai tuoi), accoppiamento bibliografico (lavori che condividono molti riferimenti con i tuoi), somiglianza (lavori correlati di OpenAlex e vicinanza TF-IDF degli abstract). Fonte: OpenAlex, già consentito, con Semantic Scholar e arXiv come ripiego come oggi; richieste limitate e in cache.
- **Classifica e motivo:** ogni candidato ha un punteggio e una spiegazione leggibile ("citato da 4 dei tuoi 12 paper · cita 3 dei tuoi · molto simile a X"); i documenti già in libreria sono esclusi.
- **Dove finisce:** proposte in Da rivedere o in Scopri, da accettare una per una o in blocco; **mai scaricato da solo**: se esiste un PDF ad accesso aperto lo si scarica solo dopo conferma (proposta 44).
- **Variante periodica:** il digest della vecchia proposta 10, cioè la stessa ricerca rieseguita all'apertura o su richiesta, che mostra solo i candidati nuovi.
- Generalizza "Da leggere dopo" (che resta) a un ambito scelto e a più segnali.

### Proposta 26 spiegata in modo semplice (da mostrare all'utente)

Che cosa vuol dire: scrivere nella ricerca piccole parole chiave che restringono i risultati, e vedere in ogni risultato **la frase del paper dove la parola compare**, così si capisce subito se è il paper giusto senza aprirlo.

Esempio: scrivi `"few-shot" anno:2020..2023 -survey stato:letto` e ottieni solo i paper letti, del 2020-2023, che contengono l'espressione esatta "few-shot" e non sono rassegne; sotto ogni titolo compare "…we propose a **few-shot** method that… (p. 4)".

Nota onesta: una parte esiste già (D-051: frasi tra virgolette, `prefisso*`, `OR`, `author:`, `tag:`, `type:`, `year:`, `venue:` con alias italiani; frammenti con le parole evidenziate). La proposta aggiungerebbe intervalli di anni, esclusione con il segno meno, operatori per stato di lettura e progetto, la frase di contesto in tutti i risultati e un aiuto visibile ("?" nel campo, §4.18).

## Giro 2: nuove proposte

Stato: proposte da confermare, nulla è implementato. Data: 2026-11-17. Numerazione dal 27.

### Metodo

1. Riletti PLAN, STATUS, RULES, ARCHITETTURA-UI (§1-§4, §4.20, §4.21), le decisioni e le proposte 1-26 con le scelte dell'utente, per non ripetere ciò che esiste o è già proposto (per esempio: versioni pubblicate dei preprint, monitoraggio, "Da leggere dopo", export second brain, MCP e scrittura delle evidenziazioni nel PDF esistono già o sono progettati).
2. Ricerca web con query generiche su: Better BibTeX, Scholarcy, Semantic Reader di Semantic Scholar, SciSpace, Consensus, Undermind, Elicit (screening), Connected Papers (lavori precedenti e derivati), Inciteful e Litmaps, Zotero GPT e Aria, il controllo delle ritrattazioni di Zotero e di Crossref, Unpaywall, Papers with Code, PDFFigures 2.0, Temml e KaTeX, plugin Obsidian per affermazioni e prove, plugin Zotero per statistiche di lettura, Kudos, checkcites, flussi di risposta ai revisori e di mappatura capitoli-fonti. Per Iris.ai, Paper Digest, Attanger, ZotFile, Logseq, Overleaf e Jupyter non sono state fatte ricerche: ci si basa su conoscenza generale, con meno certezza.
3. Filtro: scartato ciò che contraddice le regole (rinominare o spostare gli originali, account cloud, condivisione pubblica, telemetria) e ciò che duplica proposte o funzioni esistenti (elenco "Scartate o assorbite" in fondo).

Segnali emersi dalla ricerca:
- Le funzioni più citate di Better BibTeX sono le chiavi di citazione senza conflitti e l'**esportazione automatica** che tiene aggiornato un `.bib` quando la collezione cambia.
- Scholarcy e Semantic Reader puntano su figure e tabelle estratte, su evidenziazioni guida (obiettivo, metodo, risultato) e su **schede delle citazioni** che si aprono cliccando un riferimento nel testo.
- Zotero avvisa dei paper ritirati senza inviare la libreria (lista parziale di identificatori); Crossref espone i dati di Retraction Watch; OpenAlex ha già, per ogni lavoro, un campo che dice se è ritirato e la migliore copia ad accesso aperto.
- Papers with Code è stato chiuso e reindirizza a Hugging Face: i link a codice e dati vanno ricavati dal testo del paper, non da un servizio.
- Undermind ed Elicit puntano sulla ricerca iterativa a partire da una domanda e sullo screening con criteri e diagramma PRISMA; Inciteful sul "connettore" tra due aree.
- Nei plugin Obsidian per la ricerca cresce il modello domanda → affermazione → prova → fonte, con la pagina verificata a mano.
- Per la scrittura: checkcites trova le chiavi citate ma assenti e quelle mai citate; la matrice "commento del revisore → risposta → modifica" è il metodo consigliato per le revisioni.

Legenda: sforzo S/M/L; **peso** = stima del codice aggiunto (main / renderer, KiB non minificati) e delle dipendenze; "Rete" dice cosa esce dal computer e verso chi; priorità alta/media/bassa. Budget: main oggi ~1009 KiB; con le onde del design il main arriva a 1064-1082 sul tetto di 1085 e il renderer totale a 1625-1650 su 1655. Quindi **ogni funzione che tocca il main richiede una decisione di budget**; si consiglia di mettere le funzioni nuove del main in moduli caricati con `import()` dinamico (chunk separati, misurati a parte), così il main all'avvio non cresce. Le viste nuove sono sempre caricate su richiesta.

### Le 10 consigliate del giro 2

| N. | Funzione | Area | Sforzo | Peso (main / renderer) | Rete | Priorità |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | Ritaglio di figure, tabelle ed equazioni | Lettura | S | +1-2 / +3-5 | nessuna | alta |
| 28 | Indice automatico di figure e tabelle | Lettura | M | +4-6 / +2-3 | nessuna | alta |
| 29 | Schede delle citazioni nel lettore | Lettura | M | +2-3 / +4-6 | nessuna (cache) o OpenAlex già consentito | alta |
| 41 | Ricerca approfondita da una domanda | Bibliografia | L | +6-10 / +4-6 | OpenAlex già consentito + Claude con consenso | alta |
| 44 | Versioni ad accesso aperto in blocco | Bibliografia | S | +2-3 / +1-2 | OpenAlex; scaricamento dai siti degli archivi solo dopo conferma | alta |
| 46 | Ritrattazioni, errata e avvisi | Integrità | S | +1-2 / +1-2 | OpenAlex già consentito; Crossref facoltativo con consenso | alta |
| 48 | Codice, dati e notebook del paper | Integrità | S | +2-3 / +1-2 | nessuna | alta |
| 49 | Mappa capitoli ↔ fonti della tesi | Scrittura | M | +3-4 / +8-12 | nessuna | alta |
| 50 | Controllo delle citazioni di un manoscritto | Scrittura | S-M | +3-5 / +3-4 | nessuna | alta |
| 54 | Resoconto per il relatore o il gruppo di lettura | Scrittura | S-M | +2-3 / +3 | nessuna; Claude facoltativo con consenso | alta |

Fuori dal top 10 ma da unire subito alla 7 se l'utente conferma: **52, file `.bib` sempre aggiornato** (è la metà "scrittura" del BibTeX gestito direttamente).

Peso del top 10 insieme: main +26-41 KiB, renderer +31-45 KiB (quasi tutto in chunk pigri). Nessuna dipendenza nuova.

### Tutte le proposte del giro 2 (27-55)

| N. | Funzione | Sforzo | Rete | Priorità |
| --- | --- | --- | --- | --- |
| 27 | Ritaglio di figure, tabelle ed equazioni (top 10) | S | nessuna | alta |
| 28 | Indice automatico di figure e tabelle (top 10) | M | nessuna | alta |
| 29 | Schede delle citazioni nel lettore (top 10) | M | cache / OpenAlex | alta |
| 30 | Evidenziazioni guida su richiesta (obiettivo, metodo, risultato) | M | Claude | media |
| 31 | "Spiega questa formula, tabella o figura" | S | Claude | media |
| 32 | Traduzione di un passaggio | S | Claude | media |
| 33 | Lettura ad alta voce | S | nessuna | bassa |
| 34 | Sessioni di lettura, concentrazione e statistiche locali | S | nessuna | media |
| 35 | Modelli di nota personalizzabili | S | nessuna | media |
| 36 | Colori delle evidenziazioni con un significato | S | nessuna | media |
| 37 | Formule LaTeX nelle note | M | nessuna | bassa |
| 38 | Link tra note e collegamenti in entrata | S-M | nessuna | media |
| 39 | Glossario di acronimi e termini del progetto | S | nessuna; Claude facoltativo | media |
| 40 | Registro di domande, affermazioni e prove | M | nessuna | media-alta |
| 41 | Ricerca approfondita da una domanda (top 10) | L | OpenAlex + Claude | alta |
| 42 | Ponte tra due insiemi di paper | M | OpenAlex | media |
| 43 | Screening con criteri e diagramma PRISMA | M | nessuna; Claude facoltativo | media |
| 44 | Versioni ad accesso aperto in blocco (top 10) | S | OpenAlex + siti degli archivi | alta |
| 45 | Andamento delle citazioni nel tempo | S | OpenAlex | bassa |
| 46 | Ritrattazioni, errata e avvisi (top 10) | S | OpenAlex; Crossref facoltativo | alta |
| 47 | Cosa è cambiato tra due versioni di un paper | M | nessuna | bassa |
| 48 | Codice, dati e notebook del paper (top 10) | S | nessuna | alta |
| 49 | Mappa capitoli ↔ fonti della tesi (top 10) | M | nessuna | alta |
| 50 | Controllo delle citazioni di un manoscritto (top 10) | S-M | nessuna | alta |
| 51 | Suggerimenti di citazione per una bozza | M | nessuna | media |
| 52 | File `.bib` sempre aggiornato (da unire alla 7) | S | nessuna | alta |
| 53 | Risposta ai revisori | M | nessuna; Claude facoltativo | media |
| 54 | Resoconto per il relatore o il gruppo di lettura (top 10) | S-M | nessuna; Claude facoltativo | alta |
| 55 | Sintesi in linguaggio semplice | S | Claude | bassa |

### Lettura, figure e comprensione

**27. Ritaglio di figure, tabelle ed equazioni** (top 10)
- Cosa: nuovo strumento del lettore "Ritaglia zona" (rettangolo): la zona diventa un'annotazione-immagine con pagina, didascalia facoltativa e nota; l'immagine si salva nella cartella dati (WebP, con un tetto per file, per esempio 300 KB) e si copia negli appunti o in una nota.
- Perché: è il modo affidabile di portare grafici vettoriali e tabelle nelle note di letteratura estese (2); in Zotero la selezione d'area è molto usata e gli utenti lamentano che le immagini si perdano esportando le note.
- Sforzo S. Peso: renderer +3-5 KiB nel chunk del lettore (il canvas c'è già), main +1-2 (scrittura atomica del file). Rete: nessuna. Dipende da: lettore a strumenti (F4). Non si scrive nel PDF. Priorità alta.

**28. Indice automatico di figure e tabelle** (top 10)
- Cosa: dal testo già estratto si riconoscono le didascalie ("Figure 3", "Fig.", "Table 2", "Tabella", "Eq.") con pagina e posizione; per ognuna si stima la zona della figura (immagini incorporate e tracciati vettoriali vicino alla didascalia, dall'elenco degli operatori di pdf.js); nel lettore una scheda "Figure" elenca miniature e didascalie con salto alla pagina; le figure si mandano nella nota di letteratura.
- Perché: rende automatica la sezione "Figure e grafici" della nota estesa e fa trovare un grafico senza sfogliare; è la funzione di PDFFigures 2.0 (usata da Semantic Scholar) e di Scholarcy, qui in forma leggera.
- Sforzo M. Peso: main +4-6 KiB (nel worker di estrazione, solo su richiesta), renderer +2-3; indice nella cache locale, immagini rese solo quando si aprono. Rete: nessuna. Limiti onesti: figure senza didascalia o con didascalie ruotate sfuggono; il ritaglio a mano (27) resta il ripiego. Priorità alta.

**29. Schede delle citazioni nel lettore** (top 10)
- Cosa: clic o passaggio su un riferimento nel testo, per esempio "[12]" o "(Autore, 2020)": una scheda mostra il riferimento completo e, se è già in libreria, [Leggi]; altrimenti [Aggiungi a Da rivedere] o [Proponi per la bibliografia]; con i dati già scaricati anche "citato da N" e l'anno.
- Perché: chi legge non deve saltare alla bibliografia in fondo e perdere il filo; è una delle funzioni più apprezzate del Semantic Reader.
- Sforzo M. Peso: renderer +4-6 KiB, main +2-3. Come: molti PDF hanno link interni dal "[12]" alla voce della bibliografia (pdf.js li legge già); in mancanza si analizza l'elenco dei riferimenti in fondo al testo; l'abbinamento alle opere usa la cache delle citazioni (titolo e DOI). Rete: nessuna se basta la cache; altrimenti OpenAlex già consentito, solo su clic. Dipende da: citazioni (fase 5), lettore. Priorità alta.

**30. Evidenziazioni guida su richiesta**
- Cosa: su richiesta per un paper, Claude segna le frasi chiave come Obiettivo, Metodo, Risultato (e Limite) in uno strato separato, attivabile e regolabile (quante, opacità), marcato ✦, mai scritto nel PDF né mescolato alle evidenziazioni dell'utente; un clic su una frase la trasforma in evidenziazione dell'utente.
- Perché: lettura rapida di molti paper; è l'idea delle "skimming highlights" del Semantic Reader, nata da ricerca sull'aiuto alla lettura veloce. Alimenta le sezioni della nota di letteratura (2).
- Sforzo M. Peso: renderer +2-3 KiB (strato sopra quello delle annotazioni), main +1-2; un file per documento nella cartella dati. Rete: Claude, con anteprima, stima del costo e consenso per cartella. Priorità media.

**31. "Spiega questa formula, tabella o figura"**
- Cosa: selezionando testo o ritagliando una zona (27), un'azione chiede a Claude di spiegare simboli, passaggi, assi del grafico; la risposta sta nel pannello Claude con il link alla pagina e si può salvare come nota AI marcata.
- Perché: formule e tabelle dense sono lo scoglio più comune fuori dal proprio campo; è la funzione "Explain math and table" di SciSpace.
- Sforzo S. Peso: renderer +1-2 KiB (azione nel popover della selezione). Rete: Claude con consenso; un'immagine si invia solo se l'utente l'ha ritagliata. Dipende da: chat, 27. Priorità media.

**32. Traduzione di un passaggio**
- Cosa: azione "Traduci" sulla selezione: la traduzione compare in un popover accanto al testo, marcata ✦, copiabile o salvabile come nota AI; lingua di arrivo dalle impostazioni.
- Perché: la traduzione dei PDF è tra i plugin Zotero più usati (segnale del giro 1); utile per paper in lingue diverse dalla propria.
- Sforzo S. Peso: renderer +1-2 KiB. Rete: Claude con consenso, solo il testo selezionato. Priorità media.

**33. Lettura ad alta voce**
- Cosa: legge la pagina o la selezione con le voci del sistema (Web Speech API), evidenziando la frase in corso; pausa, velocità, salto dei riferimenti tra parentesi.
- Perché: correzione di bozze, accessibilità, riposo degli occhi; esistono plugin Zotero dedicati.
- Sforzo S. Peso: renderer +2-3 KiB, nessuna dipendenza. Rete: nessuna, usando solo voci locali (`localService`; le voci "online" si escludono). Priorità bassa.

**34. Sessioni di lettura, concentrazione e statistiche locali**
- Cosa: modo concentrazione nel lettore (interfaccia nascosta, notifiche sospese, timer facoltativo) e statistiche solo locali: tempo per documento, pagine lette, giorni di lettura, paper finiti per settimana; in una vista su richiesta e nella pagina "Riprendi" (25).
- Perché: aiuta a pianificare e a vedere i progressi; plugin come Chartero e Reading Flow per Zotero nascono proprio da esigenze di dottorandi.
- Sforzo S. Peso: renderer +3-4 KiB nella vista pigra, main +1 (scrittura raggruppata, mai a ogni pagina). Rete: nessuna, nessuna telemetria; si può spegnere e cancellare. Priorità media.

### Note e sintesi

**35. Modelli di nota personalizzabili**
- Cosa: modelli in Markdown con segnaposto (`{{titolo}}`, `{{autori}}`, `{{evidenziazioni:giallo}}`, `{{figure}}`, `{{citekey}}`, `{{sezione:metodo}}`) per le note di letteratura, di progetto e per l'export; uno predefinito, gli altri dell'utente.
- Perché: nei flussi Obsidian + Zotero il modello è la parte più personalizzata; permette all'utente di cambiare le sezioni della nota estesa senza toccare il codice.
- Sforzo S. Peso: main +2-3 KiB (sostituzione semplice, nessun motore di template). Rete: nessuna. Dipende da: 2, export. Priorità media.

**36. Colori delle evidenziazioni con un significato**
- Cosa: a ciascuno dei 5 colori si dà un nome per libreria (per esempio giallo = risultato, rosso = limite, verde = metodo, blu = definizione, viola = da citare); il nome compare nel lettore, filtra le annotazioni e raggruppa le citazioni nelle note di letteratura e negli export.
- Perché: molti ricercatori usano già un codice a colori; renderlo esplicito lo fa entrare nelle sintesi.
- Sforzo S. Peso nullo (un'impostazione della libreria e poche righe nel lettore). Rete: nessuna. Priorità media.

**37. Formule LaTeX nelle note**
- Cosa: `$…$` e `$$…$$` nelle note e nelle sintesi resi come formule; copia della formula come LaTeX.
- Perché: chi lavora con modelli matematici scrive formule nelle note.
- Sforzo M. Peso: è il punto delicato. Temml (derivato da KaTeX, produce MathML, ~150-175 KB minificato) caricato solo quando una nota contiene `$` starebbe in un chunk pigro, ma il totale del renderer è a 1625-1650 su 1655: serve una decisione di budget. Alternativa più leggera: un convertitore proprio di un sottoinsieme (frazioni, apici, lettere greche, somme, matrici semplici) verso il MathML nativo di Chromium, 8-15 KiB. Rete: nessuna. Priorità bassa.

**38. Link tra note e collegamenti in entrata**
- Cosa: `[[` nelle note propone documenti, note e progetti; ogni nota o documento mostra "Citato nelle tue note" (collegamenti in entrata); i link restano `lab://` ed escono nell'export come link relativi.
- Perché: è il cuore dei flussi Obsidian e Logseq; collega le note di letteratura tra loro e con i capitoli (49).
- Sforzo S-M. Peso: main +3-4 KiB (indice dei link nella cache SQLite locale, rigenerabile), renderer +2-3. Rete: nessuna. Priorità media.

**39. Glossario di acronimi e termini del progetto**
- Cosa: su richiesta, per un progetto, si raccolgono gli acronimi definiti nei paper ("graph neural network (GNN)") con la prima pagina dove compaiono e le varianti; Claude può proporre una definizione breve, marcata ✦; esportabile in Markdown e come elenco `\newacronym` per LaTeX.
- Perché: utile per la tesi e per leggere fuori dal proprio campo; la parte locale costa poco.
- Sforzo S. Peso: main +2 KiB (espressioni regolari sul testo già estratto). Rete: nessuna; Claude facoltativo con consenso. Priorità media.

**40. Registro di domande, affermazioni e prove**
- Cosa: oggetti leggeri "Domanda", "Affermazione" e "Prova": un'affermazione si collega a evidenziazioni con pagina che la sostengono o la contraddicono, ha uno stato (da verificare, verificata con la pagina aperta, contestata) e appartiene a un progetto o a un capitolo (49); vista elenco ed esportazione in Markdown.
- Perché: nella tesi ogni frase forte deve avere la sua fonte; è il modello "discourse graph" dei plugin di ricerca per Obsidian, che però resta manuale: qui la prova è un'evidenziazione vera con la pagina.
- Sforzo M. Peso: un file per elemento nella cartella dati; vista pigra +8-12 KiB, main +3-5. Rete: nessuna. Priorità media-alta.

### Bibliografia e scoperta

**41. Ricerca approfondita da una domanda** (top 10)
- Cosa: l'utente scrive una domanda di ricerca dettagliata; l'app cerca su OpenAlex con più formulazioni, allarga con citazioni e lavori correlati (lo stesso motore di "Estendi la bibliografia"), fa giudicare a Claude la pertinenza degli abstract e restituisce un elenco ordinato con il motivo e una stima di copertura ("dopo 3 giri escono pochi paper nuovi: probabilmente trovati quasi tutti"); i risultati vanno in Da rivedere, mai scaricati da soli.
- Perché: completa "Estendi la bibliografia", che parte da paper, con una partenza da una domanda; è l'approccio iterativo di Undermind ed Elicit, qui senza account e con i dati che restano in locale.
- Sforzo L. Peso: main +6-10 KiB (in parte condiviso con Estendi la bibliografia), renderer +4-6 in una vista pigra. Rete: OpenAlex già consentito (solo la domanda e i termini) e Claude con stima del costo, tetto di spesa e anteprima (si inviano titoli e abstract pubblici). Dipende da: Estendi la bibliografia. Priorità alta.

**42. Ponte tra due insiemi di paper**
- Cosa: si scelgono due progetti, tag o selezioni; l'app trova i lavori che li collegano (citano entrambi, sono citati da entrambi, o stanno sul percorso più breve nel grafo delle citazioni) e li mostra nella Mappa come ponte.
- Perché: trovare dove due filoni si toccano è spesso l'idea di una tesi o di un capitolo; è il "Literature Connector" di Inciteful.
- Sforzo M. Peso: main +2-3 KiB (riusa il motore di Estendi la bibliografia), renderer +2. Rete: OpenAlex già consentito. Priorità media.

**43. Screening con criteri e diagramma PRISMA**
- Cosa: per un insieme di candidati (da Estendi la bibliografia o da 41) si scrivono criteri di inclusione ed esclusione; l'utente decide su titolo e abstract con tasti rapidi (includi, escludi, forse) e un motivo di esclusione; Claude può proporre una decisione marcata ✦ con la frase su cui si basa; alla fine il diagramma di flusso PRISMA con i conteggi, esportato in SVG e Markdown, e il registro delle decisioni.
- Perché: rende documentata e ripetibile la crescita della bibliografia, utile per rassegne sistematiche e capitoli di stato dell'arte; è il flusso di screening di Elicit.
- Sforzo M. Peso: vista pigra +8-10 KiB (SVG scritto a mano), main +2-3. Rete: nessuna; Claude facoltativo con consenso. Priorità media.

**44. Versioni ad accesso aperto in blocco** (top 10)
- Cosa: per i candidati di Estendi la bibliografia, per "Da leggere dopo" e per i riferimenti mancanti, l'app mostra se esiste una copia legale gratuita (archivio istituzionale, arXiv, editore) e con quale licenza; l'utente sceglie quali scaricare e i PDF finiscono nella cartella di arrivo, da confermare come oggi.
- Perché: far crescere la bibliografia senza aprire decine di pagine a mano; è ciò che fa Unpaywall, i cui dati OpenAlex riporta già (migliore posizione ad accesso aperto).
- Sforzo S. Peso: main +2-3 KiB, renderer +1-2. Rete: OpenAlex già consentito per sapere dove sta il PDF; lo scaricamento contatta il sito che lo ospita (un host diverso ogni volta), quindi solo dopo conferma con l'elenco dei siti. Dipende da: cartella di arrivo, 23, Estendi la bibliografia. Priorità alta.

**45. Andamento delle citazioni nel tempo**
- Cosa: nella scheda del documento un piccolo grafico delle citazioni per anno e, per un progetto, quali paper stanno crescendo.
- Perché: distingue un lavoro storico da uno che sta diventando centrale; aiuta a scegliere cosa leggere.
- Sforzo S. Peso: renderer +1-2 KiB (SVG in linea). Rete: OpenAlex già consentito (conteggi per anno, nella stessa richiesta delle citazioni). Priorità bassa.

### Integrità delle fonti

**46. Ritrattazioni, errata e avvisi** (top 10)
- Cosa: badge "Ritirato" (e, con Crossref, "Errata" o "Avviso di preoccupazione") nella Libreria, nella scheda, nella cartella di arrivo e nelle proposte di Estendi la bibliografia, con il link all'avviso; avviso anche quando si esporta una bibliografia o si controlla un manoscritto (50) che cita un lavoro ritirato.
- Perché: citare in tesi un paper ritirato è un rischio concreto; Zotero lo fa da anni con i dati di Retraction Watch, ora pubblici tramite Crossref.
- Sforzo S. Peso: main +1-2 KiB, renderer +1-2. Rete: OpenAlex già consentito (il campo "ritirato" del lavoro, nessuna richiesta in più); il controllo di errata e avvisi via Crossref è un host nuovo e chiede consenso (invia solo DOI). Funziona solo per documenti con DOI. Priorità alta.

**47. Cosa è cambiato tra due versioni di un paper**
- Cosa: dati due PDF (preprint v1 e v2, o preprint e versione pubblicata, già riconosciuti dalla fase 5), confronto del testo estratto per sezione con le differenze evidenziate, nella lettura affiancata (3).
- Perché: capire se la versione pubblicata cambia risultati o numeri prima di citarla.
- Sforzo M. Peso: renderer +4-6 KiB (confronto proprio sul testo, nessuna dipendenza). Rete: nessuna. Dipende da: 3, versioni dei preprint. Priorità bassa.

**48. Codice, dati e notebook del paper** (top 10)
- Cosa: dal testo già estratto si riconoscono i link a codice e dati (GitHub, GitLab, Zenodo, figshare, OSF, Hugging Face, DOI di dataset) e la sezione "Data availability"; la scheda mostra "Codice e dati" con il link e la pagina; l'utente può collegare anche cartelle locali o notebook propri (aperti con il programma predefinito, come i documenti).
- Perché: alimenta la sezione "Dati usati" della nota estesa e serve a riprodurre i risultati; è nel piano tra le funzioni a bassa priorità ("collegamento tra paper e codice o notebook"); Papers with Code è stato chiuso, quindi va fatto in locale.
- Sforzo S. Peso: main +2-3 KiB (espressioni regolari), renderer +1-2. Rete: nessuna; i link si aprono nel browser solo su clic. Priorità alta.

### Scrittura e tesi

**49. Mappa capitoli ↔ fonti della tesi** (top 10)
- Cosa: un progetto può avere una scaletta (capitoli e sezioni), scritta a mano o letta da un file `.tex` (`\chapter`, `\section`) o `.md` (titoli) scelto dall'utente, in sola lettura; paper, note, evidenziazioni e affermazioni (40) si assegnano alle sezioni; una matrice mostra le fonti per sezione e segnala quelle con poche fonti; per ogni capitolo si esporta il `.bib` o la nota di sintesi.
- Perché: la domanda "quali fonti uso in questo capitolo, e dove sono scoperto?" è quotidiana in una tesi; oggi si risolve con collezioni per capitolo o matrici a mano.
- Sforzo M. Peso: main +3-4 KiB (lettura della scaletta, file del progetto), vista pigra +8-12. Rete: nessuna. Dipende da: progetti, 7/13. Priorità alta.

**50. Controllo delle citazioni di un manoscritto** (top 10)
- Cosa: si sceglie un manoscritto (`.tex` con `.aux`/`.bcf`, oppure Markdown con `[@chiave]`), letto e mai modificato; un rapporto elenca: chiavi citate ma assenti dalla libreria, voci del `.bib` mai citate, paper ritirati (46), preprint di cui esiste la versione pubblicata, la stessa opera con chiavi diverse; ogni riga ha un'azione (aggiungi, apri, aggiorna la voce).
- Perché: è ciò che fa checkcites, più i controlli di qualità che solo un gestore di riferimenti conosce; evita errori alla consegna.
- Sforzo S-M. Peso: main +3-5 KiB (lettura di `\citation{}`, del `.bcf` e delle chiavi pandoc con espressioni regolari). Rete: nessuna. Dipende da: 7/13 (chiavi stabili). Priorità alta.

**51. Suggerimenti di citazione per una bozza**
- Cosa: per ogni paragrafo di un manoscritto scelto (letto e mai modificato), i paper della libreria più vicini nel contenuto che non sono già citati lì, con la frase o l'evidenziazione che giustifica il suggerimento; Claude facoltativo per una motivazione in una riga, marcata.
- Perché: trova le fonti che l'utente possiede già ma ha dimenticato; usa il modello TF-IDF locale che esiste.
- Sforzo M. Peso: main +3-4 KiB (riusa il modello del grafo), renderer +4. Rete: nessuna (Claude solo su richiesta). Dipende da: 50, grafo. Priorità media.

**52. File `.bib` sempre aggiornato** (da unire alla 7)
- Cosa: per un progetto o una collezione si sceglie un file `.bib` in una cartella dell'utente (per esempio quella del progetto LaTeX, sincronizzata con Overleaf tramite git o un servizio di file); l'app lo riscrive in modo atomico quando membri o metadati cambiano, con chiavi stabili, senza toccare le voci scritte a mano in un blocco riservato.
- Perché: è la funzione per cui Better BibTeX è indispensabile a chi scrive in LaTeX ("tieni aggiornato"); senza account Overleaf né integrazioni cloud.
- Sforzo S. Peso: main +2-3 KiB. Rete: nessuna. Dipende da: 7/13. Priorità alta.

**53. Risposta ai revisori**
- Cosa: si incollano i commenti dei revisori; l'app li divide in punti numerati; per ogni punto: stato (da fare, in corso, fatto, in disaccordo), risposta, modifica fatta e fonti della libreria a sostegno; Claude può proporre una bozza di risposta marcata ✦; esportazione della lettera punto per punto in Markdown o LaTeX.
- Perché: la matrice "commento → risposta → modifica" è il metodo consigliato dagli editori; durante un dottorato le revisioni sono frequenti.
- Sforzo M. Peso: vista pigra +8-10 KiB, main +2; un file per lavoro nella cartella dati. Rete: nessuna; Claude facoltativo con consenso (i commenti dei revisori sono riservati: si inviano solo con conferma esplicita). Priorità media.

**54. Resoconto per il relatore o il gruppo di lettura** (top 10)
- Cosa: su richiesta, per un periodo ("dall'ultima riunione") o una selezione: Markdown con cosa si è letto, evidenziazioni principali, note, domande aperte (40), paper aggiunti e da leggere; per il gruppo di lettura, una pagina per paper con sintesi, punti chiave e domande per la discussione. Claude facoltativo per la sintesi, marcata ✦.
- Perché: le riunioni con il relatore e i gruppi di lettura sono un appuntamento fisso del dottorato; i dati ci sono già (registro, stato di studio, note).
- Sforzo S-M. Peso: main +2-3 KiB, renderer +3. Rete: nessuna; Claude facoltativo con consenso. Dipende da: registro delle modifiche, export. Priorità alta.

**55. Sintesi in linguaggio semplice**
- Cosa: per un paper (soprattutto i propri, già riconosciuti dal profilo) Claude scrive versioni per pubblici diversi: per tutti (4-5 frasi), per un bando, per una presentazione di un minuto; marcate ✦, da rivedere.
- Perché: divulgazione e domande di finanziamento; è l'idea delle "storie" di Kudos, senza pubblicare nulla.
- Sforzo S. Peso nullo (riusa i lavori AI). Rete: Claude con consenso. Priorità bassa.

### Scartate o assorbite

- Rinominare o spostare i PDF come ZotFile o Attanger: contraddice la regola 1 (gli originali non si rinominano né si spostano).
- Condivisione pubblica di annotazioni o storie (Hypothesis, Kudos): niente cloud né pubblicazione; resta la sintesi locale (55).
- "Consensus meter" (sì / no / forse su una domanda): assorbibile come colonna della tabella di confronto (16); conta gli studi senza pesarne la qualità, e la colonna deve dirlo.
- Lavori precedenti e derivati di Connected Papers, digest di Paper Digest, ricerca semantica di Iris.ai: coperti da "Estendi la bibliografia" e da 41.
- Integrazione diretta con Overleaf: coperta da 52 (un `.bib` in una cartella che l'utente sincronizza già); nessun account.
- API di Papers with Code: servizio chiuso; sostituita dall'estrazione locale (48).

### Note per la decisione (giro 2)

- Le funzioni del top 10 non aggiungono dipendenze; sette su dieci lavorano senza rete o solo con OpenAlex già consentito.
- 27, 28 e 48 servono direttamente alla nota di letteratura estesa (2); 41, 44 e 46 (con 42 e 43) alla crescita della bibliografia; 49, 50, 52 e 53 alla scrittura della tesi con BibTeX (7).
- Il main è il vincolo: con le onde del design si arriva a 1064-1082 KiB su 1085. Prima di implementare una proposta che tocca il main serve una decisione: alzare il tetto con il motivo (funzioni chieste dall'utente) oppure mettere le funzioni nuove in moduli del main caricati con `import()` dinamico, misurati a parte.
- Ordine consigliato, dopo le onde del design: note di letteratura estese (2) con 27, 28 e 48; Zotero e BibTeX (7, 13, 52) con 50; Estendi la bibliografia con 44 e 46; poi 29, 49, 54, 41.

### Fonti del giro 2

https://retorque.re/zotero-better-bibtex/
https://retorque.re/zotero-better-bibtex/citing/
https://www.scholarcy.com/faq
https://help.scholarcy.com/guide/supercharge-your-reading
https://allenai.org/blog/case-study-iterative-design-for-skimming-support-5563dbe0899e
https://openreader.semanticscholar.org/
https://library.hkust.edu.hk/news-events/news/semantic-reader-augmented-application-make-reading-pdfs-easier
https://typeset.io/resources/introducing-copilot-ai-assistant-explains-research-papers/
https://consensus.app/home/blog/introducing-the-consensus-meter/
https://aarontay.substack.com/p/undermindai-different-type-of-ai-agent
https://www.undermind.ai/whitepaper.pdf
https://elicit.com/blog/systematic-review
https://support.elicit.com/en/articles/14859896-new-in-elicit-screening-quotes-and-exclusion-reasons
https://medium.com/connectedpapers/announcing-connected-papers-a-visual-tool-for-researchers-to-find-and-explore-academic-papers-89146a54c7d4
https://library.hkust.edu.hk/news-events/news/citation-mapping-tools-literature-discovery
https://github.com/MuiseDestiny/zotero-gpt
https://github.com/lifan0127/ai-research-assistant
https://www.zotero.org/blog/retracted-item-notification/
https://www.crossref.org/blog/retraction-watch-retractions-now-in-the-crossref-api/
https://crossref.org/documentation/retrieve-metadata/retraction-watch/
https://help.openalex.org/data/works/attributes/
https://developers.openalex.org/api-reference/works/get-a-single-work
https://unpaywall.org/products/api
https://casrai.org/guides/papers-with-code
https://index.scala-lang.org/allenai/pdffigures2/artifacts/pdffigures2
https://forums.zotero.org/discussion/105014/how-to-easily-copy-an-area-of-image-from-a-pdf-file
https://library-guides.ucl.ac.uk/zotero/extracting-annotations
https://www.github.com/ronkok/Temml
https://community.obsidian.md/plugins/discourse-graphs
https://forum.obsidian.md/t/a-free-obsidian-only-claim-ledger-for-research-notes/117902
https://forums.zotero.org/discussion/108381/plugin-introducing-the-chartero-visualize-your-library
https://forums.zotero.org/discussion/132985/plugin-reading-flow-v1-3-0-reading-statistics-and-resume-from-recent-progress
https://benjamins.com/content/authors/kudos
https://ctan.org/tex-archive/support/checkcites
https://manusights.com/blog/revision-response-matrix-template
https://authorservices.taylorandfrancis.com/blog/peer-review/how-to-respond-to-reviewer-comments/
https://www.skillsdirectory.com/skills/yha9806-map

## Scelte dell'utente (giro 2)

Data: 2026-11-18. Parole dell'utente tradotte. Decisioni in `docs/DECISIONS.md` (D-395 … D-409); dove vivono le funzioni nell'interfaccia: `docs/design/ARCHITETTURA-UI.md` §17.

**Vincolo forte dell'utente:** «I do not want the graphics to be crowded with functionalities». Ogni funzione accettata vive dove si trova ma resta silenziosa: contestuale (barra di selezione, popover del lettore, menu ⋯, schede del progetto, tavolozza dei comandi), su richiesta, rivelata a poco a poco; nessuna voce nuova nella barra laterale; principi di composizione di §1.1 (D-402).

| N. | Funzione | Scelta | Note |
| --- | --- | --- | --- |
| 27 | Ritaglio di figure, tabelle ed equazioni | **Sì** | |
| 28 | Indice automatico di figure e tabelle | **No** | |
| 29 | Schede delle citazioni nel lettore | **Sì** | |
| 30 | Evidenziazioni guida su richiesta | **Sì, come esperimento** | «could be nice, let's try it»; il designer avversario la prova contro affollamento e utilità prima di renderla stabile (D-401) |
| 31 | Spiega formula, tabella o figura | **Sì** | |
| 35 | Modelli di nota | **Sì** | |
| 36 | Colori con un significato | **Sì** | |
| 37 | Formule LaTeX nelle note | **Sì** | convertitore proprio verso MathML, niente libreria da 150 KB (D-406) |
| 38 | Link tra note e collegamenti in entrata | **Sì** | |
| 40 | Domande, affermazioni e prove | **Sì** | |
| 41 | Ricerca approfondita da una domanda | **Sì, con i migliori risultati e una sintesi strutturata per candidato** | per ogni candidato una scheda breve nello stesso senso delle note di letteratura (problema, metodo, risultati, dati, limiti) per scegliere bene (D-397) |
| 42 | Ponte tra due insiemi di paper | **Sì** | unificata con la nuova "Trova un ponte" (D-396) |
| 43 | Screening con criteri e diagramma PRISMA | in sospeso | l'utente non sapeva cos'è: spiegazione sotto |
| 48 | Codice, dati e notebook | **Sì, generalizzata** | la libreria tiene **più dei PDF**: risorse (repository di codice, dataset, pagine web, notebook) con anteprima e "Apri", collegate a paper e progetti (D-398) |
| 49 | Mappa capitoli ↔ fonti | **Sì, generalizzata, da confermare** | «perché la tesi?»: qualsiasi manoscritto o scaletta di un progetto (articolo, tesi, domanda di finanziamento, presentazione): matrice sezioni ↔ fonti (D-399) |
| 50 | Controllo delle citazioni di un manoscritto | **No** | |
| 51 | Suggerimenti di citazione per una bozza | **Sì, dentro un progetto** | |
| 54 | Resoconto per il relatore o il gruppo di lettura | **Sì, solo tramite un progetto** | serve uno "schema della ricerca" nel progetto (idea, domande, ipotesi, piano); il resoconto nasce da quello e dall'attività di lettura; senza, non si può fare (D-400) |
| nuova | **Trova un ponte** tra due paper | **Sì (richiesta dell'utente)** | si scelgono due paper (Libreria o Mappa) e si cerca un lavoro che li colleghi senza forzare: applica il metodo dell'uno al dominio dell'altro, condivide i dati, cita entrambi o è citato da entrambi; classifica con il motivo e un risultato onesto "nessun ponte convincente" (D-396) |
| 52 | `.bib` sempre aggiornato | unita alla 7 | |
| 13 | Esportazione con chiavi stabili | con la 7, **da confermare** | |
| 4, 5, 6 (forse), 8, 9, 14, 15, 17, 18, 20, 21, 22, 24, 26, 32, 33, 34, 39, 43, 44, 45, 46, 47, 53, 55 | — | in sospeso | le non citate del giro 2 restano in sospeso |

### Proposta 43 spiegata in modo semplice (da mostrare all'utente)

**PRISMA** è il modo standard, usato nelle rassegne sistematiche, per dire **come** si è arrivati all'elenco finale dei paper di una rassegna. Si parte da tutti i paper trovati (per esempio 400 dalle ricerche), si tolgono i doppioni, poi si leggono titolo e abstract e si scartano quelli fuori tema secondo **criteri scritti prima** ("solo studi su dati reali", "dal 2015 in poi"), poi si leggono i testi completi dei rimasti e si scartano altri con il motivo. Il **diagramma PRISMA** è il disegno a scatole con i numeri di ogni passaggio (400 trovati → 360 senza doppioni → 80 dopo l'abstract → 25 inclusi, con i motivi delle esclusioni).

Nell'app vorrebbe dire: dai candidati di "Estendi la bibliografia" o della ricerca approfondita, una vista in cui si decide paper per paper con un tasto (includi, escludi con il motivo, forse), con Claude che può proporre una decisione marcata ✦, e alla fine il diagramma con i numeri, pronto per il capitolo di stato dell'arte o per un articolo di rassegna. Serve soprattutto a chi scrive una **rassegna sistematica** o deve documentare la ricerca bibliografica della tesi; per una lettura normale non serve.
