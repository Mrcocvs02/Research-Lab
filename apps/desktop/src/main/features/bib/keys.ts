/** `base`, or `base` + a, b, ... z, aa ... when taken. */
export function freeKey(base: string, used: ReadonlySet<string>): string {
  let key = base;
  for (let n = 0; used.has(key); n++) {
    let suffix = '';
    for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) suffix = String.fromCharCode(97 + (k % 26)) + suffix;
    key = base + suffix;
  }
  return key;
}
