// Uvoz/izvoz podataka. Formati su kompatibilni sa tabelama:
//   Tačke:            ID;tip;Y;X;Z;dubina;NPV        (tip: B, CPT, DPSH; Y/X po Gaus-Krigeru ili E/N)
//   Slojevi bušotina: ID;od;do;sredina;opis
//   CPT / CPTu:       ID;dubina;qc;fs;u2             (qc u MPa ili kPa, fs i u2 u kPa — prepoznaje se automatski)
//   DPSH-B:           ID;dubina;N20   ili   ID;dubina;N10
//   Topografija:      Y;X;Z   (ili E;N;Z, ili .xyz bez zaglavlja)
//   Legenda sredina:  sredina;naziv;boja;redosled   (opciono)
// Separator ; , ili tab. Decimalni zarez je dozvoljen uz separator ; ili tab.

import { trendIdw } from '../core/gwl.js';

const PALETTE = ['#c9b79c', '#a87b55', '#ecd27a', '#dc9a52', '#8d9eac', '#7fa77a', '#b98bb5', '#d4a373', '#6d8fb3', '#c46b5a', '#9aa36b', '#5f5e5a'];

const pn = (s, dec) => {
  let t = String(s ?? '').trim().replace(/\s/g, '');
  if (dec) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const v = parseFloat(t);
  return isFinite(v) ? v : NaN;
};

export function parseTable(txt) {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).map((s) => s.replace(/\s+$/, '')).filter((s) => s.trim().length);
  if (lines.length < 1) throw new Error('prazan fajl');
  const top = lines.slice(0, 10);
  const cnt = (ch) => top.reduce((s, l) => s + (l.split(ch).length - 1), 0);
  let dl = ',';
  if (cnt('\t') >= top.length) dl = '\t';
  else if (cnt(';') >= top.length) dl = ';';
  else if (cnt(',') < top.length) dl = /\s+/; // .xyz razdvojeno razmacima
  const split = (l) => (dl instanceof RegExp ? l.trim().split(dl) : l.split(dl)).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const first = split(lines[0]);
  const dec = dl !== ',';
  const headerless = first.every((c) => isFinite(pn(c, dec)));
  const head = headerless ? first.map((_, i) => ['e?', 'n?', 'z'][i] || 'c' + i) : first.map((h) => h.toLowerCase());
  const rows = (headerless ? lines : lines.slice(1)).map(split).filter((r) => r.some((c) => c.length));
  return { head, rows, headerless, num: (v) => pn(v, dec) };
}

const fcol = (h, re) => h.findIndex((x) => re.test(x));
const RE = {
  id: /^id\b|oznaka|naziv\s*ta|tačka|tacka|bušotina|busotina|^bh\b|^ime|sonda|^point/,
  dpsh: /^n\s*_?(10|20)\b|udar|blows/,
  qc: /^qc|\bqc\b|q_c|^cone/,
  from: /^od\b|^od\s|^from|^top\b|^vrh|krovina/,
  to: /^do\b|^do\s|^to\b|bottom|^dno|podina/,
  color: /boja|colou?r/,
  code: /sredina|^igs?\b|^kod|šifra|sifra|^code|^unit|litol|^sloj/,
  x: /^x\b|^x\s|^e\?$/,
  y: /^y\b|^y\s|^n\?$/,
  e: /^e\b|^e\s|east|istok/,
  n: /^n\b|^n\s|north|sever/,
  z: /^z\b|^z\s|kota|elev|mnv|m\s*n\.?v|^h\b/,
};

export function detectKind(h) {
  if (fcol(h, RE.color) >= 0 && fcol(h, RE.code) >= 0) return 'soils';
  if (fcol(h, RE.dpsh) >= 0) return 'dpsh';
  if (fcol(h, RE.qc) >= 0) return 'cpt';
  if (fcol(h, RE.from) >= 0 && fcol(h, RE.to) >= 0) return 'layers';
  const hasXY = (fcol(h, RE.x) >= 0 && fcol(h, RE.y) >= 0) || (fcol(h, RE.e) >= 0 && fcol(h, RE.n) >= 0);
  if (hasXY && fcol(h, RE.id) >= 0) return 'points';
  if (hasXY) return 'topo';
  return null;
}

const isNorthing = (m) => m > 4.2e6 && m < 5.4e6; // Srbija/region: GK X i UTM N

function coordCols(T) {
  const h = T.head;
  const ie = fcol(h, RE.e), inn = fcol(h, RE.n);
  if (ie >= 0 && inn >= 0 && !T.headerless) return { e: ie, n: inn, note: 'E/N' };
  const ix = fcol(h, RE.x) >= 0 ? fcol(h, RE.x) : 0;
  const iy = fcol(h, RE.y) >= 0 ? fcol(h, RE.y) : 1;
  const mean = (i) => {
    const v = T.rows.slice(0, 200).map((r) => T.num(r[i])).filter(isFinite);
    return v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
  };
  const mx = mean(ix), my = mean(iy);
  if (T.headerless) {
    // bez zaglavlja: E N Z, osim ako je prva kolona očigledno sever
    return isNorthing(mx) && !isNorthing(my) ? { e: iy, n: ix, note: 'X(sever) Y(istok)' } : { e: ix, n: iy, note: 'E N Z' };
  }
  if (isNorthing(mx) && !isNorthing(my)) return { e: iy, n: ix, note: 'Gaus-Kriger: Y = istok, X = sever' };
  return { e: ix, n: iy, note: 'X = istok, Y = sever' };
}

function inferType(id, t) {
  const s = String(t || '').toLowerCase();
  if (/cpt|statič|static|scpt/.test(s)) return 'CPT';
  if (/dp|dinam/.test(s)) return 'DPSH';
  if (/^b|buš|bus|bh|sb/.test(s)) return 'B';
  const u = id.toLowerCase();
  if (/^s?cptu?/.test(u)) return 'CPT';
  if (/^dp/.test(u)) return 'DPSH';
  return 'B';
}

export function emptyProject() {
  return {
    name: 'Novi projekat', crs: 'MGI 1901 / Balkans zona 7 (EPSG:3909)', heightRef: 'mnv',
    soils: [], terrain: { points: [] }, locations: {}, boreholes: [], cpts: [], dpsh: [], sections: [],
  };
}

/**
 * Uvozi tekst tabele u "staging" strukturu projekta. Vraća poruku za dnevnik.
 * Staging: { locs: Map(id→{id,type,E,N,Z,depth,gwl}), layers: Map, cpt: Map, dpsh: Map, topo: [], soils: Map, descr: Map }
 */
export function importTable(st, txt, fname) {
  let T;
  const nm = fname || 'tabela';
  try { T = parseTable(txt); } catch (e) { return { ok: false, msg: `✕ ${nm}: ${e.message}` }; }
  let kind = T.headerless ? (T.head.length >= 3 ? 'topo' : null) : detectKind(T.head);
  if (!kind) return { ok: false, msg: `✕ ${nm}: vrsta tabele nije prepoznata (zaglavlje: ${T.head.join(', ')})` };
  const h = T.head;
  const base = fname ? fname.replace(/\.[^.]+$/, '') : null;
  const idOf = (r, ii) => (ii >= 0 ? String(r[ii] || '').trim() : '') || base;

  if (kind === 'points') {
    const c = coordCols(T), ii = fcol(h, RE.id), it = fcol(h, /^tip|vrsta|^type/), iz = fcol(h, RE.z);
    const idp = fcol(h, /dub|depth/), ig = fcol(h, /npv|nivo|^gw|voda|water/);
    let n = 0;
    for (const r of T.rows) {
      const id = String(r[ii] || '').trim();
      if (!id) continue;
      const p = {
        id, type: inferType(id, it >= 0 ? r[it] : ''), E: T.num(r[c.e]), N: T.num(r[c.n]),
        Z: iz >= 0 ? T.num(r[iz]) : NaN, depth: idp >= 0 ? T.num(r[idp]) : NaN, gwl: ig >= 0 ? T.num(r[ig]) : NaN,
      };
      if (isFinite(p.E) && isFinite(p.N)) { st.locs.set(id, p); n++; }
    }
    return { ok: true, kind, msg: `✓ ${nm}: ${n} istražnih tačaka (${c.note})` };
  }
  if (kind === 'topo') {
    const c = coordCols(T);
    const iz = T.headerless ? 2 : fcol(h, RE.z);
    let n = 0;
    for (const r of T.rows) {
      const p = [T.num(r[c.e]), T.num(r[c.n]), T.num(r[iz])];
      if (p.every(isFinite)) { st.topo.push(p); n++; }
    }
    return { ok: true, kind, msg: `✓ ${nm}: ${n} topografskih tačaka (${c.note})` };
  }
  if (kind === 'soils') {
    const ic = fcol(h, RE.code), icol = fcol(h, RE.color), iname = fcol(h, /naziv|opis|name|desc/), io = fcol(h, /redosled|order|^rb/);
    let n = 0;
    for (const r of T.rows) {
      const code = String(r[ic] || '').trim();
      if (!code) continue;
      st.soils.set(code, { code, name: iname >= 0 ? r[iname] : code, color: r[icol] || null, order: io >= 0 ? T.num(r[io]) : NaN });
      n++;
    }
    return { ok: true, kind, msg: `✓ ${nm}: legenda, ${n} sredina` };
  }
  if (kind === 'layers') {
    let ii = fcol(h, RE.id); if (ii < 0) ii = 0;
    const i0 = fcol(h, RE.from), i1 = fcol(h, RE.to);
    let iu = fcol(h, RE.code); if (iu < 0) iu = 3;
    const io = fcol(h, /opis|desc/);
    const seen = new Set();
    let n = 0;
    for (const r of T.rows) {
      const id = idOf(r, ii);
      const a = T.num(r[i0]), b = T.num(r[i1]), code = String(r[iu] || '').trim() || '?';
      if (!id || !isFinite(a) || !isFinite(b) || b <= a) continue;
      if (!seen.has(id)) { st.layers.set(id, []); seen.add(id); }
      const description = io >= 0 ? r[io] || '' : '';
      st.layers.get(id).push({ top: a, bottom: b, code, description });
      if (description && !st.descr.has(code)) st.descr.set(code, description);
      n++;
    }
    return { ok: true, kind, msg: `✓ ${nm}: ${n} intervala u ${seen.size} bušotina` };
  }
  if (kind === 'cpt') {
    const ii = fcol(h, RE.id), iz = fcol(h, /dub|depth|^z\b|penetr/);
    const iq = fcol(h, RE.qc), ifs = fcol(h, /^fs|\bfs\b|frik|fric|sleeve/), iu = fcol(h, /u2|^u\b|pore/);
    const by = new Map();
    for (const r of T.rows) {
      const id = idOf(r, ii);
      if (!id) continue;
      if (!by.has(id)) by.set(id, []);
      by.get(id).push([T.num(r[iz]), T.num(r[iq]), ifs >= 0 ? T.num(r[ifs]) : NaN, iu >= 0 ? T.num(r[iu]) : NaN]);
    }
    const notes = [];
    for (const [id, rows] of by) {
      const a = rows.filter((v) => isFinite(v[0]) && isFinite(v[1])).sort((x, y) => x[0] - y[0]);
      const mq = Math.max(...a.map((v) => v[1]));
      const mf = Math.max(0, ...a.map((v) => v[2]).filter(isFinite));
      const mu = Math.max(0, ...a.map((v) => Math.abs(v[3])).filter(isFinite));
      const kq = mq > 150 ? 1 / 1000 : 1; // kPa → MPa
      const kf = mf > 0 && mf < 2 ? 1000 : 1; // MPa → kPa
      const ku = mu > 0 && mu < 5 ? 1000 : 1;
      if (kq !== 1) notes.push(`${id}: qc u kPa → MPa`);
      st.cpt.set(id, a.map((v) => ({ z: v[0], qc: v[1] * kq, fs: v[2] * kf, u2: v[3] * ku })));
    }
    return { ok: true, kind, msg: `✓ ${nm}: CPT ${[...by.keys()].join(', ')}${notes.length ? ' (' + notes.join('; ') + ')' : ''}` };
  }
  if (kind === 'dpsh') {
    const ii = fcol(h, RE.id), iz = fcol(h, /dub|depth|^z\b|penetr/), iN = fcol(h, RE.dpsh);
    const nType = /10/.test(h[iN]) ? 'N10' : 'N20';
    const by = new Map();
    for (const r of T.rows) {
      const id = idOf(r, ii);
      if (!id) continue;
      if (!by.has(id)) by.set(id, []);
      by.get(id).push({ z: T.num(r[iz]), n: T.num(r[iN]) });
    }
    for (const [id, rows] of by) st.dpsh.set(id, { nType, data: rows.filter((v) => isFinite(v.z) && isFinite(v.n)).sort((a, b) => a.z - b.z) });
    return { ok: true, kind, msg: `✓ ${nm}: DPSH-B (${nType}) ${[...by.keys()].join(', ')}` };
  }
  return { ok: false, msg: `✕ ${nm}: nepodržano` };
}

export function emptyStaging() {
  return { locs: new Map(), layers: new Map(), cpt: new Map(), dpsh: new Map(), topo: [], soils: new Map(), descr: new Map() };
}

/** Projekat → staging (da bi novi fajlovi mogli da se dodaju postojećim podacima). */
export function projectToStaging(p) {
  const st = emptyStaging();
  for (const s of p.soils || []) st.soils.set(s.code, { ...s });
  st.topo = (p.terrain?.points || []).slice();
  st._topoIsDerived = !!p.terrain?.derived;
  if (st._topoIsDerived) st.topo = (p.terrain.source || []).slice();
  for (const b of p.boreholes || []) {
    st.locs.set(b.id, { id: b.id, type: 'B', E: b.E, N: b.N, Z: b.Z, depth: b.depth, gwl: b.gwl, meta: b });
    st.layers.set(b.id, b.layers.map((l) => ({ ...l })));
  }
  for (const c of p.cpts || []) {
    st.locs.set(c.id, { id: c.id, type: 'CPT', E: c.E, N: c.N, Z: c.Z, gwl: c.gwl, meta: c });
    st.cpt.set(c.id, c.data);
  }
  for (const d of p.dpsh || []) {
    st.locs.set(d.id, { id: d.id, type: 'DPSH', E: d.E, N: d.N, Z: d.Z, gwl: d.gwl, meta: d });
    st.dpsh.set(d.id, { nType: d.nType || 'N20', data: d.data });
  }
  st.name = p.name; st.crs = p.crs; st.heightRef = p.heightRef; st.sections = p.sections || [];
  return st;
}

/** Staging → projekat. Vraća {project, warnings}. */
export function stagingToProject(st) {
  const warnings = [];
  const p = emptyProject();
  if (st.name) p.name = st.name;
  if (st.crs) p.crs = st.crs;
  if (st.heightRef) p.heightRef = st.heightRef;
  p.sections = st.sections || [];

  // tip po raspoloživim podacima
  for (const id of st.cpt.keys()) if (st.locs.has(id)) st.locs.get(id).type = 'CPT';
  for (const id of st.dpsh.keys()) if (st.locs.has(id)) st.locs.get(id).type = 'DPSH';
  for (const id of st.layers.keys()) if (st.locs.has(id)) st.locs.get(id).type = 'B';
  for (const m of [st.layers, st.cpt, st.dpsh]) for (const id of m.keys()) if (!st.locs.has(id)) warnings.push(`! ${id}: nema koordinata u tabeli tačaka — ne prikazuje se`);

  // --- teren ---
  const collars = [...st.locs.values()].filter((l) => isFinite(l.Z)).map((l) => [l.E, l.N, l.Z]);
  let topo = st.topo.slice();
  if (topo.length < 200) {
    // retka topografija: dopuni kotama ušća i progusti IDW mrežom
    const src = [...topo, ...collars];
    if (src.length >= 3) {
      let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
      for (const q of src) { e0 = Math.min(e0, q[0]); e1 = Math.max(e1, q[0]); n0 = Math.min(n0, q[1]); n1 = Math.max(n1, q[1]); }
      const pad = Math.max(10, 0.12 * Math.max(e1 - e0, n1 - n0));
      e0 -= pad; e1 += pad; n0 -= pad; n1 += pad;
      // ravan trenda (najmanji kvadrati) + IDW odstupanja → bez "meta" oko tačaka na nagnutom terenu
      const zAt = trendIdw(src, 2);
      const N = 90, pts = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const e = e0 + ((e1 - e0) * i) / N, n = n0 + ((n1 - n0) * j) / N;
        pts.push([e, n, zAt(e, n)]);
      }
      p.terrain = { points: pts, derived: true, source: topo };
      warnings.push(`i Teren interpoliran (trend + IDW) iz ${src.length} tačaka — za tačan model učitaj topografiju (Y;X;Z).`);
    }
  } else p.terrain = { points: topo };

  // --- legenda sredina ---
  const mids = new Map();
  for (const layers of st.layers.values()) for (const l of layers) {
    if (!mids.has(l.code)) mids.set(l.code, []);
    mids.get(l.code).push((l.top + l.bottom) / 2);
  }
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const codes = new Set([...st.soils.keys(), ...mids.keys()]);
  const used = new Set([...st.soils.values()].map((s) => s.color).filter(Boolean));
  let pi = 0;
  const nextColor = () => { while (used.has(PALETTE[pi % PALETTE.length]) && pi < PALETTE.length * 2) pi++; const c = PALETTE[pi++ % PALETTE.length]; used.add(c); return c; };
  const soils = [...codes].map((code) => {
    const s = st.soils.get(code) || {};
    const d = st.descr.get(code);
    return {
      code,
      name: s.name && s.name !== code ? s.name : d ? `${code} — ${d.split(/[,;]/)[0]}` : code,
      color: s.color || nextColor(),
      order: isFinite(s.order) ? s.order : NaN,
      pattern: s.pattern,
      _med: mids.has(code) ? median(mids.get(code)) : 999,
    };
  });
  // jedinice bez redosleda: po medijani dubine pojavljivanja
  soils.sort((a, b) => (isFinite(a.order) && isFinite(b.order) ? a.order - b.order : a._med - b._med));
  soils.forEach((s, i) => { if (!isFinite(s.order)) s.order = i + 1; delete s._med; if (!s.pattern) s.pattern = guessPattern(s.code, st.descr.get(s.code) || s.name); });
  soils.sort((a, b) => a.order - b.order);
  p.soils = soils;

  const keepMeta = (l) => {
    const m = { ...(l.meta || {}) };
    delete m.layers; delete m.data;
    return m;
  };
  for (const l of st.locs.values()) {
    const base = { ...keepMeta(l), id: l.id, E: l.E, N: l.N, Z: isFinite(l.Z) ? l.Z : null, gwl: isFinite(l.gwl) ? l.gwl : null };
    if (st.layers.has(l.id)) {
      const layers = st.layers.get(l.id).sort((a, b) => a.top - b.top);
      p.boreholes.push({ ...base, depth: isFinite(l.depth) ? l.depth : Math.max(...layers.map((q) => q.bottom)), layers });
    } else if (st.cpt.has(l.id)) {
      p.cpts.push({ ...base, data: st.cpt.get(l.id) });
    } else if (st.dpsh.has(l.id)) {
      const d = st.dpsh.get(l.id);
      p.dpsh.push({ ...base, nType: d.nType, data: d.data });
    } else {
      // tačka bez podataka — prikaži kao bušotinu bez slojeva
      p.boreholes.push({ ...base, depth: isFinite(l.depth) ? l.depth : 0, layers: [] });
    }
  }
  return { project: p, warnings };
}

/** Šrafura iz opisa: odlučuje PRVA imenica vrste tla u opisu ("glina prašinasta" → glina), pa tek onda USCS kod. */
export function guessPattern(code, name = '') {
  const t = String(name).toLowerCase();
  const words = [
    ['fill', /nasip/], ['humus', /humus|treset|organ/], ['clay', /glin|clay/], ['silt', /prah|praš|pras|silt/],
    ['sand', /pesak|pijesak|peska|sand/], ['gravel', /šljun|sljun|gravel/], ['marl', /lapor|stena|krečnj|krecnj|peščar|marl|rock/],
  ];
  let best = null, bi = Infinity;
  for (const [p, re] of words) {
    const m = t.match(re);
    if (m && m.index < bi) { bi = m.index; best = p; }
  }
  if (best) return best;
  const c = String(code).toUpperCase();
  if (/^(HU|OL|OH|PT)$/.test(c)) return 'humus';
  if (/^G[WPMC]/.test(c)) return 'gravel';
  if (/^S[WPMC]/.test(c)) return 'sand';
  if (/^M[LH]/.test(c)) return 'silt';
  if (/^C[LHI]/.test(c)) return 'clay';
  return 'none';
}

// ---------------- izvoz ----------------
const fmt = (v, d) => (v == null || !isFinite(v) ? '' : v.toFixed(d).replace('.', ','));

export function exportCSVs(p) {
  const out = {};
  out['tacke.csv'] = 'ID;tip;Y;X;Z;dubina;NPV\n' + [
    ...p.boreholes.map((b) => ['B', b]), ...p.cpts.map((c) => ['CPT', c]), ...p.dpsh.map((d) => ['DPSH', d]),
  ].map(([t, o]) => {
    const dep = t === 'B' ? o.depth : o.data?.length ? o.data[o.data.length - 1].z : null;
    return [o.id, t, fmt(o.E, 3), fmt(o.N, 3), fmt(o.Z, 2), fmt(dep, 2), fmt(o.gwl, 2)].join(';');
  }).join('\n') + '\n';
  out['slojevi.csv'] = 'ID;od;do;sredina;opis\n' + p.boreholes.flatMap((b) => b.layers.map((l) => [b.id, fmt(l.top, 2), fmt(l.bottom, 2), l.code, l.description || ''].join(';'))).join('\n') + '\n';
  out['cpt.csv'] = 'ID;dubina;qc;fs;u2\n' + p.cpts.flatMap((c) => c.data.map((d) => [c.id, fmt(d.z, 2), fmt(d.qc, 3), fmt(d.fs, 1), fmt(d.u2, 1)].join(';'))).join('\n') + '\n';
  const nt = p.dpsh[0]?.nType || 'N20';
  out['dpsh.csv'] = `ID;dubina;${nt}\n` + p.dpsh.flatMap((d) => d.data.map((q) => [d.id, fmt(q.z, 2), fmt(d.nType === nt ? q.n : nt === 'N20' ? q.n * 2 : q.n / 2, 0)].join(';'))).join('\n') + '\n';
  out['legenda.csv'] = 'sredina;naziv;boja;redosled\n' + p.soils.map((s) => [s.code, s.name, s.color, s.order].join(';')).join('\n') + '\n';
  if (!p.terrain.derived) out['teren.csv'] = 'Y;X;Z\n' + p.terrain.points.map((q) => [fmt(q[0], 3), fmt(q[1], 3), fmt(q[2], 3)].join(';')).join('\n') + '\n';
  return out;
}

export function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
