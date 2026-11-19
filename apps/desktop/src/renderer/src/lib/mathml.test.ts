import { describe, expect, it } from 'vitest';
import { findMath, latexToMathML, mathToString } from './mathml';

const render = (tex: string, display = false): string | null => {
  const n = latexToMathML(tex, display);
  return n ? mathToString(n) : null;
};

/** LaTeX -> MathML (feature 37, D-406). The first column is what the note holds, the second what is shown. */
const CASES: Array<[string, boolean, string]> = [
  ['x^2', false, '<math><msup><mi>x</mi><mn>2</mn></msup></math>'],
  ['E = mc^2', false, '<math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>'],
  ['\\frac{a}{b}', false, '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>'],
  ['\\frac12', false, '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>'],
  ['\\sqrt{2}', false, '<math><msqrt><mn>2</mn></msqrt></math>'],
  ['\\sqrt[3]{x+1}', false, '<math><mroot><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mn>3</mn></mroot></math>'],
  ['a_{ij}^{k}', false, '<math><msubsup><mi>a</mi><mrow><mi>i</mi><mi>j</mi></mrow><mi>k</mi></msubsup></math>'],
  ["f'(x)", false, '<math><msup><mi>f</mi><mo>′</mo></msup><mo>(</mo><mi>x</mi><mo>)</mo></math>'],
  ['\\alpha + \\beta \\leq \\gamma', false, '<math><mi>α</mi><mo>+</mo><mi>β</mi><mo>≤</mo><mi>γ</mi></math>'],
  ['\\sum_{i=1}^{n} x_i', true, '<math display="block"><munderover><mo largeop="true">∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>x</mi><mi>i</mi></msub></math>'],
  ['\\sum_{i=1}^{n} x_i', false, '<math><msubsup><mo largeop="true">∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></msubsup><msub><mi>x</mi><mi>i</mi></msub></math>'],
  ['\\int_0^1 f(x)\\,dx', false, '<math><msubsup><mo largeop="true">∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mspace width="0.17em"/><mi>d</mi><mi>x</mi></math>'],
  ['\\lim_{x\\to 0} \\frac{\\sin x}{x}', true, '<math display="block"><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mfrac><mrow><mi>sin</mi><mi>x</mi></mrow><mi>x</mi></mfrac></math>'],
  ['\\text{if } x>0', false, '<math><mtext>if </mtext><mi>x</mi><mo>&gt;</mo><mn>0</mn></math>'],
  ['\\left( \\frac{a}{b} \\right)', false, '<math><mrow><mo fence="true" stretchy="true">(</mo><mfrac><mi>a</mi><mi>b</mi></mfrac><mo fence="true" stretchy="true">)</mo></mrow></math>'],
  ['\\binom{n}{k}', false, '<math><mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow></math>'],
  ['\\mathbb{R}^n', false, '<math><msup><mi>ℝ</mi><mi>n</mi></msup></math>'],
  ['\\hat{x}', false, '<math><mover accent="true"><mi>x</mi><mo accent="true">^</mo></mover></math>'],
  ['\\vec v', false, '<math><mover accent="true"><mi>v</mi><mo accent="true">→</mo></mover></math>'],
  ['\\operatorname{rank}(A)', false, '<math><mi>rank</mi><mo>(</mo><mi>A</mi><mo>)</mo></math>'],
  ['x \\in \\{1,2\\}', false, '<math><mi>x</mi><mo>∈</mo><mo>{</mo><mn>1</mn><mo>,</mo><mn>2</mn><mo>}</mo></math>'],
  [
    '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    false,
    '<math><mrow><mo fence="true" stretchy="true">(</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo fence="true" stretchy="true">)</mo></mrow></math>',
  ],
  [
    '\\begin{cases} x & x>0 \\\\ 0 & \\text{else} \\end{cases}',
    false,
    '<math><mrow><mo fence="true" stretchy="true">{</mo><mtable columnalign="left"><mtr><mtd><mi>x</mi></mtd><mtd><mi>x</mi><mo>&gt;</mo><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mtext>else</mtext></mtd></mtr></mtable></mrow></math>',
  ],
];

describe('LaTeX to MathML', () => {
  it.each(CASES)('renders %s', (tex, display, expected) => {
    expect(render(tex, display)).toBe(expected);
  });

  it('gives null for a formula it does not understand, so the caller shows it as it is', () => {
    for (const bad of ['\\foo{x}', '\\frac{a}{b', '}', 'x^2^3', '\\begin{nothing} a \\end{nothing}', '\\begin{pmatrix} a \\end{bmatrix}', '', '   ', '\\left( x', '\\\\']) expect(render(bad), bad).toBeNull();
  });

  it('refuses a formula that is too long or nested too deep, without failing', () => {
    expect(render('x'.repeat(3001))).toBeNull();
    expect(render('{'.repeat(60) + 'x' + '}'.repeat(60))).toBeNull();
  });

  it('never lets text become markup', () => {
    expect(render('\\text{<b>x</b> & y}')).toBe('<math><mtext>&lt;b&gt;x&lt;/b&gt; &amp; y</mtext></math>');
  });
});

describe('finding formulas in a note', () => {
  it('finds inline and display formulas', () => {
    const text = 'Energy $E=mc^2$ and\n$$\\frac{a}{b}$$ done';
    const found = findMath(text);
    expect(found.map(([, , tex, display]) => [tex, display])).toEqual([
      ['E=mc^2', false],
      ['\\frac{a}{b}', true],
    ]);
    expect(text.slice(found[0]![0], found[0]![1])).toBe('$E=mc^2$');
  });

  it('does not take prices, spaced dollars or code for formulas', () => {
    expect(findMath('it costs $5 and $10 today')).toEqual([]);
    expect(findMath('a $ b $ c')).toEqual([]);
    expect(findMath('use `$x$` here\n```\n$$y$$\n```')).toEqual([]);
  });
});
