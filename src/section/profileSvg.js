import { SBT_ZONES, sbtIntervals } from '../core/cpt.js';
import { dpshIntervals, dpshClass, DPSH_CLASSES } from '../core/dpsh.js';
import { niceStep } from '../scene/terrainMesh.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

// šrafure po vrsti tla (geotehnička konvencija, pojednostavljeno)
export function patternDefs(soils, prefix = 'p') {
  return soils.map((s) => {
    const id = `${prefix}-${cssId(s.code)}`;
    const c = 'rgba(30,25,20,0.45)';
    let inner = '';
    switch (s.pattern) {
      case 'clay': inner = `<path d="M0 4h10M5 9h10" stroke="${c}" stroke-width="0.8"/>`; break;
      case 'silt': inner = `<path d="M0 4h4M6 4h4M3 9h4" stroke="${c}" stroke-width="0.8"/><circle cx="8" cy="8.5" r="0.6" fill="${c}"/>`; break;
      case 'sand': inner = `<circle cx="2" cy="2" r="0.7" fill="${c}"/><circle cx="7" cy="5" r="0.7" fill="${c}"/><circle cx="3" cy="8" r="0.7" fill="${c}"/>`; break;
      case 'gravel': inner = `<circle cx="3" cy="3" r="1.8" fill="none" stroke="${c}" stroke-width="0.7"/><circle cx="8" cy="7.5" r="1.4" fill="none" stroke="${c}" stroke-width="0.7"/>`; break;
      case 'marl': inner = `<path d="M0 3h10M0 8h10M3 3v5M8 8v2M8 0v3" stroke="${c}" stroke-width="0.7"/>`; break;
      case 'humus': inner = `<path d="M1 8l2-3 2 3M6 4l2-3 2 3" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.7"/>`; break;
      case 'fill': inner = `<path d="M0 10L10 0" stroke="${c}" stroke-width="0.7"/><circle cx="7" cy="7" r="1" fill="none" stroke="${c}" stroke-width="0.6"/>`; break;
      default: inner = '';
    }
    return `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${s.color}"/>${inner}</pattern>`;
  }).join('');
}
export const cssId = (code) => String(code).replace(/[^a-zA-Z0-9_-]/g, (ch) => '_' + ch.charCodeAt(0));

/**
 * Crta presek kao SVG.
 * @param sec rezultat computeSection
 * @param opts {width, height, ve:'auto'|number, cptScale (px/MPa), dpshScale (px/udarac), showGeo, title, labels:[A, A']}
 */
export function renderProfileSVG(sec, project, opts = {}) {
  const W = Math.max(480, opts.width || 1000);
  const availH = Math.max(220, opts.height || 380);
  const M = { l: 86, r: 34, t: 74, b: 78 };
  const plotW = W - M.l - M.r;
  const sx = plotW / sec.L;
  let zTop = sec.zmax + Math.max(1, (sec.zmax - sec.zmin) * 0.06);
  let zBot = sec.zmin - 0.5;
  let ve;
  if (opts.ve === 'auto' || !opts.ve) {
    // uklopi u visinu panela, ali ne niže od ~240 px crteža (inače se skroluje)
    const targetH = Math.max(availH - M.t - M.b - 64, 240);
    const ideal = targetH / ((zTop - zBot) * sx);
    const nice = [1, 2, 2.5, 5, 10, 20, 25, 50, 100];
    ve = nice.filter((v) => v <= ideal).pop() || ideal;
  } else ve = +opts.ve;
  const sy = sx * ve;
  const plotH = (zTop - zBot) * sy;
  // legenda: jedinice koje se pojavljuju u preseku
  const usedUnits = new Set(sec.units.map((u) => u.code));
  sec.probes.filter((p) => p.kind === 'bh').forEach((p) => p.item.layers.forEach((l) => usedUnits.add(l.code)));
  const legendItems = project.soils.filter((s) => usedUnits.has(s.code));
  const colW = 270;
  const nCol = Math.max(1, Math.floor((W - M.l - M.r) / colW));
  const legendRows = Math.ceil(legendItems.length / nCol);
  const legendH = 34 + legendRows * 17 + 18;
  const H = M.t + plotH + M.b + legendH;
  const X = (s) => M.l + s * sx;
  const Y = (z) => M.t + (zTop - z) * sy;
  const soilMap = new Map(project.soils.map((s) => [s.code, s]));
  const pid = 'p' + Math.random().toString(36).slice(2, 7);
  const patUrl = (code) => (soilMap.has(code) ? `url(#${pid}-${cssId(code)})` : '#bbb');

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(1)}" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="11" class="profile-svg">`);
  out.push(`<defs>${patternDefs(project.soils, pid)}<clipPath id="${pid}-clip"><rect x="${M.l}" y="${M.t - 40}" width="${plotW + 30}" height="${plotH + 40}"/></clipPath></defs>`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // naslov
  const [la, lb] = opts.labels || ['A', "A'"];
  out.push(`<text x="${M.l}" y="20" font-size="14" font-weight="650" fill="#1d2228">${esc(opts.title || 'Geotehnički presek')} ${esc(la)}–${esc(lb)}</text>`);
  out.push(`<text x="${W - M.r}" y="20" text-anchor="end" fill="#5c636b">dužina ${f(sec.L, 1)} m · vertikalno uveličanje ${f(ve, ve < 10 ? 1 : 0)}× · koridor ±${f(opts.buffer ?? 0, 0)} m</text>`);

  // mreža
  const zs = niceStep((zTop - zBot) / 8);
  out.push(`<g stroke="#e3e6ea" stroke-width="1">`);
  for (let z = Math.ceil(zBot / zs) * zs; z <= zTop; z += zs) out.push(`<line x1="${M.l}" x2="${M.l + plotW}" y1="${Y(z).toFixed(1)}" y2="${Y(z).toFixed(1)}"/>`);
  const xs = niceStep(sec.L / 10);
  for (let s = 0; s <= sec.L + 1e-6; s += xs) out.push(`<line x1="${X(s).toFixed(1)}" x2="${X(s).toFixed(1)}" y1="${M.t}" y2="${M.t + plotH}"/>`);
  out.push(`</g>`);

  out.push(`<g clip-path="url(#${pid}-clip)">`);
  // geologija (interpretacija)
  const S = sec.samples.filter((s) => s.stack);
  if (opts.showGeo !== false && S.length > 1) {
    for (let k = 0; k < sec.K; k++) {
      let d = '';
      S.forEach((p, i) => { d += `${i ? 'L' : 'M'}${X(p.s).toFixed(1)} ${Y(p.stack[k]).toFixed(1)}`; });
      for (let i = S.length - 1; i >= 0; i--) d += `L${X(S[i].s).toFixed(1)} ${Y(Math.max(S[i].stack[k + 1], zBot)).toFixed(1)}`;
      out.push(`<path d="${d}Z" fill="${patUrl(sec.units[k].code)}" fill-opacity="0.82" stroke="none" data-unit="${k}"/>`);
    }
    // granice (isprekidano = interpretirano)
    for (let k = 1; k < sec.K; k++) {
      let d = '';
      S.forEach((p, i) => { d += `${i ? 'L' : 'M'}${X(p.s).toFixed(1)} ${Y(p.stack[k]).toFixed(1)}`; });
      out.push(`<path d="${d}" fill="none" stroke="#3b3128" stroke-width="0.9" stroke-dasharray="5 3" opacity="0.75"/>`);
    }
  }
  // NPV
  if (sec.hasGwl) {
    let d = '';
    sec.samples.filter((p) => isFinite(p.gwl)).forEach((p, i) => { d += `${i ? 'L' : 'M'}${X(p.s).toFixed(1)} ${Y(p.gwl).toFixed(1)}`; });
    out.push(`<path d="${d}" fill="none" stroke="#1f6fd1" stroke-width="1.4" stroke-dasharray="8 4"/>`);
    const p = sec.samples[Math.floor(sec.samples.length * 0.08)];
    if (p && isFinite(p.gwl)) out.push(npvSymbol(X(p.s), Y(p.gwl)));
  }
  // teren
  {
    let d = '';
    sec.samples.filter((p) => isFinite(p.zt)).forEach((p, i) => { d += `${i ? 'L' : 'M'}${X(p.s).toFixed(1)} ${Y(p.zt).toFixed(1)}`; });
    out.push(`<path d="${d}" fill="none" stroke="#1d2228" stroke-width="2"/>`);
  }
  out.push(`</g>`);

  // prelomi poligona
  sec.chainages.forEach((c, i) => {
    if (i === 0 || i === sec.chainages.length - 1) return;
    out.push(`<line x1="${X(c)}" x2="${X(c)}" y1="${M.t}" y2="${M.t + plotH}" stroke="#8a929b" stroke-dasharray="2 3"/><text x="${X(c) + 3}" y="${M.t + 12}" fill="#5c636b" font-size="10">T${i}</text>`);
  });

  // istražni radovi
  const cptS = opts.cptScale ?? 4; // px po MPa
  const dpS = opts.dpshScale ?? 1; // px po udarcu (N20 ekv.)
  const placed = [];
  const gfx = [], labs = [];
  for (const p of sec.probes) {
    const it = p.item, z0 = it._z0 ?? it.Z, x = X(p.s);
    const op = Math.abs(p.offset) < 0.5 ? 1 : 0.9;
    gfx.push(`<g class="probe" data-id="${esc(it.id)}" opacity="${op}">`);
    if (p.kind === 'bh') {
      const w = 12;
      for (const l of it.layers) gfx.push(`<rect x="${x - w / 2}" y="${Y(z0 - l.top).toFixed(1)}" width="${w}" height="${Math.max(0.5, (l.bottom - l.top) * sy).toFixed(1)}" fill="${patUrl(l.code)}"><title>${esc(it.id)}: ${f(l.top, 1)}–${f(l.bottom, 1)} m ${esc(l.code)} ${esc(l.description || '')}</title></rect>`);
      gfx.push(`<rect x="${x - w / 2}" y="${Y(z0)}" width="${w}" height="${(it.depth * sy).toFixed(1)}" fill="none" stroke="#1d2228" stroke-width="1"/>`);
      gfx.push(`<text x="${x + w / 2 + 3}" y="${(Y(z0 - it.depth) + 3).toFixed(1)}" font-size="9.5" fill="#1d2228">${f(it.depth, 1)}</text>`);
    } else if (p.kind === 'cpt' && it._proc?.length) {
      const pr = it._proc, zEnd = pr[pr.length - 1].z;
      for (const iv of sbtIntervals(pr)) gfx.push(`<rect x="${x - 4}" y="${Y(z0 - iv.top).toFixed(1)}" width="4" height="${Math.max(0.4, (iv.bottom - iv.top) * sy).toFixed(1)}" fill="${SBT_ZONES[iv.zone]?.color || '#999'}"/>`);
      gfx.push(`<line x1="${x}" x2="${x}" y1="${Y(z0)}" y2="${Y(z0 - zEnd)}" stroke="#1d2228" stroke-width="1"/>`);
      const step = Math.max(1, Math.floor(pr.length / 600));
      let d = '';
      for (let i = 0; i < pr.length; i += step) d += `${i ? 'L' : 'M'}${(x + Math.min(pr[i].qt, 40) * cptS).toFixed(1)} ${Y(z0 - pr[i].z).toFixed(1)}`;
      gfx.push(`<path d="${d}" fill="none" stroke="#c0392b" stroke-width="1.1"/>`);
      // razmera qc
      const tick = cptS * 10;
      gfx.push(`<g font-size="8.5" fill="#c0392b"><line x1="${x}" x2="${x + tick * 2}" y1="${Y(z0) - 6}" y2="${Y(z0) - 6}" stroke="#c0392b"/>${[0, 1, 2].map((k) => `<line x1="${x + k * tick}" x2="${x + k * tick}" y1="${Y(z0) - 9}" y2="${Y(z0) - 3}" stroke="#c0392b"/>`).join('')}<text x="${x + tick * 2 + 3}" y="${Y(z0) - 4}">20 MPa</text></g>`);
    } else if (p.kind === 'dpsh') {
      const iv = dpshIntervals(it);
      for (const s of iv) gfx.push(`<rect x="${x}" y="${Y(z0 - s.top).toFixed(1)}" width="${Math.max(0.6, Math.min(s.n20, 60) * dpS).toFixed(1)}" height="${Math.max(0.4, (s.bottom - s.top) * sy).toFixed(1)}" fill="${dpshClass(s.n20).color}" stroke="#ffffff" stroke-width="0.3"><title>${esc(it.id)} ${f(s.top, 1)}–${f(s.bottom, 1)} m: ${it.nType || 'N20'} = ${s.n}</title></rect>`);
      const zEnd = iv[iv.length - 1]?.bottom || 0;
      gfx.push(`<line x1="${x}" x2="${x}" y1="${Y(z0)}" y2="${Y(z0 - zEnd)}" stroke="#3b2f5c" stroke-width="1.2"/>`);
      const tick = dpS * 20;
      gfx.push(`<g font-size="8.5" fill="#3b2f5c"><line x1="${x}" x2="${x + tick * 2}" y1="${Y(z0) - 6}" y2="${Y(z0) - 6}" stroke="#3b2f5c"/>${[0, 1, 2].map((k) => `<line x1="${x + k * tick}" x2="${x + k * tick}" y1="${Y(z0) - 9}" y2="${Y(z0) - 3}" stroke="#3b2f5c"/>`).join('')}<text x="${x + tick * 2 + 3}" y="${Y(z0) - 4}">N20=40</text></g>`);
    }
    // oznaka (izbegava preklapanje)
    let ly = M.t - 34;
    while (placed.some((q) => Math.abs(q.x - x) < 54 && q.y === ly)) ly += 13;
    placed.push({ x, y: ly });
    const off = Math.abs(p.offset) >= 0.5 ? ` ${p.offset > 0 ? 'L' : 'D'} ${f(Math.abs(p.offset), 1)} m` : '';
    const sym = p.kind === 'bh' ? '●' : p.kind === 'cpt' ? '▼' : '◆';
    labs.push(`<g class="probe" data-id="${esc(it.id)}" style="cursor:pointer"><text x="${x}" y="${ly}" text-anchor="middle" font-weight="600" fill="#1d2228">${sym} ${esc(it.id)}<tspan font-weight="400" fill="#6b737c" font-size="9.5">${off}</tspan></text></g>`);
    labs.push(`<line x1="${x}" x2="${x}" y1="${ly + 3}" y2="${Y(z0) - 10}" stroke="#9aa3ad" stroke-width="0.6"/>`);
    gfx.push(`</g>`);
  }
  out.push(`<clipPath id="${pid}-clipP"><rect x="${M.l}" y="${M.t - 16}" width="${plotW}" height="${plotH + 16}"/></clipPath>`);
  out.push(`<g clip-path="url(#${pid}-clipP)">${gfx.join('')}</g>`, ...labs);

  // ram i ose
  out.push(`<rect x="${M.l}" y="${M.t}" width="${plotW}" height="${plotH.toFixed(1)}" fill="none" stroke="#6b737c"/>`);
  out.push(`<g fill="#3d444b" font-size="10">`);
  for (let z = Math.ceil(zBot / zs) * zs; z <= zTop; z += zs) out.push(`<text x="${M.l - 6}" y="${(Y(z) + 3.5).toFixed(1)}" text-anchor="end">${f(z, zs < 1 ? 1 : 0)}</text>`);
  out.push(`<text transform="translate(16 ${M.t + plotH / 2}) rotate(-90)" text-anchor="middle" fill="#5c636b">kota [${esc(project.heightRef || 'mnv')}]</text>`);
  out.push(`</g>`);
  // donja tabela: stacionaža i kota terena
  const tY = M.t + plotH;
  out.push(`<g font-size="9.5" fill="#3d444b">`);
  out.push(`<line x1="${M.l}" x2="${M.l + plotW}" y1="${tY + 22}" y2="${tY + 22}" stroke="#c9ced4"/><line x1="${M.l}" x2="${M.l + plotW}" y1="${tY + 46}" y2="${tY + 46}" stroke="#c9ced4"/>`);
  out.push(`<text x="6" y="${tY + 15}" fill="#5c636b">stac. [m]</text><text x="6" y="${tY + 38}" fill="#5c636b">kota terena</text>`);
  for (let s = 0; s <= sec.L + 1e-6; s += xs) out.push(`<text x="${X(s).toFixed(1)}" y="${tY + 15}" text-anchor="middle">${f(s, xs < 1 ? 1 : 0)}</text>`);
  const zAt = (s) => interpTerrain(sec, s);
  const marks = [0, ...sec.chainages.slice(1, -1), sec.L, ...sec.probes.map((p) => p.s)].sort((a, b) => a - b);
  let lastX = -1e9;
  for (const s of marks) {
    const x = X(s);
    if (x - lastX < 30) continue;
    lastX = x;
    out.push(`<text x="${x.toFixed(1)}" y="${tY + 38}" text-anchor="middle" font-size="8.5">${f(zAt(s), 2)}</text>`);
  }
  out.push(`</g>`);
  // oznake krajeva preseka
  out.push(`<g font-size="16" font-weight="700" fill="#d9302b"><text x="${M.l}" y="${M.t - 5}" text-anchor="middle">${esc(la)}</text><text x="${M.l + plotW}" y="${M.t - 5}" text-anchor="middle">${esc(lb)}</text></g>`);

  // razmerna traka
  const bar = niceStep(sec.L / 6);
  const bx = M.l, by = tY + 60;
  out.push(`<g font-size="9" fill="#3d444b"><rect x="${bx}" y="${by}" width="${bar * sx / 2}" height="4" fill="#1d2228"/><rect x="${bx + (bar * sx) / 2}" y="${by}" width="${bar * sx / 2}" height="4" fill="#fff" stroke="#1d2228" stroke-width="0.6"/><text x="${bx}" y="${by + 14}">0</text><text x="${bx + bar * sx}" y="${by + 14}" text-anchor="middle">${f(bar, 0)} m</text></g>`);

  // legenda (u kolonama)
  const ly0 = M.t + plotH + M.b + 22;
  out.push(`<g font-size="10" fill="#3d444b">`);
  legendItems.forEach((s, i) => {
    const cx = M.l + (i % nCol) * colW, cy = ly0 + Math.floor(i / nCol) * 17;
    const label = `${s.code} — ${s.name.replace(/^\S+\s+—\s+/, '')}`;
    out.push(`<rect x="${cx}" y="${cy - 9}" width="18" height="12" fill="${patUrl(s.code)}" stroke="#6b737c" stroke-width="0.5"/><text x="${cx + 24}" y="${cy + 1}">${esc(label.length > 46 ? label.slice(0, 45) + '…' : label)}</text>`);
  });
  out.push(`</g>`);
  out.push(`<text x="${M.l}" y="${H - 18}" font-size="9" fill="#8a929b">Granice između istražnih radova su interpretacija (IDW debljina, isprekidano). CPT: crveno q<tspan baseline-shift="sub" font-size="7">t</tspan>, traka = SBTn zona (Robertson 2009).</text>`);
  out.push(`<text x="${M.l}" y="${H - 6}" font-size="9" fill="#8a929b">DPSH-B: širina stubića ~ N20 ekv. (N10 × 2), boja = klasa zbijenosti. Oznaka L/D = upravno rastojanje levo/desno od linije preseka.</text>`);
  out.push(`</svg>`);
  return { svg: out.join(''), layout: { M, plotW, plotH, sx, sy, zTop, zBot, ve, W, H } };
}

export function interpTerrain(sec, s) {
  const S = sec.samples;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; }
  const a = S[lo], b = S[hi];
  const t = b.s - a.s > 0 ? (s - a.s) / (b.s - a.s) : 0;
  return a.zt + (b.zt - a.zt) * t;
}

export function interpStack(sec, s) {
  const S = sec.samples;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; }
  const a = S[lo], b = S[hi];
  if (!a.stack || !b.stack) return null;
  const t = b.s - a.s > 0 ? (s - a.s) / (b.s - a.s) : 0;
  return Array.from(a.stack, (v, i) => v + (b.stack[i] - v) * t);
}

function npvSymbol(x, y) {
  return `<g fill="none" stroke="#1f6fd1" stroke-width="1.2"><path d="M${x - 6} ${y - 10}h12l-6 9z" fill="#ffffff"/><line x1="${x - 5}" x2="${x + 5}" y1="${y + 3}" y2="${y + 3}"/><line x1="${x - 3}" x2="${x + 3}" y1="${y + 6}" y2="${y + 6}"/></g><text x="${x + 9}" y="${y - 3}" font-size="9.5" fill="#1f6fd1">NPV</text>`;
}

export { DPSH_CLASSES };
