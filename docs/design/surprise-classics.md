# Sorprendimi e classici di Scopri (D-492)

## Sorprendimi
- Il modello scarta già le coppie con tag, cartella o chiavi di citazione in comune. `surprise.ts` aggiunge ciò che il modello non vede: citazioni tra i due documenti (nei due versi), collegamenti manuali o del cercatore, coppie scartate, autori in comune.
- Servono almeno 2 termini condivisi (evidenza reale); le coppie di cluster diversi passano prima (peso 1 contro 0,5).
- Se non resta nulla: messaggio "nessuna coppia sorprendente", mai coppie già note.

## Classici in Scopri
- `generality.ts`: citazioni per anno, moltiplicatore 1/(1+log10(1+c/20)) con minimo 0,25, e fino a -30% se quasi tutti i semi citano l'opera (da 3 semi in su).
- Si applica dopo la lettura dei dettagli (che portano `cited_by_count`), prima dell'ordinamento finale; il flag `weak` dei ponti non cambia.
- Classico: almeno 15 anni e 2000 citazioni. Nascosto di default; il pulsante "Includi classici" (`run-classics-toggle`) li mostra.
