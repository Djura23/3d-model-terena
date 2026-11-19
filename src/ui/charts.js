import { SBT_ZONES, sbtIntervals } from '../core/cpt.js';
import { dpshIntervals, dpshClass } from '../core/dpsh.js';
import { niceStep } from '../scene/terrainMesh.js';
import { patternDefs, cssId } from '../section/profileSvg.js';

const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Zajednički okvir: dubinska osa levo, više kolona sa sopstvenim x-osama. */
function depthFrame(maxDepth, H, top = 34, bottom = 10) {
  const ph = H - top - bottom;
  const Y = (d) => top + (d / maxDepth) * ph;
  const st = niceStep(maxDepth / 10);
  return { Y, ph, st, top };
}

export function cptChart(c, { width = 340, height = 520, marker } = {}) {
  const pr = c._proc || [];
  if (!pr.length) return '<p class="muted">Nema podataka.</p>';
  const maxD = Math.ceil(pr[pr.length - 1].z);
  const { Y, st, top } = depthFrame(maxD, height);
  const L = 34;
  const cols = [
    { key: 'qt', name: 'q<tspan baseline-shift="sub" font-size="8">t</tspan> [MPa]', w: 0.34, color: '#c0392b', max: niceCeil(Math.max(...pr.map((p) => p.qt))) },
    { key: 'fs', name: 'f<tspan baseline-shift="sub" font-size="8">s</tspan> [kPa]', w: 0.22, color: '#2c7a4b', max: niceCeil(Math.max(...pr.map((p) => p.fs))) },
    { key: 'u2', name: 'u<tspan baseline-shift="sub" font-size="8">2</tspan> [kPa]', w: 0.22, color: '#1f6fd1', max: niceCeil(Math.max(10, ...pr.map((p) => p.u2))), min: Math.min(0, ...pr.map((p) => p.u2)) },
    { key: 'ic', name: 'I<tspan baseline-shift="sub" font-size="8">c</tspan>', w: 0.22, color: '#333', max: 4, min: 1, sbt: true },
  ];
  const avail = width - L - 6;
  let x0 = L;
  const out = [`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="chart" font-size="9.5">`];
  // dubinska mreža
  for (let d = 0; d <= maxD + 1e-6; d += st) {
    out.push(`<line x1="${L}" x2="${width - 6}" y1="${Y(d)}" y2="${Y(d)}" stroke="var(--grid)"/>`);
    out.push(`<text x="${L - 4}" y="${Y(d) + 3}" text-anchor="end" fill="var(--muted)">${f(d, st < 1 ? 1 : 0)}</text>`);
  }
  out.push(`<text transform="translate(9 ${top + 60}) rotate(-90)" fill="var(--muted)" text-anchor="middle">dubina [m]</text>`);
  for (const col of cols) {
    const w = avail * col.w - 6;
    const min = col.min ?? 0;
    const X = (v) => x0 + ((Math.min(Math.max(v, min), col.max) - min) / (col.max - min)) * w;
    out.push(`<rect x="${x0}" y="${top}" width="${w}" height="${height - top - 10}" fill="none" stroke="var(--line)"/>`);
    out.push(`<text x="${x0 + w / 2}" y="12" text-anchor="middle" font-weight="600" fill="var(--text)">${col.name}</text>`);
    out.push(`<text x="${x0}" y="${top - 6}" fill="var(--muted)" font-size="8.5">${f(min, 0)}</text><text x="${x0 + w}" y="${top - 6}" text-anchor="end" fill="var(--muted)" font-size="8.5">${f(col.max, 0)}</text>`);
    if (col.sbt) {
      // SBTn trake + granice zona Ic
      for (const iv of sbtIntervals(pr, 0)) out.push(`<rect x="${x0}" y="${Y(iv.top)}" width="${w}" height="${Math.max(0.5, Y(iv.bottom) - Y(iv.top))}" fill="${SBT_ZONES[iv.zone]?.color}" opacity="0.35"/>`);
      for (const b of [1.31, 2.05, 2.6, 2.95, 3.6]) out.push(`<line x1="${X(b)}" x2="${X(b)}" y1="${top}" y2="${height - 10}" stroke="var(--line)" stroke-dasharray="2 2"/>`);
    }
    let d = '';
    const step = Math.max(1, Math.floor(pr.length / 700));
    for (let i = 0; i < pr.length; i += step) d += `${i ? 'L' : 'M'}${X(pr[i][col.key]).toFixed(1)} ${Y(pr[i].z).toFixed(1)}`;
    out.push(`<path d="${d}" fill="none" stroke="${col.color}" stroke-width="1"/>`);
    if (col.key === 'u2') {
      // hidrostatički pritisak u0
      let d0 = '';
      for (let i = 0; i < pr.length; i += step) d0 += `${i ? 'L' : 'M'}${X(pr[i].u0).toFixed(1)} ${Y(pr[i].z).toFixed(1)}`;
      out.push(`<path d="${d0}" fill="none" stroke="#1f6fd1" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.7"/>`);
    }
    x0 += avail * col.w;
  }
  if (marker != null) out.push(`<line x1="${L}" x2="${width - 6}" y1="${Y(marker)}" y2="${Y(marker)}" stroke="#ff3b30" stroke-width="1.2"/>`);
  out.push('</svg>');
  return out.join('');
}

export function dpshChart(d, { width = 300, height = 460, marker } = {}) {
  const iv = dpshIntervals(d);
  if (!iv.length) return '<p class="muted">Nema podataka.</p>';
  const maxD = Math.ceil(iv[iv.length - 1].bottom);
  const { Y, st, top } = depthFrame(maxD, height);
  const L = 34, w = width - L - 10;
  const maxN = Math.max(20, niceCeil(Math.max(...iv.map((s) => s.n))));
  const X = (n) => L + (Math.min(n, maxN) / maxN) * w;
  const nt = d.nType || 'N20';
  const out = [`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="chart" font-size="9.5">`];
  for (let z = 0; z <= maxD + 1e-6; z += st) {
    out.push(`<line x1="${L}" x2="${L + w}" y1="${Y(z)}" y2="${Y(z)}" stroke="var(--grid)"/>`);
    out.push(`<text x="${L - 4}" y="${Y(z) + 3}" text-anchor="end" fill="var(--muted)">${f(z, st < 1 ? 1 : 0)}</text>`);
  }
  const nst = niceStep(maxN / 5);
  for (let n = 0; n <= maxN; n += nst) out.push(`<line x1="${X(n)}" x2="${X(n)}" y1="${top}" y2="${height - 10}" stroke="var(--grid)"/><text x="${X(n)}" y="${top - 6}" text-anchor="middle" fill="var(--muted)" font-size="8.5">${n}</text>`);
  out.push(`<text x="${L + w / 2}" y="12" text-anchor="middle" font-weight="600" fill="var(--text)">${nt} [udaraca / ${nt === 'N10' ? '10' : '20'} cm]</text>`);
  for (const s of iv) out.push(`<rect x="${L}" y="${Y(s.top)}" width="${Math.max(0.5, X(s.n) - L)}" height="${Math.max(0.5, Y(s.bottom) - Y(s.top))}" fill="${dpshClass(s.n20).color}" stroke="var(--bg-panel)" stroke-width="0.4"><title>${f(s.top, 1)}–${f(s.bottom, 1)} m: ${s.n}</title></rect>`);
  out.push(`<rect x="${L}" y="${top}" width="${w}" height="${height - top - 10}" fill="none" stroke="var(--line)"/>`);
  if (marker != null) out.push(`<line x1="${L}" x2="${L + w}" y1="${Y(marker)}" y2="${Y(marker)}" stroke="#ff3b30" stroke-width="1.2"/>`);
  out.push('</svg>');
  return out.join('');
}

export function boreholeLog(bh, project, { width = 340, marker } = {}) {
  const depth = bh.depth || Math.max(0, ...bh.layers.map((l) => l.bottom));
  const height = Math.max(260, Math.min(620, depth * 26 + 50));
  const { Y, st, top } = depthFrame(depth, height, 20);
  const soil = new Map(project.soils.map((s) => [s.code, s]));
  const pid = 'lg' + Math.random().toString(36).slice(2, 6);
  const L = 34, cw = 36;
  const out = [`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="chart" font-size="9.5"><defs>${patternDefs(project.soils, pid)}</defs>`];
  for (let z = 0; z <= depth + 1e-6; z += st) out.push(`<text x="${L - 4}" y="${Y(z) + 3}" text-anchor="end" fill="var(--muted)">${f(z, st < 1 ? 1 : 0)}</text><line x1="${L - 2}" x2="${L}" y1="${Y(z)}" y2="${Y(z)}" stroke="var(--muted)"/>`);
  let lastY = -100;
  for (const l of bh.layers) {
    const s = soil.get(l.code);
    out.push(`<rect x="${L}" y="${Y(l.top)}" width="${cw}" height="${Math.max(0.5, Y(l.bottom) - Y(l.top))}" fill="url(#${pid}-${cssId(l.code)})" stroke="#333" stroke-width="0.5"/>`);
    const ym = (Y(l.top) + Y(l.bottom)) / 2;
    const ty = Math.max(ym + 3, lastY + 11);
    lastY = ty;
    out.push(`<text x="${L + cw + 8}" y="${ty}" fill="var(--text)"><tspan font-weight="600">${esc(l.code)}</tspan> <tspan fill="var(--muted)">${f(l.top, 1)}–${f(l.bottom, 1)} m</tspan> ${esc(trunc(l.description || s?.name || '', 34))}</text>`);
  }
  if (bh.gwl != null && isFinite(bh.gwl)) {
    const y = Y(bh.gwl);
    out.push(`<path d="M${L + cw + 2} ${y - 7}h10l-5 7z" fill="#fff" stroke="#1f6fd1"/><line x1="${L - 4}" x2="${L + cw + 2}" y1="${y}" y2="${y}" stroke="#1f6fd1" stroke-dasharray="3 2"/>`);
  }
  if (marker != null) out.push(`<line x1="${L - 6}" x2="${L + cw + 6}" y1="${Y(marker)}" y2="${Y(marker)}" stroke="#ff3b30" stroke-width="1.5"/>`);
  out.push('</svg>');
  return out.join('');
}

function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function niceCeil(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
