// Fast Myers line diff: a drop-in for makefun-diff 1.0.0.
//
// run(input) returns make.fun's own patch of { old, new } as one string: a
// header line, then hunks of up to 3 context lines around each change run.
// The edit script is Myers's greedy search with the deletion preferred when
// a deletion and an insertion reach the same point, and no edge-diagonal
// pruning. This module reproduces that script exactly, but computes it with
// typed arrays instead of linked path objects, and compares lines by small
// integer ids instead of by string, which is where the speed comes from.
//
// Lines: a text is cut after every "\n" (the only separator; "\r" is part of
// its line), and a last line with no "\n" is a line too. The empty text has
// no lines. Two lines are equal only when they are the same code units,
// newline or its absence included.

/** Op codes for the edit script: a kept, a deleted and an inserted line. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/**
 * A text's lines without their "\n" (split is the fastest way to cut them),
 * plus whether the text ends with one: every line but possibly the last has
 * a newline, and a last line without one is a different line from the same
 * text with one, so the bare line is interned apart (see run).
 */
function tokenize(text) {
  if (text === '') return { lines: [], bare: false };
  const lines = text.split('\n');
  const bare = text.charCodeAt(text.length - 1) !== 10;
  if (!bare) lines.pop();
  return { lines, bare };
}

/**
 * The edit script of the middle region, as op codes in order: Myers's greedy
 * search, run forwards over typed V arrays with one snapshot per edit depth,
 * then walked back from the end to rebuild the exact path the search took.
 * A and B are the region's line ids, N and M their lengths. The snapshots
 * hold, for depth d, the furthest old position reached on each diagonal
 * k = -d + 2j, or -1 when that diagonal holds no path.
 */
function myersOps(A, B, N, M) {
  const vs = [];
  let v0 = new Int32Array(1);
  let x = 0;
  let y = 0;
  while (x < N && y < M && A[x] === B[y]) {
    x++;
    y++;
  }
  v0[0] = x;
  vs.push(v0);
  let D = 0;
  if (!(x >= N && y >= M)) {
    outer: for (let d = 1; d <= N + M; d++) {
      const prev = vs[d - 1];
      const cur = new Int32Array(d + 1);
      cur.fill(-1);
      // j = 0: insertion only.
      {
        const v = prev[0];
        if (v >= 0 && v + d <= M) {
          let nx = v;
          let ny = nx + d;
          while (nx < N && ny < M && A[nx] === B[ny]) {
            nx++;
            ny++;
          }
          cur[0] = nx;
          if (nx >= N && ny >= M) {
            D = d;
            vs.push(cur);
            break outer;
          }
        }
      }
      let pDel = prev[0];
      for (let j = 1; j < d; j++) {
        const k = -d + (j << 1);
        const vIns = prev[j];
        let xDel = -1;
        let xIns = -1;
        if (pDel >= 0 && pDel + 1 <= N) xDel = pDel + 1;
        if (vIns >= 0 && vIns - k <= M) xIns = vIns;
        pDel = vIns;
        if (xDel < 0 && xIns < 0) continue;
        let nx = xDel >= xIns ? xDel : xIns;
        let ny = nx - k;
        while (nx < N && ny < M && A[nx] === B[ny]) {
          nx++;
          ny++;
        }
        cur[j] = nx;
        if (nx >= N && ny >= M) {
          D = d;
          vs.push(cur);
          break outer;
        }
      }
      // j = d: deletion only.
      {
        const v = prev[d - 1];
        if (v >= 0 && v + 1 <= N) {
          let nx = v + 1;
          let ny = nx - d;
          while (nx < N && ny < M && A[nx] === B[ny]) {
            nx++;
            ny++;
          }
          cur[d] = nx;
          if (nx >= N && ny >= M) {
            D = d;
            vs.push(cur);
            break outer;
          }
        }
      }
      vs.push(cur);
    }
  }
  // Walk the path back from the end, mirroring the forward choice at each depth.
  const ops = [];
  let bx = N;
  let by = M;
  for (let d = D; d > 0; d--) {
    const k = bx - by;
    const prev = vs[d - 1];
    const j = (k + d) >> 1;
    let xDel = -1;
    let xIns = -1;
    if (j >= 1) {
      const v = prev[j - 1];
      if (v >= 0 && v + 1 <= N) xDel = v + 1;
    }
    if (j <= d - 1) {
      const v = prev[j];
      if (v >= 0 && v - k <= M) xIns = v;
    }
    const isDel = xDel >= xIns;
    const lx = isDel ? xDel : xIns;
    while (bx > lx) {
      ops.push(KEEP);
      bx--;
      by--;
    }
    if (isDel) {
      ops.push(DELETE);
      bx--;
    } else {
      ops.push(INSERT);
      by--;
    }
  }
  while (bx > 0) {
    ops.push(KEEP);
    bx--;
    by--;
  }
  ops.reverse();
  return ops;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line, hasNL) {
  return hasNL ? `${op}${line}\n` : `${op}${line}\n%\n`;
}

/** make.fun's own patch of input.old into input.new. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const ta = tokenize(input.old);
  const tb = tokenize(input.new);
  const a = ta.lines;
  const b = tb.lines;
  const n = a.length;
  const m = b.length;

  // One small id per distinct line, so every comparison below is an integer one.
  // A bare last line never shares an id with a line that ends in "\n".
  const table = new Map();
  const bareTable = new Map();
  let nextId = 0;
  const idOf = (s, bare) => {
    const t = bare ? bareTable : table;
    let id = t.get(s);
    if (id === undefined) {
      id = nextId++;
      t.set(s, id);
    }
    return id;
  };
  const ai = new Int32Array(n);
  for (let i = 0; i < n; i++) ai[i] = idOf(a[i], ta.bare && i === n - 1);
  const bi = new Int32Array(m);
  for (let i = 0; i < m; i++) bi[i] = idOf(b[i], tb.bare && i === m - 1);

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ai[prefix] === bi[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ai[n - 1 - suffix] === bi[m - 1 - suffix]) suffix++;
  const N = n - prefix - suffix;
  const M = m - prefix - suffix;

  // The runs of the edit script, in order.
  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  };
  pushRun(KEEP, prefix);
  if (N > 0 || M > 0) {
    const ops = myersOps(ai.subarray(prefix, n - suffix), bi.subarray(prefix, m - suffix), N, M);
    // Run-length encode the middle ops inline: one pass, no call per line.
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      let count = 1;
      while (i + 1 < ops.length && ops[i + 1] === op) {
        i++;
        count++;
      }
      pushRun(op, count);
    }
  }
  pushRun(KEEP, suffix);

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at], at < n - 1 || !ta.bare));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i], c.o + i < n - 1 || !ta.bare));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i], c.p + i < m - 1 || !tb.bare));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at], at < n - 1 || !ta.bare));
  }
  return out.join('');
}
