import { describe, expect, it } from 'vitest';
import { parseLabLink } from './labLinks';

const D = '0123456789abcdef';

describe('parseLabLink', () => {
  it('accepts the three forms', () => {
    expect(parseLabLink(`lab://doc/${D}`)).toEqual({ kind: 'doc', docId: D });
    expect(parseLabLink(`lab://doc/${D}?page=12`)).toEqual({ kind: 'doc', docId: D, page: 12 });
    expect(parseLabLink(`lab://note/${D}`)).toEqual({ kind: 'note', docId: D });
    expect(parseLabLink('lab://project/p-1.a_b')).toEqual({ kind: 'project', id: 'p-1.a_b' });
  });

  it.each([
    'https://example.com',
    'http://example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
    'LAB://doc/' + D,
    ' lab://doc/' + D,
    'lab://doc/' + D + ' ',
    'lab://doc/' + D.toUpperCase(),
    'lab://doc/abc',
    `lab://doc/${D}?page=0`,
    `lab://doc/${D}?page=-1`,
    `lab://doc/${D}?page=100001`,
    `lab://doc/${D}?page=2&x=1`,
    `lab://doc/${D}?x=1`,
    `lab://doc/${D}/extra`,
    `lab://doc/${D}#frag`,
    `lab://note/${D}?page=2`,
    'lab://note/short',
    'lab://project/',
    'lab://project/../x',
    'lab://project/a/b',
    'lab://folder/x',
    'lab:doc/' + D,
    '',
  ])('refuses %s', (href) => {
    expect(parseLabLink(href)).toBeNull();
  });
});
