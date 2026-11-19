import { describe, expect, it } from 'vitest';
import { bibliographyLines, parseBibliography } from './parse';

describe('bibliography parsing', () => {
  it('takes the lines after the last References heading', () => {
    expect(bibliographyLines([{ page: 1, text: 'Body\nReferences\n[1] A. Rossi. Title. 2019.' }])).toEqual(['[1] A. Rossi. Title. 2019.']);
    expect(bibliographyLines([{ page: 1, text: 'no heading here' }])).toBeNull();
  });
  it('reads numbered entries with a continued line', () => {
    const e = parseBibliography(['[1] A. Rossi. First work', 'continued 2019.', '[2] B. Bianchi. Second 2020.', '[3] C. Verdi. Third 2021.']);
    expect(e.map((x) => x.n)).toEqual([1, 2, 3]);
    expect(e[0]).toMatchObject({ surname: 'rossi', year: 2019 });
  });
  it('reads author-year entries', () => {
    const e = parseBibliography(['Rossi, A. (2019). A title.', 'Bianchi, B. (2020). Another title.']);
    expect(e).toHaveLength(2);
    expect(e[1]).toMatchObject({ surname: 'bianchi', year: 2020 });
  });
});
