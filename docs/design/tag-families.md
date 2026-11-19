# Famiglie di tag e quattro correzioni della Mappa (D-491)

Origine: audit §18 su dati reali (`AUDIT.md`), richiesta dell'utente di poter creare famiglie di tag da sé.

## Famiglie di tag
- Una famiglia è un nome (Metodo, Sistema, Tecnica, Tipo di dati, Tipo di paper, ...) dato ai tag con il suggerimento di gruppo `extra:<Nome>` del nodo di tassonomia. Nessun campo nuovo: `group` esiste già, si sincronizza con la tassonomia ed è annullabile come ogni modifica (un'operazione `taxonomy:apply`, una sola voce di registro).
- Nuova operazione `setGroup` (`id`, `group` o `null`) in `taxonomy:apply`; `rename` di una famiglia = `setGroup` su tutti i membri.
- Interfaccia: sezione "Famiglie (per la Mappa)" nella gestione dei tag (`TaxonomyFamilies`): crea una famiglia, rinominala, aggiungi o togli tag (il selettore aggiunge uno alla volta, quanti si vuole). "Sotto un tag" è il genitore già impostabile nell'editor del nodo: un figlio di un membro risale al membro (`tagMemberships` prende i membri in cima).
- La Mappa elenca le famiglie da sola (`listFamilies` offre già `group:extra:*`). Topic resta l'impostazione iniziale; i tag senza famiglia non cambiano.
- "✦ Suggerisci famiglie" (AI): non fatto. Il percorso dei suggerimenti di tag assegna tag ai documenti, non nodi a famiglie: servirebbe un nuovo prompt con anteprima, consenso e tetto, non un riuso a basso costo.

## Le quattro correzioni
- R9, espansione di un lavoro: al più 8 rombi di tag (`topTags`: peso, poi tag condivisi da più lavori, poi id); il resto è la nota "+N tag in più" (`hiddenTags` in `graph:neighbors`).
- R10, legenda: richiudibile (pulsante sul titolo, ricordato come comodità dell'utente) e più bassa (al massimo 260 px o il 45 % dell'altezza).
- R11, colori spenti: la tinta segue i quadrati delle quote (l'area dominante vince) e il fattore di croma è concavo con pavimento 0,3: 76/24 resta ben colorato, 50/50 resta leggibile.
- R12, un solo nome: con una famiglia attiva ogni cluster della mappa prende il nome dell'area della famiglia che ne contiene più punti (`nameByFamily`), così etichette e legenda coincidono.
