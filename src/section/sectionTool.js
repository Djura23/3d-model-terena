import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { SBT_ZONES } from '../core/cpt.js';

const _v = new THREE.Vector3();

/**
 * Hvatanje za istražni rad: ako je kursor na ≤ px piksela od ušća ili od oznake rada, vraća njegove koordinate.
 * targets: [{id, E, N, local: Vector3 (ušće u lokalnim koordinatama world grupe), label?: CSS2DObject}]
 */
export function snapToProbe(viewer, targets, clientX, clientY, px = 16) {
  if (!targets?.length) return null;
  const r = viewer.renderer.domElement.getBoundingClientRect();
  let best = null, bd = px;
  const test = (vec, dyPx) => {
    vec.project(viewer.camera);
    if (vec.z > 1 || vec.z < -1) return Infinity;
    const sx = r.left + ((vec.x + 1) / 2) * r.width, sy = r.top + ((1 - vec.y) / 2) * r.height - dyPx;
    return Math.hypot(sx - clientX, sy - clientY);
  };
  for (const t of targets) {
    _v.copy(t.local);
    viewer.world.localToWorld(_v);
    let d = test(_v, 0);
    if (t.label?.visible) { t.label.getWorldPosition(_v); d = Math.min(d, test(_v, 14)); } // oznaka je iznad svoje tačke
    if (d < bd) { bd = d; best = t; }
  }
  return best ? { E: best.E, N: best.N, snap: best.id } : null;
}

/**
 * Crtanje linije preseka mišem direktno po terenu.
 *  - klik: dodaj teme (rotacija/pomeranje pogleda i dalje rade — klik se razlikuje od prevlačenja)
 *  - klik na/kod bušotine ili sonde: teme se "hvata" tačno u njeno ušće
 *  - dvoklik ili Enter: završi · Backspace: ukloni poslednje teme · Esc: odustani
 *  - Shift: pravac zaključan na 15° korake (ortogonalni preseci)
 */
export class SectionDrawTool {
  constructor(viewer, getTerrainMesh, terrain, { onFinish, onChange, onCancel, getSnapTargets } = {}) {
    this.v = viewer;
    this.getTerrainMesh = getTerrainMesh;
    this.terrain = terrain;
    this.onFinish = onFinish; this.onChange = onChange; this.onCancel = onCancel;
    this.getSnapTargets = getSnapTargets;
    this.active = false;
    this.points = []; // {E, N, snap?}
    this.group = new THREE.Group();
    this.group.name = 'crtanje-preseka';
    viewer.world.add(this.group);
    this.mat = new LineMaterial({ color: 0xff3b30, linewidth: 3, worldUnits: false, dashed: false, depthTest: false, transparent: true });
    this.matPreview = new LineMaterial({ color: 0xff3b30, linewidth: 2, dashed: true, dashSize: 3, gapSize: 2, depthTest: false, transparent: true, opacity: 0.85 });
    this._down = null;
    const el = viewer.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { if (this.active && e.button === 0) this._down = [e.clientX, e.clientY, performance.now()]; });
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('dblclick', (e) => { if (this.active) { e.preventDefault(); this.finish(); } });
    window.addEventListener('keydown', (e) => {
      if (!this.active || /input|select|textarea/i.test(document.activeElement?.tagName)) return;
      if (e.key === 'Enter') this.finish();
      else if (e.key === 'Escape') this.cancel();
      else if (e.key === 'Backspace') { e.preventDefault(); this.points.pop(); this._redraw(); }
    });
    viewer.onFrame(() => {
      const r = viewer.renderer.domElement;
      this.mat.resolution.set(r.width, r.height);
      this.matPreview.resolution.set(r.width, r.height);
    });
  }

  start() {
    this.active = true;
    this.points = [];
    this._cursor = null;
    this._redraw();
    this.v.renderer.domElement.classList.add('drawing');
  }

  cancel() {
    this.active = false;
    this.points = [];
    this._clear();
    this.v.renderer.domElement.classList.remove('drawing');
    this.onCancel?.();
  }

  finish() {
    // ukloni duplikate nastale dvoklikom
    const pts = [];
    for (const p of this.points) {
      const q = pts[pts.length - 1];
      if (!q || Math.hypot(p.E - q.E, p.N - q.N) > 0.5) pts.push(p);
    }
    this.active = false;
    this._clear();
    this.v.renderer.domElement.classList.remove('drawing');
    if (pts.length >= 2) this.onFinish?.(pts);
    else this.onCancel?.();
  }

  /** Tačka ispod kursora: prvo hvatanje za istražni rad, pa teren (uz Shift ugaoni korak). */
  _pointAt(e) {
    const s = snapToProbe(this.v, this.getSnapTargets?.(), e.clientX, e.clientY);
    if (s) return s;
    const p = terrainPoint(this.v, this.getTerrainMesh(), this.terrain, e);
    return p ? this._angleSnap(p, e) : null;
  }

  _angleSnap(p, e) {
    const last = this.points[this.points.length - 1];
    if (!last || !e.shiftKey) return p;
    const dx = p.E - last.E, dy = p.N - last.N, L = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
    return { E: last.E + L * Math.cos(a), N: last.N + L * Math.sin(a) };
  }

  _up(e) {
    if (!this.active || !this._down || e.button !== 0) return;
    const [x, y] = this._down;
    this._down = null;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 5) return; // bilo je prevlačenje (rotacija)
    const p = this._pointAt(e);
    if (!p) return;
    this.points.push(p);
    this._redraw();
  }

  _move(e) {
    if (!this.active) return;
    const p = this._pointAt(e);
    this._cursor = p;
    this._redraw(true);
  }

  _clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose?.(); }
  }

  _redraw(previewOnly = false) {
    this._clear();
    const pts = this.points;
    if (pts.length >= 2) this.group.add(drapedLine(pts, this.terrain, this.mat));
    if (pts.length >= 1 && this._cursor && this.active) {
      const pl = drapedLine([pts[pts.length - 1], this._cursor], this.terrain, this.matPreview);
      pl.computeLineDistances();
      this.group.add(pl);
    }
    for (const p of pts) this.group.add(vertexMarker(p, this.terrain, this.v.world.scale.y));
    // pokazivač hvatanja (i pre prvog temena)
    if (this.active && this._cursor?.snap) this.group.add(vertexMarker(this._cursor, this.terrain, this.v.world.scale.y, 0x1d2228, 1.6));
    const L = pts.reduce((s, p, i) => (i ? s + Math.hypot(p.E - pts[i - 1].E, p.N - pts[i - 1].N) : 0), 0) +
      (previewOnly && this._cursor && pts.length ? Math.hypot(this._cursor.E - pts[pts.length - 1].E, this._cursor.N - pts[pts.length - 1].N) : 0);
    this.onChange?.(pts, L, this.active ? this._cursor?.snap : null);
  }
}

/** Presek terena pod kursorom → {E, N} ili null. */
export function terrainPoint(viewer, mesh, terrain, e) {
  if (!mesh || !terrain) return null;
  viewer.setPointer(e);
  const hit = viewer.raycaster.intersectObject(mesh, false)[0];
  if (!hit) return null;
  const p = viewer.world.worldToLocal(hit.point.clone());
  return { E: p.x + terrain.E0, N: -p.z + terrain.N0 };
}

/**
 * Izmena postojećeg preseka: prevlačenje temena po terenu (sa hvatanjem za istražne radove),
 * desni klik na teme ga briše (ako ostaju bar 2), dvoklik na liniju preseka dodaje novo teme.
 */
export class SectionEditor {
  constructor(viewer, parent, { getTerrainMesh, getTerrain, getSnapTargets, onCommit, onDragStart }) {
    this.v = viewer;
    this.getTerrainMesh = getTerrainMesh; this.getTerrain = getTerrain;
    this.getSnapTargets = getSnapTargets; this.onCommit = onCommit; this.onDragStart = onDragStart;
    this.group = new THREE.Group();
    this.group.name = 'izmena-preseka';
    parent.add(this.group);
    this.sec = null;
    this.enabled = true;
    this.dragging = null;
    this.justEnded = false;
    this.lineMat = new LineMaterial({ color: 0xff3b30, linewidth: 3, depthTest: false, transparent: true });
    viewer.onFrame(() => {
      const r = viewer.renderer.domElement;
      this.lineMat.resolution.set(r.width, r.height);
      // ručke stalne veličine na ekranu (≈ px poluprečnik), nezavisno od udaljenosti kamere
      const cam = viewer.camera, k = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, r.clientHeight);
      for (const m of this.group.children) {
        if (!m.userData.px) continue;
        m.getWorldPosition(_v);
        const s = (m.userData.px * _v.distanceTo(cam.position) * k) / m.userData.r0;
        m.scale.set(s, s / viewer.world.scale.y, s);
      }
    });
    const el = viewer.renderer.domElement;
    // capture: hvatamo događaj pre OrbitControls (na ciljnom elementu capture slušaoci idu prvi)
    el.addEventListener('pointerdown', (e) => this._down(e), { capture: true });
    el.addEventListener('pointermove', (e) => this._move(e), { capture: true });
    el.addEventListener('pointerup', (e) => this._up(e), { capture: true });
    el.addEventListener('contextmenu', (e) => this._context(e), { capture: true });
    el.addEventListener('dblclick', (e) => this._dbl(e), { capture: true });
  }

  setSection(sec) { this.sec = sec; this._rebuild(); }

  get handles() { return this.group.children.filter((c) => c.userData.handle != null); }

  _rebuild(withLine = false) {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose?.(); }
    const t = this.getTerrain();
    if (!this.sec || !t || !this.enabled) return;
    this.sec.vertices.forEach((p, i) => {
      const m = vertexMarker(p, t, this.v.world.scale.y, p.snap ? 0x1d2228 : 0xffffff, 1);
      m.userData.handle = i;
      m.userData.px = 5;
      m.userData.r0 = m.geometry.parameters.radius;
      // crveni obod
      const ring = vertexMarker(p, t, this.v.world.scale.y, 0xff3b30, 1);
      ring.renderOrder = 20;
      ring.userData.px = 7.5;
      ring.userData.r0 = ring.geometry.parameters.radius;
      this.group.add(ring, m);
    });
    if (withLine) this.group.add(drapedLine(this.sec.vertices, t, this.lineMat, 0.3));
  }

  _hitHandle(e) {
    if (!this.sec || !this.enabled) return null;
    this.v.setPointer(e);
    const h = this.v.raycaster.intersectObjects(this.handles, false)[0];
    if (h) return h.object.userData.handle;
    // i u pikselima (sfere su male)
    const r = this.v.renderer.domElement.getBoundingClientRect();
    let best = null, bd = 12;
    this.handles.forEach((m) => {
      m.getWorldPosition(_v).project(this.v.camera);
      const d = Math.hypot(r.left + ((_v.x + 1) / 2) * r.width - e.clientX, r.top + ((1 - _v.y) / 2) * r.height - e.clientY);
      if (d < bd) { bd = d; best = m.userData.handle; }
    });
    return best;
  }

  _down(e) {
    if (e.button !== 0) return;
    const i = this._hitHandle(e);
    if (i == null) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.dragging = i;
    this._downAt = [e.clientX, e.clientY];
    this.v.controls.enabled = false;
    this.v.renderer.domElement.setPointerCapture(e.pointerId);
    this.onDragStart?.(this.sec);
  }

  _move(e) {
    if (this.dragging == null) {
      if (this.sec && this.enabled && !e.buttons) this.v.renderer.domElement.style.cursor = this._hitHandle(e) != null ? 'grab' : '';
      return;
    }
    e.stopImmediatePropagation();
    this._dragTo(e);
    this.v.renderer.domElement.style.cursor = 'grabbing';
  }

  _dragTo(e) {
    // pomeraj manji od 4 px = samo klik na teme, bez pomeranja
    if (this._downAt && Math.hypot(e.clientX - this._downAt[0], e.clientY - this._downAt[1]) < 4) return;
    const t = this.getTerrain();
    const p = snapToProbe(this.v, this.getSnapTargets?.(), e.clientX, e.clientY) || terrainPoint(this.v, this.getTerrainMesh(), t, e);
    if (!p) return;
    this.sec.vertices = this.sec.vertices.map((q, k) => (k === this.dragging ? p : q));
    this._rebuild(true);
  }

  _up(e) {
    if (this.dragging == null) return;
    e.stopImmediatePropagation();
    this._dragTo(e); // konačna pozicija (i kad pregledač ne pošalje međukorake pomeranja)
    this.dragging = null;
    this.v.controls.enabled = true;
    this.justEnded = true;
    setTimeout(() => (this.justEnded = false), 0);
    this.v.renderer.domElement.style.cursor = '';
    this.onCommit?.(this.sec);
  }

  _context(e) {
    const i = this._hitHandle(e);
    if (i == null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.sec.vertices.length <= 2) return;
    this.sec.vertices = this.sec.vertices.filter((_, k) => k !== i);
    this.onCommit?.(this.sec);
  }

  _dbl(e) {
    if (!this.sec || !this.enabled) return;
    const t = this.getTerrain();
    const p = terrainPoint(this.v, this.getTerrainMesh(), t, e);
    if (!p) return;
    // najbliži segment; ubaci teme ako je klik na ≤ 3 % dužine preseka od linije
    const V = this.sec.vertices;
    let best = null;
    for (let i = 1; i < V.length; i++) {
      const a = V[i - 1], b = V[i], dx = b.E - a.E, dy = b.N - a.N, L2 = dx * dx + dy * dy || 1;
      const tt = Math.min(1, Math.max(0, ((p.E - a.E) * dx + (p.N - a.N) * dy) / L2));
      const d = Math.hypot(p.E - (a.E + dx * tt), p.N - (a.N + dy * tt));
      if (!best || d < best.d) best = { d, i };
    }
    const len = V.reduce((s, q, i) => (i ? s + Math.hypot(q.E - V[i - 1].E, q.N - V[i - 1].N) : 0), 0);
    if (!best || best.d > Math.max(2, len * 0.03)) return;
    e.stopImmediatePropagation();
    this.sec.vertices = [...V.slice(0, best.i), p, ...V.slice(best.i)];
    this.onCommit?.(this.sec);
  }
}

/** Linija prevučena preko terena (uzorkovanje ~1 m). */
export function drapedLine(pts, terrain, material, lift = 0.25) {
  const pos = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.E - a.E, b.N - a.N);
    const n = Math.max(2, Math.ceil(L / Math.max(0.5, terrain.raster.cs)));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, E = a.E + (b.E - a.E) * t, N = a.N + (b.N - a.N) * t;
      const z = terrain.elevationAt(E, N);
      pos.push(E - terrain.E0, (isFinite(z) ? z : terrain.bounds.minZ) - terrain.Z0 + lift, -(N - terrain.N0));
    }
  }
  const g = new LineGeometry();
  g.setPositions(pos);
  const l = new Line2(g, material);
  l.renderOrder = 20;
  return l;
}

function vertexMarker(p, terrain, ve, color = 0xff3b30, scale = 1) {
  const z = terrain.elevationAt(p.E, p.N);
  const r = Math.max(0.6, terrain.extent.width / 300) * scale;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  m.position.set(p.E - terrain.E0, (isFinite(z) ? z : terrain.bounds.minZ) - terrain.Z0, -(p.N - terrain.N0));
  m.scale.y = 1 / ve;
  m.renderOrder = 21;
  return m;
}

// --------------------------------------------------------------------------------------------
/**
 * 3D "zavesa" preseka: vertikalna površ duž linije preseka sa teksturom geološkog profila.
 */
export function buildCurtain(sec, terrain, project, { labels = ['A', "A'"], opacity = 0.96 } = {}) {
  const group = new THREE.Group();
  group.name = 'presek-3d';
  const zTop = sec.zmax + 0.5, zBot = sec.zmin;
  const S = sec.samples.filter((s) => isFinite(s.zt));
  // tekstura
  const TW = 2048, TH = 1024;
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const c = cv.getContext('2d');
  const U = (s) => (s / sec.L) * TW;
  const Vt = (z) => ((zTop - z) / (zTop - zBot)) * TH;
  c.fillStyle = '#f4f1ea';
  c.fillRect(0, 0, TW, TH);
  const pats = new Map(project.soils.map((s) => [s.code, canvasPattern(c, s)]));
  const G = S.filter((s) => s.stack);
  if (G.length > 1) {
    for (let k = 0; k < sec.K; k++) {
      c.beginPath();
      G.forEach((p, i) => (i ? c.lineTo(U(p.s), Vt(p.stack[k])) : c.moveTo(U(p.s), Vt(p.stack[k]))));
      for (let i = G.length - 1; i >= 0; i--) c.lineTo(U(G[i].s), Vt(G[i].stack[k + 1]));
      c.closePath();
      c.fillStyle = pats.get(sec.units[k].code) || sec.units[k].color;
      c.fill();
    }
    c.setLineDash([14, 8]);
    c.strokeStyle = 'rgba(40,30,20,0.8)';
    c.lineWidth = 2.5;
    for (let k = 1; k < sec.K; k++) {
      c.beginPath();
      G.forEach((p, i) => (i ? c.lineTo(U(p.s), Vt(p.stack[k])) : c.moveTo(U(p.s), Vt(p.stack[k]))));
      c.stroke();
    }
    c.setLineDash([]);
  }
  if (sec.hasGwl) {
    c.setLineDash([22, 10]); c.strokeStyle = '#1f6fd1'; c.lineWidth = 5;
    c.beginPath();
    sec.samples.filter((p) => isFinite(p.gwl)).forEach((p, i) => (i ? c.lineTo(U(p.s), Vt(p.gwl)) : c.moveTo(U(p.s), Vt(p.gwl))));
    c.stroke(); c.setLineDash([]);
  }
  // istražni radovi u preseku — vertikalne trake
  for (const p of sec.probes) {
    const it = p.item, z0 = it._z0 ?? it.Z, x = U(p.s);
    if (p.kind === 'bh') {
      for (const l of it.layers) { c.fillStyle = project.soils.find((s) => s.code === l.code)?.color || '#999'; c.fillRect(x - 9, Vt(z0 - l.top), 18, Vt(z0 - l.bottom) - Vt(z0 - l.top)); }
      c.strokeStyle = '#1d2228'; c.lineWidth = 3; c.strokeRect(x - 9, Vt(z0), 18, Vt(z0 - it.depth) - Vt(z0));
    } else if (p.kind === 'cpt' && it._proc) {
      c.strokeStyle = '#c0392b'; c.lineWidth = 3; c.beginPath();
      it._proc.forEach((q, i) => { const xx = x + Math.min(q.qt, 40) * 4; i ? c.lineTo(xx, Vt(z0 - q.z)) : c.moveTo(xx, Vt(z0 - q.z)); });
      c.stroke();
      for (const q of it._proc) { c.fillStyle = SBT_ZONES[q.zone]?.color || '#999'; c.fillRect(x - 6, Vt(z0 - q.z), 6, 3); }
    } else if (p.kind === 'dpsh') {
      c.strokeStyle = '#3b2f5c'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, Vt(z0)); c.lineTo(x, Vt(z0 - (it.data[it.data.length - 1]?.z || 0))); c.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // geometrija: od terena do dna modela
  const pos = [], uv = [], idx = [];
  S.forEach((p, i) => {
    const x = p.E - terrain.E0, z = -(p.N - terrain.N0);
    pos.push(x, p.zt - terrain.Z0, z, x, zBot - terrain.Z0, z);
    uv.push(p.s / sec.L, 1 - Vt(p.zt) / TH, p.s / sec.L, 1 - Vt(zBot) / TH);
    if (i > 0) { const a = 2 * (i - 1); idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: -1 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 5;
  mesh.userData = { kind: 'curtain', sec };
  group.add(mesh);

  // ivica
  const edge = [];
  S.forEach((p) => edge.push(p.E - terrain.E0, p.zt - terrain.Z0 + 0.05, -(p.N - terrain.N0)));
  for (let i = S.length - 1; i >= 0; i--) edge.push(S[i].E - terrain.E0, zBot - terrain.Z0, -(S[i].N - terrain.N0));
  edge.push(edge[0], edge[1], edge[2]);
  const lg = new LineGeometry(); lg.setPositions(edge);
  const lmat = new LineMaterial({ color: 0x1d2228, linewidth: 1.6 });
  const line = new Line2(lg, lmat);
  group.add(line);
  group.userData = { lineMaterials: [lmat], mesh, tex };

  // oznake krajeva
  const ends = [[S[0], labels[0]], [S[S.length - 1], labels[1]]];
  for (const [p, t] of ends) {
    const div = document.createElement('div');
    div.className = 'lbl lbl-sec';
    div.textContent = t;
    const o = new CSS2DObject(div);
    o.center.set(0.5, 1.1);
    o.position.set(p.E - terrain.E0, p.zt - terrain.Z0, -(p.N - terrain.N0));
    group.add(o);
  }
  return group;
}

function canvasPattern(ctx, soil) {
  const t = document.createElement('canvas');
  t.width = t.height = 24;
  const c = t.getContext('2d');
  c.fillStyle = soil.color; c.fillRect(0, 0, 24, 24);
  c.strokeStyle = 'rgba(30,25,20,0.4)'; c.fillStyle = 'rgba(30,25,20,0.4)'; c.lineWidth = 1.5;
  switch (soil.pattern) {
    case 'clay': c.beginPath(); c.moveTo(0, 8); c.lineTo(24, 8); c.moveTo(12, 20); c.lineTo(24, 20); c.moveTo(0, 20); c.lineTo(6, 20); c.stroke(); break;
    case 'silt': c.beginPath(); c.moveTo(0, 8); c.lineTo(9, 8); c.moveTo(14, 8); c.lineTo(23, 8); c.stroke(); c.fillRect(10, 18, 3, 3); break;
    case 'sand': [[4, 4], [16, 10], [7, 19], [20, 21]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); }); break;
    case 'gravel': [[7, 7, 4.5], [18, 17, 3.5]].forEach(([x, y, r]) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); }); break;
    case 'marl': c.beginPath(); c.moveTo(0, 6); c.lineTo(24, 6); c.moveTo(0, 18); c.lineTo(24, 18); c.moveTo(8, 6); c.lineTo(8, 18); c.moveTo(20, 18); c.lineTo(20, 24); c.moveTo(20, 0); c.lineTo(20, 6); c.stroke(); break;
    default: break;
  }
  return ctx.createPattern(t, 'repeat');
}

/** Vertikalna ravan odsecanja kroz prvo i poslednje teme preseka. */
export function sectionClipPlane(sec, terrain, flip = false) {
  const a = sec.vertices[0], b = sec.vertices[sec.vertices.length - 1];
  const ax = a.E - terrain.E0, az = -(a.N - terrain.N0), bx = b.E - terrain.E0, bz = -(b.N - terrain.N0);
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
  const n = new THREE.Vector3(-dz / L, 0, dx / L).multiplyScalar(flip ? -1 : 1);
  return new THREE.Plane(n, -(n.x * ax + n.z * az));
}
