# Proposte di nuove funzioni (da confermare con l'utente)

Stato: proposta, nulla è implementato. Data: 2026-11-17.

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
