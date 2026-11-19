/**
 * Model nivoa podzemne vode (NPV): kota NPV = kota ušća − dubina NPV iz svih istražnih radova.
 * Interpolacija: ravan trenda (najmanji kvadrati) + IDW odstupanja (p = 2) — prolazi tačno kroz merenja,
 * a između i van njih prati opšti pad nivoa umesto "meta" oko tačaka.
 * Isti model koristi i 3D površ i linija NPV u preseku.
 */

/** z = a + b·x + c·y (najmanji kvadrati); za < 3 tačke ili degenerisan raspored — horizontalna ravan. */
export function fitPlane(P) {
  const n = P.length;
  const mean = P.reduce((s, p) => s + p[2], 0) / Math.max(n, 1);
  if (n < 3) return [mean, 0, 0];
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y, z] of P) { sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z; }
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], B = [sz, sxz, syz];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A);
  // kolinearne tačke (npr. sve na jednoj liniji) → nagib nije određen
  if (Math.abs(D) < 1e-6 * Math.max(1, sxx * syy)) return [mean, 0, 0];
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)))) / D);
}

export function trendIdw(points, power = 2) {
  if (!points.length) return null;
  const ce = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cn = points.reduce((s, p) => s + p[1], 0) / points.length;
  const tr = fitPlane(points.map((p) => [p[0] - ce, p[1] - cn, p[2]]));
  const plane = (e, n) => tr[0] + tr[1] * (e - ce) + tr[2] * (n - cn);
  const res = points.map((p) => [p[0], p[1], p[2] - plane(p[0], p[1])]);
  return (e, n) => {
    let sw = 0, sv = 0;
    for (const p of res) {
      const d2 = (p[0] - e) ** 2 + (p[1] - n) ** 2;
      if (d2 < 1e-6) return plane(e, n) + p[2];
      const w = 1 / Math.pow(d2, power / 2);
      sw += w; sv += w * p[2];
    }
    return plane(e, n) + sv / sw;
  };
}

/** Vraća {at(E,N) → kota NPV ili NaN, points} ili null ako nijedan rad nema NPV. */
export function buildGwlModel(project) {
  const pts = [...project.boreholes, ...project.cpts, ...project.dpsh]
    .filter((t) => t.gwl != null && isFinite(t.gwl) && isFinite(t._z0 ?? t.Z))
    .map((t) => [t.E, t.N, (t._z0 ?? t.Z) - t.gwl, t.id]);
  if (!pts.length) return null;
  const f = trendIdw(pts);
  return { at: f, points: pts };
}
