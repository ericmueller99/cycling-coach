/**
 * Zwift's pen access expressions, e.g.
 * `(powerCurves.zFTPwkg < 3.58 && powerCurves.zMAPwkg < 4.3) && subgroup.label <= 2`.
 * Parsed here (never `eval`) and evaluated with three-valued logic: a value we don't know (a women's
 * category, an organiser's own score) is `null`, so `false || null` is "can't tell" while
 * `true || null` still lets the athlete in.
 */

export interface AccessContext {
  zftp?: number | undefined;
  zmap?: number | undefined;
  weightKg?: number | undefined;
  /** Zwift's category number: 0 = A+, 1 = A … 5 = E. */
  category?: number | undefined;
  racingScore?: number | undefined;
  zwiftId?: number | undefined;
}

type Value = number | string | boolean | null;

type Node =
  | { t: 'lit'; v: number | string }
  | { t: 'id'; name: string }
  | { t: 'not'; a: Node }
  | { t: 'and' | 'or'; a: Node; b: Node }
  | { t: 'cmp'; op: '==' | '!=' | '<' | '<=' | '>' | '>='; a: Node; b: Node };

type Token = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      out.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('()<>!'.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new Error('unterminated string');
      out.push({ k: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][\w.]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    throw new Error(`unexpected "${ch}"`);
  }
  return out;
}

/** Recursive descent: or → and → unary → comparison → primary. */
function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected ${v}`);
    p++;
  };

  const or = (): Node => {
    let a = and();
    while (isOp('||')) {
      p++;
      a = { t: 'or', a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = unary();
    while (isOp('&&')) {
      p++;
      a = { t: 'and', a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('!')) {
      p++;
      return { t: 'not', a: unary() };
    }
    return cmp();
  };
  const cmp = (): Node => {
    const a = primary();
    const t = peek();
    if (t?.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      p++;
      return { t: 'cmp', op: t.v as '==', a, b: primary() };
    }
    return a;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error('unexpected end');
    if (t.k === 'num' || t.k === 'str') return { t: 'lit', v: t.v };
    if (t.k === 'id') return t.v === 'true' || t.v === 'false' ? { t: 'lit', v: t.v === 'true' ? 1 : 0 } : { t: 'id', name: t.v };
    if (t.v === '(') {
      const inner = or();
      expect(')');
      return inner;
    }
    throw new Error(`unexpected ${t.v}`);
  };

  const node = or();
  if (p !== toks.length) throw new Error('trailing input');
  return node;
}

/** Parsed once per distinct expression; a few hundred distinct ones cover thousands of events. */
const cache = new Map<string, Node | null>();
function compiled(src: string): Node | null {
  let node = cache.get(src);
  if (node === undefined) {
    try {
      node = parse(src);
    } catch {
      node = null;
    }
    if (cache.size > 2000) cache.clear();
    cache.set(src, node);
  }
  return node;
}

function resolve(name: string, ctx: AccessContext, label: number): Value {
  const wkg = (w: number | undefined) => (w !== undefined && ctx.weightKg ? w / ctx.weightKg : null);
  switch (name) {
    case 'subgroup.label':
      return label;
    case 'powerCurves.zFTP':
      return ctx.zftp ?? null;
    case 'powerCurves.zMAP':
      return ctx.zmap ?? null;
    case 'powerCurves.zFTPwkg':
      return wkg(ctx.zftp);
    case 'powerCurves.zMAPwkg':
      return wkg(ctx.zmap);
    case 'powerCurves.category':
      return ctx.category ?? null;
    case 'scoring.current':
      return ctx.racingScore ?? null;
    case 'profile.profileId':
    case 'profile.profileid':
      return ctx.zwiftId ?? null;
    case 'profile.playerType':
      return 'NORMAL';
    default:
      return null; // categoryWomen, powerCompoundScore, scoring.max30, profile.age …
  }
}

function evaluate(node: Node, ctx: AccessContext, label: number): Value {
  switch (node.t) {
    case 'lit':
      return node.v;
    case 'id':
      return resolve(node.name, ctx, label);
    case 'not': {
      const a = truth(evaluate(node.a, ctx, label));
      return a === null ? null : !a;
    }
    case 'and': {
      const a = truth(evaluate(node.a, ctx, label));
      if (a === false) return false;
      const b = truth(evaluate(node.b, ctx, label));
      if (b === false) return false;
      return a === null || b === null ? null : true;
    }
    case 'or': {
      const a = truth(evaluate(node.a, ctx, label));
      if (a === true) return true;
      const b = truth(evaluate(node.b, ctx, label));
      if (b === true) return true;
      return a === null || b === null ? null : false;
    }
    case 'cmp': {
      const a = evaluate(node.a, ctx, label);
      const b = evaluate(node.b, ctx, label);
      if (a === null || b === null) return null;
      switch (node.op) {
        case '==':
          return a === b;
        case '!=':
          return a !== b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
        case '>':
          return a > b;
        case '>=':
          return a >= b;
      }
    }
  }
}

function truth(v: Value): boolean | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

/** Whether the athlete may enter pen `label` (1–5). `null` = can't tell (or unparseable). */
export function evaluateAccess(expression: string, ctx: AccessContext, label: number): boolean | null {
  const node = compiled(expression);
  return node ? truth(evaluate(node, ctx, label)) : null;
}

/** What an expression is based on, for "Your pen: B (zFTP)". */
export function accessBasis(expression: string): 'zftp' | 'racing_score' | undefined {
  if (/scoring\./.test(expression)) return 'racing_score';
  if (/powerCurves\./.test(expression)) return 'zftp';
  return undefined;
}

/** Zwift's category numbering for `powerCurves.category`. */
export function categoryNumber(category: string | undefined): number | undefined {
  if (!category) return undefined;
  const n = ({ 'A+': 0, A: 1, B: 2, C: 3, D: 4, E: 5 } as Record<string, number>)[category];
  return n;
}
