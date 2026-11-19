/**
 * LaTeX to MathML with no dependency (feature 37, D-406): the part of LaTeX that notes use (fractions, roots, scripts, big
 * operators, Greek letters, accents, `\text`, `\left ... \right`, matrices and cases). It builds a small tree, never HTML: the
 * caller turns it into elements (or into a string with `mathToString`). A formula it does not understand (an unknown command,
 * unbalanced braces, too long or too deep) gives `null`, and the caller shows the source as it is.
 */
export interface MNode {
  t: string;
  a?: Record<string, string>;
  c?: MNode[] | string;
  /** Big operator: its scripts go above and below in display style. */
  lim?: true;
}

const MAX_LEN = 3000;
const MAX_DEPTH = 24;
const MAX_NODES = 4000;

const el = (t: string, c?: MNode[] | string, a?: Record<string, string>): MNode => ({ t, ...(a ? { a } : {}), ...(c !== undefined ? { c } : {}) });
const mi = (s: string) => el('mi', s);
const mo = (s: string, a?: Record<string, string>) => el('mo', s, a);
const row = (c: MNode[]) => (c.length === 1 ? c[0]! : el('mrow', c));

const GREEK = 'alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ iota ι kappa κ lambda λ mu μ nu ν xi ξ pi π varpi ϖ rho ρ varrho ϱ sigma σ varsigma ς tau τ upsilon υ phi ϕ varphi φ chi χ psi ψ omega ω Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω infty ∞ partial ∂ nabla ∇ hbar ℏ ell ℓ Re ℜ Im ℑ aleph ℵ emptyset ∅ varnothing ∅ angle ∠ top ⊤ bot ⊥ forall ∀ exists ∃ neg ¬ prime ′';
const OPS = 'cdot ⋅ times × div ÷ pm ± mp ∓ leq ≤ le ≤ geq ≥ ge ≥ neq ≠ ne ≠ approx ≈ equiv ≡ sim ∼ simeq ≃ cong ≅ propto ∝ to → rightarrow → leftarrow ← Rightarrow ⇒ Leftarrow ⇐ leftrightarrow ↔ Leftrightarrow ⇔ mapsto ↦ implies ⟹ iff ⟺ in ∈ notin ∉ ni ∋ subset ⊂ subseteq ⊆ supset ⊃ supseteq ⊇ cup ∪ cap ∩ setminus ∖ ldots … dots … cdots ⋯ vdots ⋮ ll ≪ gg ≫ perp ⊥ parallel ∥ circ ∘ bullet ∙ otimes ⊗ oplus ⊕ star ⋆ ast ∗ wedge ∧ land ∧ vee ∨ lor ∨ vdash ⊢ langle ⟨ rangle ⟩ lbrace { rbrace } lfloor ⌊ rfloor ⌋ lceil ⌈ rceil ⌉ lvert | rvert | mid ∣ colon : uparrow ↑ downarrow ↓ prec ≺ succ ≻ nabla ∇';
const table = (s: string): Map<string, string> => {
  const w = s.split(' ');
  return new Map(Array.from({ length: w.length / 2 }, (_, i) => [w[2 * i]!, w[2 * i + 1]!]));
};
const GREEK_T = table(GREEK);
const OPS_T = table(OPS);
/** Operators that take limits above and below in display style. */
const LIMITS = table('sum ∑ prod ∏ coprod ∐ bigcup ⋃ bigcap ⋂ bigoplus ⨁ bigotimes ⨂');
const NAMED_LIMITS = new Set('lim limsup liminf max min sup inf det gcd Pr arg'.split(' '));
const INTS = table('int ∫ iint ∬ iiint ∭ oint ∮');
const FUNCS = new Set('sin cos tan cot sec csc sinh cosh tanh coth arcsin arccos arctan log ln lg exp deg dim ker hom mod bmod'.split(' '));
const ACCENT: Record<string, [string, 'over' | 'under']> = { hat: ['^', 'over'], widehat: ['^', 'over'], check: ['ˇ', 'over'], tilde: ['~', 'over'], widetilde: ['~', 'over'], bar: ['¯', 'over'], overline: ['¯', 'over'], vec: ['→', 'over'], dot: ['˙', 'over'], ddot: ['¨', 'over'], underline: ['_', 'under'] };
const SPACE: Record<string, string> = { ',': '0.17em', ':': '0.22em', ';': '0.28em', ' ': '0.28em', quad: '1em', qquad: '2em', '!': '-0.17em' };
const FENCED: Record<string, [string, string]> = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], matrix: ['', ''], smallmatrix: ['', ''], cases: ['{', ''], aligned: ['', ''], align: ['', ''], gathered: ['', ''], array: ['', ''] };
const TEXT_CMDS = new Set(['text', 'textrm', 'mbox', 'textit', 'textbf', 'operatorname']);
const DELIM: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '|': '|', '/': '/', '.': '', '\\{': '{', '\\}': '}', '\\|': '‖', '\\langle': '⟨', '\\rangle': '⟩', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉', '\\lvert': '|', '\\rvert': '|' };
const SPECIAL_ESC = new Set(['{', '}', '%', '$', '#', '&', '_', '\\']);

const BB: Record<string, string> = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };
const CAL: Record<string, string> = { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' };
/** Double-struck or script letters, from the Unicode alphabets. */
function styled(text: string, kind: 'bb' | 'cal'): string {
  const [up, low, ex] = kind === 'bb' ? [0x1d538, 0x1d552, BB] : [0x1d49c, 0x1d4b6, CAL];
  return [...text]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (ex[ch]) return ex[ch];
      if (c >= 65 && c <= 90) return String.fromCodePoint(up + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(low + c - 97);
      if (kind === 'bb' && c >= 48 && c <= 57) return String.fromCodePoint(0x1d7d8 + c - 48);
      return ch;
    })
    .join('');
}

class Parser {
  i = 0;
  nodes = 0;
  depth = 0;
  readonly s: string;
  readonly display: boolean;
  constructor(s: string, display: boolean) {
    this.s = s;
    this.display = display;
  }

  fail(): never {
    throw new Error('unsupported');
  }
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  peek(): string {
    this.ws();
    const c = this.s[this.i];
    if (c === undefined) return '';
    if (c !== '\\') return c;
    return /^\\[a-zA-Z]+/.exec(this.s.slice(this.i, this.i + 40))?.[0] ?? this.s.slice(this.i, this.i + 2);
  }
  take(): string {
    const t = this.peek();
    this.i += t.length;
    return t;
  }
  expect(t: string) {
    if (this.take() !== t) this.fail();
  }
  /** Raw text up to the closing brace (for `\text`), braces inside balanced. */
  raw(): string {
    this.expect('{');
    let d = 1;
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++]!;
      if (c === '{') d++;
      else if (c === '}' && --d === 0) return out;
      out += c;
    }
    return this.fail();
  }

  /** A sequence of atoms with their scripts, up to a stop token (not consumed). */
  seq(stop: (t: string) => boolean): MNode[] {
    if (++this.depth > MAX_DEPTH) this.fail();
    const out: MNode[] = [];
    for (let t = this.peek(); t !== '' && !stop(t); t = this.peek()) {
      if (++this.nodes > MAX_NODES) this.fail();
      out.push(this.scripts(this.atom()));
    }
    this.depth--;
    return out;
  }

  scripts(base: MNode): MNode {
    let sub: MNode | null = null;
    let sup: MNode | null = null;
    for (;;) {
      const t = this.peek();
      if (t === '_' || t === '^') {
        this.take();
        const a = this.arg();
        if (t === '_' ? sub : sup) this.fail();
        if (t === '_') sub = a;
        else sup = a;
      } else if (t === "'") {
        this.take();
        sup = sup ? row([sup, mo('′')]) : mo('′');
      } else break;
    }
    if (!sub && !sup) return base;
    const under = base.lim === true && this.display;
        if (sub && sup) return el(under ? 'munderover' : 'msubsup', [base, sub, sup]);
    if (sub) return el(under ? 'munder' : 'msub', [base, sub]);
    return el(under ? 'mover' : 'msup', [base, sup!]);
  }

  /** The argument of a command or a script: a braced group, or one token. */
  arg(): MNode {
    if (this.peek() === '{') {
      this.take();
      const c = this.seq((t) => t === '}');
      this.expect('}');
      return row(c.length === 0 ? [el('mrow', [])] : c);
    }
    const t = this.peek();
    if (t === '' || t === '}' || t === '_' || t === '^') this.fail();
    // `rac12` and `x^23` take ONE digit: the rest is outside the argument.
    if (/[0-9]/.test(t)) return el('mn', this.take());
    return this.atom();
  }

  atom(): MNode {
    const t = this.take();
    if (t === '{') {
      const c = this.seq((x) => x === '}');
      this.expect('}');
      return el('mrow', c);
    }
    if (t === '}' || t === '^' || t === '_' || t === '&') return this.fail();
    if (!t.startsWith('\\')) {
      if (/[0-9]/.test(t)) {
        let n = t;
        while (/[0-9]/.test(this.s[this.i] ?? '') || (this.s[this.i] === '.' && /[0-9]/.test(this.s[this.i + 1] ?? ''))) n += this.s[this.i++];
        return el('mn', n);
      }
      if (/\p{L}/u.test(t)) return mi(t);
      if (t === '-') return mo('−');
      if (t === '*') return mo('∗');
      return mo(t);
    }
    return this.command(t.slice(1));
  }

  command(name: string): MNode {
    if (GREEK_T.has(name)) return mi(GREEK_T.get(name)!);
    if (OPS_T.has(name)) return mo(OPS_T.get(name)!);
    if (LIMITS.has(name)) return { ...mo(LIMITS.get(name)!, { largeop: 'true' }), lim: true };
    if (INTS.has(name)) return mo(INTS.get(name)!, { largeop: 'true' });
    if (NAMED_LIMITS.has(name)) return { ...el('mo', name, { movablelimits: 'true' }), lim: true };
    if (name === '|') return mo('‖');
    if (FUNCS.has(name)) return mi(name);
    if (name in SPACE) return el('mspace', undefined, { width: SPACE[name]! });
    if (SPECIAL_ESC.has(name)) return name === '\\' ? this.fail() : mo(name);
    if (ACCENT[name]) {
      const [ch, pos] = ACCENT[name]!;
      return el(pos === 'over' ? 'mover' : 'munder', [this.arg(), mo(ch, pos === 'over' ? { accent: 'true' } : {})], pos === 'over' ? { accent: 'true' } : {});
    }
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
        return el('mfrac', [this.arg(), this.arg()]);
      case 'binom':
        return el('mrow', [mo('('), el('mfrac', [this.arg(), this.arg()], { linethickness: '0' }), mo(')')]);
      case 'sqrt': {
        if (this.peek() === '[') {
          this.take();
          const idx = this.seq((t) => t === ']');
          this.expect(']');
          return el('mroot', [this.arg(), row(idx)]);
        }
        return el('msqrt', [this.arg()]);
      }
      case 'mathrm':
        return el('mstyle', [this.arg()], { mathvariant: 'normal' });
      case 'mathbf':
        return el('mstyle', [this.arg()], { style: 'font-weight:bold' });
      case 'mathit':
        return el('mstyle', [this.arg()], { style: 'font-style:italic' });
      case 'mathbb':
      case 'mathcal':
        return mi(styled(this.raw(), name === 'mathbb' ? 'bb' : 'cal'));
      case 'left': {
        const open = this.take();
        const inner = this.seq((t) => t === '\\right');
        this.expect('\\right');
        const close = this.take();
        if (!(open in DELIM) || !(close in DELIM)) this.fail();
        return el('mrow', [...(DELIM[open] ? [mo(DELIM[open]!, { fence: 'true', stretchy: 'true' })] : []), ...inner, ...(DELIM[close] ? [mo(DELIM[close]!, { fence: 'true', stretchy: 'true' })] : [])]);
      }
      case 'begin':
        return this.environment();
      case 'right':
      case 'end':
        return this.fail();
      default:
        if (TEXT_CMDS.has(name)) return name === 'operatorname' ? mi(this.raw()) : el('mtext', this.raw());
        return this.fail();
    }
  }

  environment(): MNode {
    const env = this.raw();
    const fences = FENCED[env];
    if (!fences) this.fail();
    if (env === 'array' && this.peek() === '{') this.raw();
    const rows: MNode[][][] = [[[]]];
    for (;;) {
      const cell = this.seq((t) => t === '&' || t === '\\\\' || t === '\\end');
      rows[rows.length - 1]![rows[rows.length - 1]!.length - 1] = cell;
      const t = this.take();
      if (t === '&') rows[rows.length - 1]!.push([]);
      else if (t === '\\\\') rows.push([[]]);
      else if (t === '\\end') {
        if (this.raw() !== env) this.fail();
        break;
      } else this.fail();
    }
    const last = rows[rows.length - 1]!;
    if (rows.length > 1 && last.length === 1 && last[0]!.length === 0) rows.pop();
    const align = env === 'cases' || env === 'aligned' || env === 'align' ? { columnalign: 'left' } : undefined;
    const table = el(
      'mtable',
      rows.map((r) => el('mtr', r.map((c) => el('mtd', c)))),
      align,
    );
    const [l, r] = fences;
    return el('mrow', [...(l ? [mo(l, { fence: 'true', stretchy: 'true' })] : []), table, ...(r ? [mo(r, { fence: 'true', stretchy: 'true' })] : [])]);
  }
}

/** The MathML tree of a LaTeX formula, or `null` when it is not understood. */
export function latexToMathML(tex: string, display = false): MNode | null {
  const src = tex.trim();
  if (src === '' || src.length > MAX_LEN) return null;
  try {
    const p = new Parser(src, display);
    const c = p.seq(() => false);
    if (p.peek() !== '') return null;
    return el('math', c, display ? { display: 'block' } : {});
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** The tree as a MathML string (every text and value escaped). */
export function mathToString(n: MNode): string {
  const attrs = Object.entries(n.a ?? {})
    .filter(([k]) => !k.startsWith('data-'))
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('');
  if (n.c === undefined || (Array.isArray(n.c) && n.c.length === 0 && n.t !== 'mrow')) return `<${n.t}${attrs}/>`;
  return `<${n.t}${attrs}>${typeof n.c === 'string' ? esc(n.c) : n.c.map(mathToString).join('')}</${n.t}>`;
}

/** Where `$...$` and `$$...$$` formulas sit in a text, outside code: `[start, end, tex, display]`. Pandoc's rules: no space inside the dollars, no digit right after the closing one. */
export function findMath(text: string): Array<[number, number, string, boolean]> {
  const out: Array<[number, number, string, boolean]> = [];
  const code = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
  const skip: Array<[number, number]> = [...text.matchAll(code)].map((m) => [m.index, m.index + m[0].length]);
  const inCode = (i: number) => skip.some(([a, b]) => i >= a && i < b);
  const re = /\$\$([\s\S]+?)\$\$|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![0-9$])/g;
  for (const m of text.matchAll(re)) {
    if (inCode(m.index)) continue;
    out.push([m.index, m.index + m[0].length, (m[1] ?? m[2])!.trim(), m[1] !== undefined]);
  }
  return out;
}
