import Delaunator from 'delaunator';

/**
 * Teren kao TIN (Delaunay triangulacija ulaznih tačaka) + raster za brze upite kote.
 * Sve geometrije u sceni koriste LOKALNI koordinatni sistem (oduzet koordinatni početak E0,N0,Z0),
 * da bi se izbegao gubitak tačnosti float32 na velikim projekcijskim koordinatama (npr. 7 456 100 m).
 */
export class Terrain {
  constructor(points, { maxEdgeFactor = 8 } = {}) {
    if (!points || points.length < 3) throw new Error('Teren mora imati bar 3 tačke (E, N, Z).');
    // ukloni duplikate (isti E,N)
    const seen = new Map();
    for (const p of points) {
      const k = p[0].toFixed(3) + '|' + p[1].toFixed(3);
      if (!seen.has(k)) seen.set(k, p);
    }
    const pts = [...seen.values()];
    this.count = pts.length;

    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let sE = 0, sN = 0;
    for (const [e, n, z] of pts) {
      if (e < minE) minE = e; if (e > maxE) maxE = e;
      if (n < minN) minN = n; if (n > maxN) maxN = n;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      sE += e; sN += n;
    }
    this.bounds = { minE, maxE, minN, maxN, minZ, maxZ };
    // koordinatni početak — zaokružen da bi lokalne koordinate bile "čitljive"
    this.E0 = Math.round(sE / pts.length);
    this.N0 = Math.round(sN / pts.length);
    this.Z0 = Math.floor(minZ);

    const coords = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => { coords[2 * i] = p[0] - this.E0; coords[2 * i + 1] = p[1] - this.N0; });
    const z = new Float64Array(pts.length);
    pts.forEach((p, i) => { z[i] = p[2]; });
    this.xy = coords; // lokalno: x = E-E0, y = N-N0
    this.z = z;

    const d = new Delaunator(coords);
    // filtriraj izdužene ivične trouglove (konkavni obod snimanja)
    const tri = d.triangles;
    const edgeLen = (a, b) => Math.hypot(coords[2 * a] - coords[2 * b], coords[2 * a + 1] - coords[2 * b + 1]);
    const lens = [];
    for (let i = 0; i < tri.length; i += 3) lens.push(edgeLen(tri[i], tri[i + 1]));
    lens.sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 1;
    const maxEdge = med * maxEdgeFactor;
    const keep = [];
    for (let i = 0; i < tri.length; i += 3) {
      const a = tri[i], b = tri[i + 1], c = tri[i + 2];
      if (edgeLen(a, b) <= maxEdge && edgeLen(b, c) <= maxEdge && edgeLen(c, a) <= maxEdge) keep.push(a, b, c);
    }
    this.triangles = Uint32Array.from(keep);
    this.medianSpacing = med;
    this._buildRaster();
  }

  _buildRaster() {
    const { minE, maxE, minN, maxN } = this.bounds;
    const w = maxE - minE, h = maxN - minN;
    const cs = Math.max(Math.max(w, h) / 900, Math.min(this.medianSpacing / 2, 1), 0.25);
    const nx = Math.ceil(w / cs) + 1, ny = Math.ceil(h / cs) + 1;
    const grid = new Float32Array(nx * ny).fill(NaN);
    const ox = minE - this.E0, oy = minN - this.N0;
    const xy = this.xy, z = this.z, t = this.triangles;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i], b = t[i + 1], c = t[i + 2];
      const ax = xy[2 * a], ay = xy[2 * a + 1], bx = xy[2 * b], by = xy[2 * b + 1], cx = xy[2 * c], cy = xy[2 * c + 1];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - ox) / cs));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - ox) / cs));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - oy) / cs));
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - oy) / cs));
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * cs;
        for (let ii = i0; ii <= i1; ii++) {
          const px = ox + ii * cs;
          const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
          const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) grid[j * nx + ii] = l1 * z[a] + l2 * z[b] + l3 * z[c];
        }
      }
    }
    this.raster = { grid, nx, ny, cs, ox, oy };
  }

  /** Kota terena u tački (E, N) u apsolutnim koordinatama; NaN van obuhvata. */
  elevationAt(E, N) {
    return this.elevationAtLocal(E - this.E0, N - this.N0);
  }

  elevationAtLocal(x, y) {
    const { grid, nx, ny, cs, ox, oy } = this.raster;
    const fx = (x - ox) / cs, fy = (y - oy) / cs;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return NaN;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const v00 = grid[j * nx + i], v10 = grid[j * nx + i + 1], v01 = grid[(j + 1) * nx + i], v11 = grid[(j + 1) * nx + i + 1];
    if (!isNaN(v00) && !isNaN(v10) && !isNaN(v01) && !isNaN(v11)) {
      return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
    }
    // na obodu: ponderisano od validnih uglova
    let s = 0, ws = 0;
    [[v00, (1 - tx) * (1 - ty)], [v10, tx * (1 - ty)], [v01, (1 - tx) * ty], [v11, tx * ty]].forEach(([v, w]) => {
      if (!isNaN(v)) { s += v * (w + 1e-6); ws += w + 1e-6; }
    });
    return ws > 0 ? s / ws : NaN;
  }

  get extent() {
    const b = this.bounds;
    return { width: b.maxE - b.minE, height: b.maxN - b.minN, relief: b.maxZ - b.minZ };
  }
}
