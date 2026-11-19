import * as THREE from 'three';

/**
 * Providna površ NPV u oblasti istražnih radova. Gde bi interpolirani NPV bio iznad terena,
 * površ se spušta na teren (−5 cm) — model ne izmišlja vodu iznad površine.
 */
export function buildGwlSurface(gwm, terrain, region, { cells = 80 } = {}) {
  const group = new THREE.Group();
  group.name = 'npv-povrs';
  if (!gwm || !region) return { group, material: null };
  const { x0, x1, y0, y1 } = region;
  const nx = cells + 1, ny = Math.max(2, Math.round((cells * (y1 - y0)) / Math.max(x1 - x0, 1))) + 1;
  const dx = (x1 - x0) / (nx - 1), dy = (y1 - y0) / (ny - 1);
  const V = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, y = y0 + j * dy;
    const zt = terrain.elevationAtLocal(x, y);
    if (!isFinite(zt)) { V[j * nx + i] = null; continue; }
    const zw = Math.min(gwm.at(x + terrain.E0, y + terrain.N0), zt - 0.05);
    V[j * nx + i] = [x, zw - terrain.Z0, -y];
  }
  const pos = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = V[j * nx + i], b = V[j * nx + i + 1], c = V[(j + 1) * nx + i], d = V[(j + 1) * nx + i + 1];
    if (a && b && c) pos.push(...a, ...b, ...c);
    if (b && d && c) pos.push(...b, ...d, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0x2a7de1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.renderOrder = 4;
  mesh.userData = { kind: 'gwlSurface' };
  group.add(mesh);
  return { group, material };
}
