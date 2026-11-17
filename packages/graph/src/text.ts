const IT =
  'a ad al allo ai agli all alla alle con col coi da dal dallo dai dagli dalla dalle di del dello dei degli della delle in nel nello nei negli nella nelle su sul sullo sui sugli sulla sulle per tra fra il lo la i gli le un uno una e ed o ma se che chi cui non più piu come anche ' +
  'è sono era erano essere stato stata stati state ha hanno aveva avere ho abbiamo questo questa questi queste quello quella quelli quelle suo sua suoi sue loro ogni altro altra altri altre molto poco tutto tutti tutta tutte dove quando quindi dunque però pero così cosi ' +
  'tra fra sia sui nonché ove ciò cio sono può puo possono può può essere fatto fare';
const EN =
  'a an the and or but if of to in on at by for from with without into onto over under about as is are was were be been being am do does did doing have has had having this that these those it its they them their he she his her we our you your i me my ' +
  'not no nor so than then there here when where which who whom whose what why how all any both each few more most other some such only own same too very can will just should would could may might must also between through during before after above below up down out off again further once ' +
  'et al etc using use used based paper study results result show shown shows however thus therefore within across among per via';

const STOP = new Set(`${IT} ${EN}`.split(/\s+/).filter(Boolean));

/** Words of a text, lower case: letters and digits only, 3-40 characters, no numbers, no stop words (Italian and English). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || raw.length > 40 || STOP.has(raw) || /^\p{N}+$/u.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

export const isStopWord = (w: string): boolean => STOP.has(w);
