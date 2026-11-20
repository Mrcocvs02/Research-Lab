# Pacchetti di vocabolario di partenza (field pack)

Un *pack* è un file JSON in `packages/core/src/vocab/packs/` che fornisce un vocabolario iniziale per etichettatura (tag) e clustering in un'area di ricerca. Il primo è `physics-qi-manybody.json`: fisica, informazione quantistica, many-body, materia condensata, meccanica statistica, teoria dell'informazione, metodi numerici, AI/ML, fisica matematica. Lo schema è in `pack-schema.ts`; `pack.test.ts` lo valida.

## Struttura
- Quattro famiglie: `topic` (gerarchia a 3 livelli: macro-area, sotto-area, dettaglio; multi-valore), `method` (famiglie di tecniche; valore singolo), `system` (modelli, piattaforme, materiali; multi-valore), `paperType` (tipo di articolo; valore singolo).
- Ogni concetto ha un id stabile `famiglia.slug`, l'etichetta inglese canonica, l'etichetta italiana (se ovvia), gli alias (acronimi, varianti di grafia, plurali, sinonimi), `parent`, `distinctFrom` opzionale (coppie facili da confondere, per esempio entropia di entanglement contro entropia termodinamica o di Shannon) e suggerimenti di categorie arXiv.
- Il test verifica: id unici, genitori esistenti nella stessa famiglia, profondità al massimo 3, nessuna etichetta o alias condiviso da due concetti (confronto senza maiuscole, trattini e spazi multipli), famiglie a valore singolo marcate.

## Fonti e licenze
- Categorie arXiv (`cond-mat.str-el`, `quant-ph`, `physics.comp-ph`, `math-ph`, `cs.LG`, ...): solo come riferimento, dalla tassonomia pubblica di arXiv.
- APS PhySH (Physics Subject Headings): consultato solo per l'impostazione generale delle faccette (aree di ricerca, sistemi fisici, proprietà, tecniche). Le pagine pubbliche lette non dichiarano la licenza dei dati e la voce "CC0" non è stata verificata, quindi nessun termine né gerarchia è stato copiato: etichette, alias e albero sono scritti a mano. Importare PhySH richiederebbe prima la verifica della licenza e il dump ufficiale (non fatto qui).
- Nessun download in blocco, nessuna dipendenza aggiunta.

## Uso previsto
- Il pack semina etichettatura e clustering: gli alias riconducono forme diverse allo stesso concetto (per esempio NQS, neural quantum states, neural-network quantum states) e la gerarchia fornisce i nodi padre per raggruppare.
- Il pack non è l'elenco mostrato all'utente: la vista Vocabolario mostra solo i concetti effettivamente usati nella libreria; quelli del pack non usati restano invisibili.
- I termini in `distinctFrom` non vanno uniti al concetto anche se vicini.
- Le famiglie a valore singolo accettano un solo valore per documento.

## Evoluzione
- Un id non cambia mai di significato; un concetto superato si marca come sostituito, l'id non si riusa.
- Nuovi alias e concetti si aggiungono dalla pratica (termini frequenti non coperti nelle librerie), con una nuova `version` se cambia la struttura.
- Altri pack (altre aree) seguono lo stesso schema, senza nomi di persone né percorsi reali.
