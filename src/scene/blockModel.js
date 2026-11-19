import * as THREE from 'three';

/**
 * Geološki blok-dijagram: svaka litološka jedinica je ZATVORENO telo (krovina, podina, bočne strane)
 * u pravougaonoj oblasti oko istražnih radova. Podržava "eksplodirani" prikaz (razmicanje jedinica).
 */
export function buildBlockModel(geology, terrain, project, { margin = 0.12, maxCells = 90 } = {}) {
  const group = new THREE.Group();
  group.name = 'blok';
  if (!geology.valid) return { group, units: [] };

  // oblast: svi istražni radovi + margina, presečeno sa terenom
  const all = [...project.boreholes, ...project.cpts, ...project.dpsh];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of all) {
    const x = t.E - terrain.E0, y = t.N - terrain.N0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = Math.max(10, margin * Math.max(x1 - x0, y1 - y0));
  const b = terrain.bounds;
  x0 = Math.max(x0 - pad, b.minE - terrain.E0); x1 = Math.min(x1 + pad, b.maxE - terrain.E0);
  y0 = Math.max(y0 - pad, b.minN - terrain.N0); y1 = Math.min(y1 + pad, b.maxN - terrain.N0);
  const cell = Math.max((x1 - x0) / maxCells, (y1 - y0) / maxCells, 0.5);
  const nx = Math.max(2, Math.round((x1 - x0) / cell)) + 1;
  const ny = Math.max(2, Math.round((y1 - y0) / cell)) + 1;
  const dx = (x1 - x0) / (nx - 1), dy = (y1 - y0) / (ny - 1);

  const K = geology.lastUnit + 1;
  const stacks = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, y = y0 + j * dy;
    const s = terrain.elevationAtLocal(x, y);
    stacks[j * nx + i] = isFinite(s) ? geology.boundaryStackLocal(x, y, s) : null;
  }
  const Z0 = terrain.Z0;
  const V = (i, j, k) => {
    const st = stacks[j * nx + i];
    return st ? [x0 + i * dx, st[k] - Z0, -(y0 + j * dy)] : null;
  };

  const units = [];
  for (let k = 0; k < K; k++) {
    const pos = [];
    const topOnly = [];
    const pushTri = (arr, a, b2, c) => { if (a && b2 && c) arr.push(...a, ...b2, ...c); };
    const thick = (i, j) => { const st = stacks[j * nx + i]; return st ? st[k] - st[k + 1] : 0; };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      if (Math.max(thick(i, j), thick(i + 1, j), thick(i, j + 1), thick(i + 1, j + 1)) < 1e-3) continue;
      const a = V(i, j, k), bb = V(i + 1, j, k), c = V(i, j + 1, k), d = V(i + 1, j + 1, k);
      const target = k === 0 ? topOnly : pos;
      pushTri(target, a, bb, c); pushTri(target, bb, d, c);
      const a2 = V(i, j, k + 1), b2 = V(i + 1, j, k + 1), c2 = V(i, j + 1, k + 1), d2 = V(i + 1, j + 1, k + 1);
      pushTri(pos, a2, c2, b2); pushTri(pos, b2, c2, d2);
    }
    // bočne strane po obodu
    const wall = (p, q) => {
      const pt = V(...p, k), qt = V(...q, k), pb = V(...p, k + 1), qb = V(...q, k + 1);
      if (!pt || !qt) return;
      if (pt[1] - pb[1] < 1e-3 && qt[1] - qb[1] < 1e-3) return;
      pushTri(pos, pt, pb, qt); pushTri(pos, qt, pb, qb);
    };
    for (let i = 0; i < nx - 1; i++) { wall([i, 0], [i + 1, 0]); wall([i + 1, ny - 1], [i, ny - 1]); }
    for (let j = 0; j < ny - 1; j++) { wall([nx - 1, j], [nx - 1, j + 1]); wall([0, j + 1], [0, j]); }

    const soil = geology.units[k];
    const mat = new THREE.MeshStandardMaterial({
      color: soil.color, roughness: 0.9, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
    });
    const ug = new THREE.Group();
    ug.userData = { kind: 'unit', soil, k };
    const mk = (arr, name) => {
      if (!arr.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.userData = { kind: 'unit', soil, k };
      ug.add(m);
      return m;
    };
    mk(pos, 'telo');
    const top = mk(topOnly, 'krovina'); // krovina prve jedinice = teren (skriva se kad je teren uključen)
    group.add(ug);
    units.push({ soil, group: ug, material: mat, top, k });
  }
  group.userData = { units, region: { x0, x1, y0, y1 } };
  return { group, units };
}

export function setBlockExplode(block, gap) {
  for (const u of block.units) u.group.position.y = -u.k * gap;
}

export function setBlockOpacity(block, op) {
  for (const u of block.units) {
    u.material.opacity = op;
    u.material.transparent = op < 0.999;
    u.material.depthWrite = op >= 0.999;
    u.material.needsUpdate = true;
  }
}
