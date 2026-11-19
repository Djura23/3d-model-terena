import { buildGwlModel } from '../core/gwl.js';

/**
 * Proračun geotehničkog preseka duž poligonalne linije (E,N temena).
 * Vraća profil terena, granice interpretiranih jedinica i istražne radove projektovane na presek.
 */
export function computeSection(vertices, { terrain, geology, project, buffer = 15, maxSamples = 900 }) {
  // stacionaže temena
  const V = vertices.map((v) => ({ E: v.E, N: v.N }));
  const ch = [0];
  for (let i = 1; i < V.length; i++) ch.push(ch[i - 1] + Math.hypot(V[i].E - V[i - 1].E, V[i].N - V[i - 1].N));
  const L = ch[ch.length - 1];
  if (L < 0.5) return null;

  const at = (s) => {
    let i = 1;
    while (i < ch.length - 1 && s > ch[i]) i++;
    const seg = ch[i] - ch[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - ch[i - 1]) / seg));
    return { E: V[i - 1].E + (V[i].E - V[i - 1].E) * t, N: V[i - 1].N + (V[i].N - V[i - 1].N) * t };
  };

  const ds = Math.max(L / maxSamples, 0.25);
  const sList = [];
  for (let s = 0; s < L; s += ds) sList.push(s);
  // obavezno uključi temena (prelomi)
  for (const c of ch) sList.push(c);
  const uniq = [...new Set(sList.map((s) => Math.round(s * 1000) / 1000))].sort((a, b) => a - b);

  const K = geology?.valid ? geology.lastUnit + 1 : 0;
  const samples = [];
  for (const s of uniq) {
    const p = at(s);
    const x = p.E - terrain.E0, y = p.N - terrain.N0;
    const zt = terrain.elevationAtLocal(x, y);
    const stack = K && isFinite(zt) ? geology.boundaryStackLocal(x, y, zt) : null;
    samples.push({ s, E: p.E, N: p.N, zt, stack });
  }

  // projekcija istražnih radova
  const probes = [];
  const consider = (kind, item) => {
    let best = null;
    for (let i = 1; i < V.length; i++) {
      const a = V[i - 1], b = V[i];
      const dx = b.E - a.E, dy = b.N - a.N, L2 = dx * dx + dy * dy;
      let t = L2 ? ((item.E - a.E) * dx + (item.N - a.N) * dy) / L2 : 0;
      const tc = Math.min(1, Math.max(0, t));
      const px = a.E + dx * tc, py = a.N + dy * tc;
      const d = Math.hypot(item.E - px, item.N - py);
      // znak: + levo od pravca preseka, − desno
      const side = Math.sign(dx * (item.N - a.N) - dy * (item.E - a.E)) || 1;
      if (!best || d < best.d) best = { d, s: ch[i - 1] + tc * Math.sqrt(L2), side, beyond: t < -1e-6 || t > 1 + 1e-6 };
    }
    if (best && best.d <= buffer) probes.push({ kind, item, s: best.s, offset: best.d * best.side, beyondEnd: best.beyond });
  };
  project.boreholes.forEach((b) => consider('bh', b));
  project.cpts.forEach((c) => consider('cpt', c));
  project.dpsh.forEach((d) => consider('dpsh', d));
  probes.sort((a, b) => a.s - b.s);

  // NPV linija — isti model kao 3D površ (trend + IDW), ograničen kotom terena
  const gwm = buildGwlModel(project);
  if (gwm) for (const smp of samples) smp.gwl = Math.min(gwm.at(smp.E, smp.N), smp.zt);

  let zmax = -Infinity, zmin = Infinity;
  for (const s of samples) if (isFinite(s.zt)) { zmax = Math.max(zmax, s.zt); zmin = Math.min(zmin, s.zt); }
  for (const p of probes) {
    const z0 = p.item._z0 ?? p.item.Z;
    const depth = p.kind === 'bh' ? p.item.depth : Math.max(0, ...p.item.data.map((d) => d.z));
    zmax = Math.max(zmax, z0);
    zmin = Math.min(zmin, z0 - depth);
  }
  if (geology?.valid) zmin = Math.min(zmin, geology.base);
  return { vertices: V, chainages: ch, L, samples, probes, zmin, zmax, K, units: geology?.valid ? geology.units.slice(0, K) : [], hasGwl: !!gwm };
}
