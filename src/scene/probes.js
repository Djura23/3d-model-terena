import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { processCPT, SBT_ZONES } from '../core/cpt.js';
import { dpshIntervals, dpshClass } from '../core/dpsh.js';

const QC_MIN = 0.1, QC_MAX = 40; // MPa, logaritamska skala poluprečnika
export const qcRadiusFactor = (qc) => Math.min(1, Math.max(0, Math.log10(Math.max(qc, QC_MIN) / QC_MIN) / Math.log10(QC_MAX / QC_MIN)));

export function qcColor(qc) {
  // plava → tirkiz → žuta → narandžasta (log qc)
  const t = qcRadiusFactor(qc);
  const stops = [[0, [0.2, 0.36, 0.7]], [0.4, [0.3, 0.66, 0.66]], [0.7, [0.92, 0.8, 0.32]], [1, [0.86, 0.42, 0.18]]];
  let rgb = stops[3][1];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const k = (t - a) / (b - a);
    rgb = ca.map((v, j) => v + (cb[j] - v) * k);
    break;
  }
  return rgb;
}

/** sRGB [0..1] → linearni (za vertex boje). */
export function srgbToLinear(rgb) {
  tmpColor.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

export function rgbCss(rgb) {
  return `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
}

function makeLabel(text, cls) {
  const div = document.createElement('div');
  div.className = 'lbl ' + cls;
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.center.set(0.5, 1);
  return o;
}

const tmpColor = new THREE.Color();

/**
 * Pravi 3D simbole svih istražnih radova.
 * @returns {{groups:{bh,cpt,dpsh,labels,gwl}, items: Array}}
 */
export function buildProbes(project, terrain, { symbolScale = 1, cptColor = 'sbt' } = {}) {
  const span = Math.max(terrain.extent.width, terrain.extent.height);
  const R = Math.max(0.35, (span / 260) * symbolScale); // poluprečnik simbola [m]
  const soilMap = new Map(project.soils.map((s) => [s.code, s]));
  const groups = {
    bh: new THREE.Group(), cpt: new THREE.Group(), dpsh: new THREE.Group(), labels: new THREE.Group(), gwl: new THREE.Group(),
  };
  Object.entries(groups).forEach(([k, g]) => (g.name = k));
  const items = [];
  const Y = (z) => z - terrain.Z0;
  const X = (E) => E - terrain.E0;
  const Zc = (N) => -(N - terrain.N0);

  const collarZ = (t) => (t.Z != null && isFinite(t.Z) ? t.Z : terrain.elevationAt(t.E, t.N));

  const addLabel = (item, text, cls, top) => {
    const l = makeLabel(text, cls);
    l.position.set(X(item.E), Y(top), Zc(item.N));
    l.userData = { item, baseY: Y(top) };
    l.element.dataset.id = item.id;
    groups.labels.add(l);
    item.label = l;
  };

  const addGwl = (item, z0, x, zc) => {
    if (item.gwl == null || !isFinite(item.gwl)) return;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.9, R * 1.9, 0.06, 28),
      new THREE.MeshBasicMaterial({ color: 0x2a7de1, transparent: true, opacity: 0.85 })
    );
    m.position.set(x, Y(z0 - item.gwl), zc);
    m.userData = { kind: 'gwl', item };
    groups.gwl.add(m);
  };

  // ---------------- bušotine ----------------
  for (const bh of project.boreholes) {
    const z0 = collarZ(bh);
    const x = X(bh.E), zc = Zc(bh.N);
    const g = new THREE.Group();
    g.userData = { kind: 'bh', item: bh };
    for (const l of bh.layers) {
      const h = l.bottom - l.top;
      if (h <= 0) continue;
      const s = soilMap.get(l.code);
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, h, 24, 1),
        new THREE.MeshStandardMaterial({ color: s?.color || '#999', roughness: 0.75 })
      );
      m.position.set(x, Y(z0 - (l.top + l.bottom) / 2), zc);
      m.userData = { kind: 'bh', item: bh, layer: l };
      g.add(m);
    }
    if (!bh.layers.length && bh.depth > 0) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.5, R * 0.5, bh.depth, 12), new THREE.MeshStandardMaterial({ color: 0x888780 }));
      m.position.set(x, Y(z0 - bh.depth / 2), zc);
      m.userData = { kind: 'bh', item: bh };
      g.add(m);
    }
    // ušće: tamni prsten
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.35, R * 1.35, 0.12, 28), new THREE.MeshStandardMaterial({ color: 0x1d2228 }));
    cap.position.set(x, Y(z0) + 0.06, zc);
    cap.userData = { kind: 'bh', item: bh };
    g.add(cap);
    groups.bh.add(g);
    addGwl(bh, z0, x, zc);
    bh._z0 = z0;
    addLabel(bh, bh.id, 'lbl-bh', z0);
    items.push({ kind: 'bh', item: bh, object: g });
  }

  // ---------------- CPT ----------------
  for (const c of project.cpts) {
    const z0 = collarZ(c);
    c._z0 = z0;
    c._proc = processCPT(c.data, { gwl: isFinite(c.gwl) && c.gwl != null ? c.gwl : 0, a: c.area_ratio ?? 0.8 });
    const proc = c._proc;
    if (!proc.length) continue;
    const x = X(c.E), zc = Zc(c.N);
    // decimacija na ~0.1 m (geometrija) uz očuvanje vrhova
    const pts = [new THREE.Vector2(0, 0)];
    const cols = [[1, 1, 1]];
    const step = 0.1;
    let acc = [], accTop = 0;
    const flush = (zEnd) => {
      if (!acc.length) return;
      const qc = acc.reduce((s, p) => s + p.qc, 0) / acc.length;
      const zone = mode(acc.map((p) => p.zone));
      const r = R * (0.22 + 1.55 * qcRadiusFactor(qc));
      const zMid = (accTop + zEnd) / 2;
      pts.push(new THREE.Vector2(r, -zMid));
      cols.push(cptColor === 'sbt' ? hexToRgb(SBT_ZONES[zone]?.color || '#999') : srgbToLinear(qcColor(qc)));
      acc = []; accTop = zEnd;
    };
    for (const p of proc) {
      acc.push(p);
      if (p.z - accTop >= step) flush(p.z);
    }
    flush(proc[proc.length - 1].z);
    const zEnd = proc[proc.length - 1].z;
    pts.push(new THREE.Vector2(0, -zEnd));
    cols.push(cols[cols.length - 1]);
    pts[0].x = pts[1].x; // vrh odmah počinje punim poluprečnikom
    cols[0] = cols[1];
    pts.unshift(new THREE.Vector2(0, 0)); cols.unshift(cols[1]);
    // LatheGeometry očekuje rastući y; okrećemo redosled
    const P = pts.slice().reverse(), C = cols.slice().reverse();
    const segs = 20;
    const geo = new THREE.LatheGeometry(P, segs);
    const colArr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i <= segs; i++) for (let j = 0; j < P.length; j++) {
      const v = i * P.length + j; colArr.set(C[j], v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
    m.position.set(x, Y(z0), zc);
    m.userData = { kind: 'cpt', item: c };
    const g = new THREE.Group();
    g.userData = { kind: 'cpt', item: c };
    g.add(m);
    // osovina sonde
    const ax = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.12, R * 0.12, zEnd, 8), new THREE.MeshBasicMaterial({ color: 0x1d2228 }));
    ax.position.set(x, Y(z0 - zEnd / 2), zc);
    ax.userData = { kind: 'cpt', item: c };
    g.add(ax);
    // simbol: obrnuti konus na ušću
    const cone = new THREE.Mesh(new THREE.ConeGeometry(R * 1.3, R * 2.2, 3), new THREE.MeshStandardMaterial({ color: 0x2b3a55 }));
    cone.rotation.x = Math.PI;
    cone.position.set(x, Y(z0) + R * 1.1, zc);
    cone.userData = { kind: 'cpt', item: c };
    g.add(cone);
    groups.cpt.add(g);
    addGwl(c, z0, x, zc);
    addLabel(c, c.id, 'lbl-cpt', z0);
    items.push({ kind: 'cpt', item: c, object: g });
  }

  // ---------------- DPSH-B ----------------
  for (const d of project.dpsh) {
    const z0 = collarZ(d);
    d._z0 = z0;
    const iv = dpshIntervals(d);
    if (!iv.length) continue;
    const x = X(d.E), zc = Zc(d.N);
    const P = [], C = [];
    const rOf = (n20) => R * (0.25 + 1.45 * Math.min(1, n20 / 60));
    P.push(new THREE.Vector2(0, -iv[iv.length - 1].bottom));
    C.push(hexToRgb(dpshClass(iv[iv.length - 1].n20).color));
    for (let i = iv.length - 1; i >= 0; i--) {
      const s = iv[i], r = rOf(s.n20), c = hexToRgb(dpshClass(s.n20).color);
      P.push(new THREE.Vector2(r, -s.bottom)); C.push(c);
      P.push(new THREE.Vector2(r, -s.top)); C.push(c);
    }
    P.push(new THREE.Vector2(0, -iv[0].top)); C.push(C[C.length - 1]);
    const segs = 4;
    const geo = new THREE.LatheGeometry(P, segs, Math.PI / 4);
    const colArr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i <= segs; i++) for (let j = 0; j < P.length; j++) colArr.set(C[j], (i * P.length + j) * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    const nonIdx = geo.toNonIndexed();
    nonIdx.computeVertexNormals();
    const m = new THREE.Mesh(nonIdx, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true, side: THREE.DoubleSide }));
    m.position.set(x, Y(z0), zc);
    m.userData = { kind: 'dpsh', item: d };
    const g = new THREE.Group();
    g.userData = { kind: 'dpsh', item: d };
    g.add(m);
    const box = new THREE.Mesh(new THREE.BoxGeometry(R * 2, R * 0.9, R * 2), new THREE.MeshStandardMaterial({ color: 0x3b2f5c }));
    box.rotation.y = Math.PI / 4;
    box.position.set(x, Y(z0) + R * 0.45, zc);
    box.userData = { kind: 'dpsh', item: d };
    g.add(box);
    groups.dpsh.add(g);
    addGwl(d, z0, x, zc);
    addLabel(d, d.id, 'lbl-dpsh', z0);
    items.push({ kind: 'dpsh', item: d, object: g });
  }

  return { groups, items, R };
}

/** Pomeranje oznaka iznad ušća nezavisno od vertikalnog uveličanja. */
export function updateLabelLift(labelsGroup, ve, lift) {
  for (const l of labelsGroup.children) l.position.y = l.userData.baseY + lift / ve;
}

export function setHighlight(obj, on) {
  obj?.traverse?.((o) => {
    const m = o.material;
    if (m && 'emissive' in m) {
      m.emissive.setHex(on ? 0x2a4d7a : 0x000000);
      m.emissiveIntensity = on ? 0.55 : 0;
    }
  });
}

function mode(arr) {
  const c = new Map();
  for (const v of arr) c.set(v, (c.get(v) || 0) + 1);
  let best = null, bc = -1;
  for (const [k, v] of c) if (v > bc) { bc = v; best = k; }
  return best;
}

// vertex boje su u linearnom prostoru; Color(hex) radi sRGB → linear konverziju
export function hexToRgb(hex) {
  tmpColor.set(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}
