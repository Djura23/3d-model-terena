import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Viewer } from './scene/viewer.js';
import { Terrain } from './core/terrain.js';
import { GeologyModel } from './core/geology.js';
import { buildTerrainMesh, setTerrainOpacity, niceStep } from './scene/terrainMesh.js';
import { buildProbes, updateLabelLift, setHighlight, qcColor, rgbCss } from './scene/probes.js';
import { buildBlockModel, setBlockExplode, setBlockOpacity } from './scene/blockModel.js';
import { SectionDrawTool, buildCurtain, sectionClipPlane } from './section/sectionTool.js';
import { computeSection } from './section/compute.js';
import { renderProfileSVG, interpTerrain, interpStack } from './section/profileSvg.js';
import { cptChart, dpshChart, boreholeLog } from './ui/charts.js';
import { SBT_ZONES, sbtIntervals } from './core/cpt.js';
import { DPSH_CLASSES, dpshClass, dpshIntervals } from './core/dpsh.js';
import { generateSampleProject } from './data/sample.js';
import { importTable, emptyStaging, projectToStaging, stagingToProject, exportCSVs, download, parseTable, detectKind } from './data/io.js';

// ------------------------------------------------------------------ pomoćne
const $ = (id) => document.getElementById(id);
const f = (v, d = 2) => (v != null && isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');
const fc = (v, d = 2) => {
  // koordinata sa razmakom hiljada: 7 456 123,45
  if (!isFinite(v)) return '–';
  const [i, dec] = Math.abs(v).toFixed(d).split('.');
  return (v < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (dec ? ',' + dec : '');
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND_NAME = { bh: 'Bušotina', cpt: 'CPT / CPTu', dpsh: 'DPSH-B', unit: 'Litološka jedinica (interpretacija)' };

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'warn' || type === 'err' ? 9000 : 4500);
}

// ------------------------------------------------------------------ stanje
const S = {
  project: null, terrain: null, geology: null, terrainMesh: null, probes: null, block: null,
  sections: [], active: null, selected: null, hovered: null,
  clip: { on: false, flip: false }, isDemo: false,
  layers: {}, hiddenUnits: new Set(),
};
const viewer = new Viewer($('viewport'));
const content = new THREE.Group();
content.name = 'sadrzaj';
viewer.world.add(content);
const curtains = new THREE.Group();
curtains.name = 'preseci';
viewer.world.add(curtains);
const fx = new THREE.Group(); // marker preseka, merenje
viewer.world.add(fx);

const ve = () => +$('ve').value;

// ------------------------------------------------------------------ učitavanje projekta
function loadProject(p, { fit = true } = {}) {
  let terrain;
  try {
    terrain = new Terrain(p.terrain.points);
  } catch (e) {
    toast('Teren nije moguće formirati: ' + e.message, 'err');
    return false;
  }
  // čišćenje
  disposeTree(content);
  content.clear();
  disposeTree(curtains);
  curtains.clear();
  hoverMarker.visible = false;
  closeInfo();

  S.project = p;
  S.terrain = terrain;
  drawTool.terrain = terrain;
  measure.reset();
  for (const t of [...p.boreholes, ...p.cpts, ...p.dpsh]) {
    if (t.Z == null || !isFinite(t.Z)) {
      t.Z = +terrain.elevationAt(t.E, t.N).toFixed(2);
      if (!isFinite(t.Z)) toast(`${t.id}: van obuhvata terena, kota nepoznata`, 'warn');
    }
  }
  S.geology = new GeologyModel(p, terrain);

  S.terrainMesh = buildTerrainMesh(terrain);
  content.add(S.terrainMesh);
  buildProbeLayer();
  buildBlockLayer();

  // izohipse — ponuđene ekvidistance
  const rel = Math.max(terrain.extent.relief, 0.5);
  const opts = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50].filter((v) => v >= rel / 80 && v <= rel / 2);
  const cur = S.terrainMesh.userData.uniforms.uInterval.value;
  if (!opts.includes(cur)) opts.push(cur);
  opts.sort((a, b) => a - b);
  $('contourInt').innerHTML = opts.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${f(v, v < 1 ? 2 : 0)} m (deblje na ${f(v * 5, v * 5 < 1 ? 2 : 0)} m)</option>`).join('');

  // preseci iz projekta
  S.sections = (p.sections || []).map((s) => ({ ...s }));
  S.active = null;
  S.sections.forEach(buildSectionGeometry);
  $('drawer').hidden = true;

  $('projName').value = p.name || 'Projekat';
  $('projCrs').textContent = `${p.crs || ''} · visine: ${p.heightRef || 'mnv'} · ${p.boreholes.length} buš. · ${p.cpts.length} CPT · ${p.dpsh.length} DPSH-B`;
  renderLegends();
  renderProbeList();
  renderSectionList();
  applyAll();
  if (fit) homeView(false);
  return true;
}

function buildProbeLayer() {
  if (S.probes) for (const g of Object.values(S.probes.groups)) { disposeTree(g); content.remove(g); }
  S.probes = buildProbes(S.project, S.terrain, { symbolScale: +$('symScale').value, cptColor: $('cptColor').value });
  for (const g of Object.values(S.probes.groups)) content.add(g);
  for (const l of S.probes.groups.labels.children) {
    l.element.addEventListener('click', (e) => { e.stopPropagation(); select(l.userData.item); });
    l.element.addEventListener('dblclick', (e) => { e.stopPropagation(); flyToItem(l.userData.item); });
  }
  applyLayerVisibility();
  updateLabelLift(S.probes.groups.labels, ve(), S.probes.R * 2.6);
  markSectionLabels();
}

function buildBlockLayer() {
  if (S.block) { disposeTree(S.block.group); content.remove(S.block.group); }
  S.block = buildBlockModel(S.geology, S.terrain, S.project);
  content.add(S.block.group);
  setBlockExplode(S.block, +$('explode').value);
  setBlockOpacity(S.block, +$('blockOp').value);
  applyClip();
  applyLayerVisibility();
}

function disposeTree(o) {
  o.traverse((c) => {
    c.geometry?.dispose?.();
    const ms = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    ms.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
    if (c.isCSS2DObject) c.element.remove();
  });
}

// ------------------------------------------------------------------ vidljivost i podešavanja
function readLayers() {
  document.querySelectorAll('[data-layer]').forEach((el) => { S.layers[el.dataset.layer] = el.checked; });
}

function applyLayerVisibility() {
  readLayers();
  const L = S.layers;
  if (S.terrainMesh) {
    S.terrainMesh.visible = L.terrain;
    const u = S.terrainMesh.userData.uniforms;
    u.uContourOn.value = L.contours ? 1 : 0;
    u.uGridOn.value = L.grid ? 1 : 0;
  }
  if (S.probes) {
    const g = S.probes.groups;
    g.bh.visible = L.bh; g.cpt.visible = L.cpt; g.dpsh.visible = L.dpsh; g.gwl.visible = L.gwl;
    const on = { bh: L.bh, cpt: L.cpt, dpsh: L.dpsh };
    for (const it of S.probes.items) if (it.item.label) it.item.label.visible = L.labels && on[it.kind];
    for (const m of g.gwl.children) {
      const k = S.probes.items.find((i) => i.item === m.userData.item)?.kind;
      m.visible = !k || on[k];
    }
  }
  if (S.block) {
    S.block.group.visible = L.block;
    const terrOp = +$('terrOp').value;
    for (const u of S.block.units) {
      u.group.visible = !S.hiddenUnits.has(u.soil.code);
      // krovina prve jedinice = teren; prikazuje se samo kad teren ne pokriva
      if (u.top) u.top.visible = !L.terrain || terrOp < 0.999 || +$('explode').value > 0;
    }
  }
  curtains.visible = L.curtain;
  for (const s of S.sections) s.labelsObj?.forEach((o) => (o.visible = L.curtain));
}

function applyAll() {
  const v = ve();
  viewer.setVerticalExaggeration(v);
  $('veOut').textContent = f(v, v % 1 ? 1 : 0) + '×';
  if (S.terrainMesh) {
    setTerrainOpacity(S.terrainMesh, +$('terrOp').value);
    S.terrainMesh.userData.uniforms.uInterval.value = +$('contourInt').value || S.terrainMesh.userData.uniforms.uInterval.value;
  }
  $('terrOpOut').textContent = Math.round(+$('terrOp').value * 100) + '%';
  $('blockOpOut').textContent = Math.round(+$('blockOp').value * 100) + '%';
  $('explodeOut').textContent = f(+$('explode').value, 1) + ' m';
  $('symOut').textContent = f(+$('symScale').value, 1) + '×';
  if (S.probes) updateLabelLift(S.probes.groups.labels, v, S.probes.R * 2.6);
  // markeri bez deformacije
  fx.traverse((o) => { if (o.userData.keepRound) o.scale.y = 1 / v; });
  drawTool.group.traverse((o) => { if (o.isMesh && o.geometry?.type === 'SphereGeometry') o.scale.y = 1 / v; });
  applyLayerVisibility();
}

document.querySelectorAll('[data-layer]').forEach((el) => el.addEventListener('change', applyLayerVisibility));
$('ve').addEventListener('input', applyAll);
$('terrOp').addEventListener('input', applyAll);
$('contourInt').addEventListener('change', applyAll);
$('blockOp').addEventListener('input', () => { if (S.block) setBlockOpacity(S.block, +$('blockOp').value); applyAll(); });
$('explode').addEventListener('input', () => { if (S.block) setBlockExplode(S.block, +$('explode').value); applyAll(); });
$('symScale').addEventListener('change', () => { buildProbeLayer(); applyAll(); });
$('symScale').addEventListener('input', () => { $('symOut').textContent = f(+$('symScale').value, 1) + '×'; });
$('cptColor').addEventListener('change', () => { buildProbeLayer(); renderLegends(); });

// ------------------------------------------------------------------ legende i liste
function renderLegends() {
  const p = S.project;
  $('soilLegend').innerHTML = p.soils.map((s) => `
    <div class="row ${S.hiddenUnits.has(s.code) ? 'off' : ''}" data-code="${esc(s.code)}" title="${esc(s.name)}">
      <span class="sw" style="background:${s.color}"></span><span class="code">${esc(s.code)}</span><span class="nm">${esc(s.name.replace(/^\S+\s+—\s+/, ''))}</span>
    </div>`).join('') || '<span class="muted">Nema podataka o slojevima.</span>';
  $('soilLegend').querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => {
    const c = r.dataset.code;
    S.hiddenUnits.has(c) ? S.hiddenUnits.delete(c) : S.hiddenUnits.add(c);
    r.classList.toggle('off');
    applyLayerVisibility();
  }));
  if ($('cptColor').value === 'sbt') {
    $('sbtLegend').innerHTML = Object.entries(SBT_ZONES).filter(([k]) => k >= 2).map(([k, z]) => `<div class="row"><span class="sw" style="background:${z.color}"></span><span class="code">${k}</span><span class="nm">${z.name}</span></div>`).join('') +
      '<div class="note">Poluprečnik CPT stuba ~ log q<sub>c</sub> (0,1–40 MPa).</div>';
  } else {
    $('sbtLegend').innerHTML = [0.3, 1, 3, 10, 30].map((q) => `<div class="row"><span class="sw" style="background:${rgbCss(qcColor(q))}"></span><span class="nm">q<sub>c</sub> = ${f(q, q < 1 ? 1 : 0)} MPa</span></div>`).join('');
  }
  let prev = 0;
  $('dpshLegend').innerHTML = DPSH_CLASSES.map((c) => {
    const r = `<div class="row"><span class="sw" style="background:${c.color}"></span><span class="code">${prev}${isFinite(c.max) ? '–' + c.max : '+'}</span><span class="nm">${c.name}</span></div>`;
    prev = c.max; return r;
  }).join('') + '<div class="note">N20 ekvivalent (N10 × 2). Klase su indikativne.</div>';
}

function renderProbeList() {
  const q = $('probeFilter').value.trim().toLowerCase();
  const all = [
    ...S.project.boreholes.map((i) => ['bh', i]), ...S.project.cpts.map((i) => ['cpt', i]), ...S.project.dpsh.map((i) => ['dpsh', i]),
  ].filter(([, i]) => !q || i.id.toLowerCase().includes(q));
  all.sort((a, b) => a[1].id.localeCompare(b[1].id, 'sr', { numeric: true }));
  $('probeCount').textContent = `(${all.length})`;
  $('probeList').innerHTML = all.map(([k, i]) => {
    const dep = k === 'bh' ? i.depth : i.data?.length ? i.data[i.data.length - 1].z : 0;
    return `<div class="row ${S.selected === i ? 'sel' : ''}" data-id="${esc(i.id)}" title="Klik: detalji · dvoklik: prelet"><i class="sym sym-${k}"></i><span>${esc(i.id)}</span><span class="meta">${f(i.Z, 2)} · ${f(dep, 1)} m</span></div>`;
  }).join('');
  $('probeList').querySelectorAll('.row').forEach((r) => {
    const item = findItem(r.dataset.id);
    r.addEventListener('click', () => select(item));
    r.addEventListener('dblclick', () => flyToItem(item));
  });
}
$('probeFilter').addEventListener('input', renderProbeList);

const findItem = (id) => [...S.project.boreholes, ...S.project.cpts, ...S.project.dpsh].find((i) => i.id === id);
const kindOf = (item) => (S.project.boreholes.includes(item) ? 'bh' : S.project.cpts.includes(item) ? 'cpt' : 'dpsh');

// ------------------------------------------------------------------ kamera
function modelBox() {
  const t = S.terrain, b = t.bounds;
  const bottom = S.geology?.valid && S.layers.block ? S.geology.base : b.minZ - 2;
  return new THREE.Box3(
    new THREE.Vector3(b.minE - t.E0, bottom - t.Z0, -(b.maxN - t.N0)),
    new THREE.Vector3(b.maxE - t.E0, b.maxZ - t.Z0, -(b.minN - t.N0))
  );
}
function homeView(animate = true) { viewer.frame(modelBox(), { animate }); }
function topView() {
  const box = modelBox(), c = box.getCenter(new THREE.Vector3());
  c.y *= ve();
  const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const dist = size / (2 * Math.tan((viewer.camera.fov * Math.PI) / 360)) * 1.15;
  viewer.flyTo(new THREE.Vector3(c.x, c.y + dist, c.z + 0.001), c);
}
function sideView() {
  const box = modelBox(), c = box.getCenter(new THREE.Vector3());
  c.y *= ve();
  const size = box.max.x - box.min.x;
  const dist = size / (2 * Math.tan((viewer.camera.fov * Math.PI) / 360)) * 1.1;
  viewer.flyTo(new THREE.Vector3(c.x, c.y + dist * 0.08, c.z + dist), c);
}
function flyToItem(item) {
  if (!item) return;
  select(item);
  const p = new THREE.Vector3(item.E - S.terrain.E0, ((item._z0 ?? item.Z) - S.terrain.Z0) * ve(), -(item.N - S.terrain.N0));
  const depth = kindOf(item) === 'bh' ? item.depth : item.data[item.data.length - 1]?.z || 10;
  const target = p.clone().add(new THREE.Vector3(0, (-depth * ve()) / 2, 0));
  const dist = Math.max(30, depth * ve() * 1.6);
  const dir = viewer.camera.position.clone().sub(viewer.controls.target).normalize();
  viewer.flyTo(target.clone().add(dir.multiplyScalar(dist)), target);
}
$('btnHome').onclick = () => homeView();
$('btnTop').onclick = topView;
$('btnSide').onclick = sideView;
$('compass').onclick = () => {
  const t = viewer.controls.target, cam = viewer.camera.position;
  const d = cam.distanceTo(t), h = cam.y - t.y, horiz = Math.sqrt(Math.max(d * d - h * h, 1));
  viewer.flyTo(new THREE.Vector3(t.x, cam.y, t.z + horiz), t.clone());
};
viewer.onFrame(() => {
  $('compass').firstElementChild.style.transform = `rotate(${-viewer.azimuth}deg)`;
});

// ------------------------------------------------------------------ izbor i info panel
function select(item) {
  if (S.selected?.label) S.selected.label.element.classList.remove('sel');
  const prevObj = S.probes?.items.find((i) => i.item === S.selected)?.object;
  if (prevObj) setHighlight(prevObj, false);
  S.selected = item;
  if (!item) { closeInfo(); return; }
  item.label?.element.classList.add('sel');
  const obj = S.probes.items.find((i) => i.item === item)?.object;
  if (obj) setHighlight(obj, true);
  showInfo(item, kindOf(item));
  document.querySelectorAll('#probeList .row').forEach((r) => r.classList.toggle('sel', r.dataset.id === item.id));
}

function closeInfo() {
  $('infopanel').hidden = true;
  if (S.selected) {
    S.selected.label?.element.classList.remove('sel');
    const o = S.probes?.items.find((i) => i.item === S.selected)?.object;
    if (o) setHighlight(o, false);
  }
  S.selected = null;
  document.querySelectorAll('#probeList .row.sel').forEach((r) => r.classList.remove('sel'));
}
$('infoClose').onclick = closeInfo;

function showInfo(item, kind, markerDepth) {
  $('infopanel').hidden = false;
  $('infoKind').textContent = KIND_NAME[kind];
  $('infoTitle').textContent = item.id;
  const z0 = item._z0 ?? item.Z;
  const tz = S.terrain.elevationAt(item.E, item.N);
  const common = `
    <dl class="kv">
      <dt>Y (istok)</dt><dd>${fc(item.E, 2)}</dd>
      <dt>X (sever)</dt><dd>${fc(item.N, 2)}</dd>
      <dt>Kota ušća</dt><dd>${f(z0, 2)} ${esc(S.project.heightRef || 'mnv')}</dd>
      ${isFinite(tz) && Math.abs(tz - z0) > 0.05 ? `<dt>Kota terena (DMT)</dt><dd>${f(tz, 2)} <span class="muted">(Δ ${f(z0 - tz, 2)})</span></dd>` : ''}
      ${item.gwl != null && isFinite(item.gwl) ? `<dt>NPV</dt><dd>${f(item.gwl, 2)} m (kota ${f(z0 - item.gwl, 2)})</dd>` : ''}
      ${item.date ? `<dt>Datum</dt><dd>${esc(item.date)}</dd>` : ''}
      ${item.method || item.cone || item.device ? `<dt>Oprema</dt><dd>${esc(item.method || item.cone || item.device)}</dd>` : ''}
    </dl>`;
  let body = common;
  if (kind === 'bh') {
    body += `<dl class="kv"><dt>Dubina</dt><dd>${f(item.depth, 1)} m (dno ${f(z0 - item.depth, 2)})</dd></dl>`;
    body += `<h4>Litološki profil</h4>${boreholeLog(item, S.project, { width: 345, marker: markerDepth })}`;
    body += `<h4>Slojevi</h4><table><tr><th>od–do [m]</th><th>kota dna</th><th>opis</th></tr>${item.layers.map((l) => {
      const s = S.project.soils.find((q) => q.code === l.code);
      return `<tr><td class="num">${f(l.top, 1)}–${f(l.bottom, 1)}</td><td class="num">${f(z0 - l.bottom, 2)}</td><td><span class="sw" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${s?.color}"></span> <b>${esc(l.code)}</b> ${esc(l.description || s?.name || '')}</td></tr>`;
    }).join('')}</table>`;
  } else if (kind === 'cpt') {
    const pr = item._proc || [];
    const last = pr[pr.length - 1];
    const maxq = Math.max(...pr.map((p) => p.qc));
    body += `<div class="chips"><span class="chip">dubina ${f(last?.z, 2)} m</span><span class="chip">q<sub>c,max</sub> ${f(maxq, 1)} MPa</span><span class="chip">${pr.length} merenja</span>${pr.some((p) => p.u2) ? '<span class="chip">CPTu</span>' : ''}</div>`;
    body += cptChart(item, { width: 350, height: 520, marker: markerDepth });
    body += `<h4>SBTn intervali (≥ 0,3 m)</h4><table><tr><th>od–do [m]</th><th>zona</th><th class="num">q<sub>t</sub> sr.</th><th class="num">I<sub>c</sub> sr.</th></tr>${sbtIntervals(pr, 0.3).map((iv) => {
      const pts = pr.filter((p) => p.z > iv.top && p.z <= iv.bottom);
      const avg = (k) => pts.reduce((s, p) => s + p[k], 0) / Math.max(1, pts.length);
      return `<tr><td class="num">${f(iv.top, 2)}–${f(iv.bottom, 2)}</td><td><span class="sw" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${SBT_ZONES[iv.zone]?.color}"></span> ${iv.zone} ${SBT_ZONES[iv.zone]?.name || ''}</td><td class="num">${f(avg('qt'), 2)}</td><td class="num">${f(avg('ic'), 2)}</td></tr>`;
    }).join('')}</table>`;
    body += `<div class="note">Normalizacija po Robertson (2009): q<sub>t</sub> = q<sub>c</sub> + u<sub>2</sub>(1−a), a = ${f(item.area_ratio ?? 0.8, 2)}; γ po Robertson &amp; Cabal (2010); NPV ${item.gwl != null ? f(item.gwl, 2) + ' m' : 'nije zadat (pretpostavljeno na površini)'}. Isprekidano: hidrostatički u<sub>0</sub>.</div>`;
  } else if (kind === 'dpsh') {
    const iv = dpshIntervals(item);
    body += `<div class="chips"><span class="chip">dubina ${f(iv[iv.length - 1]?.bottom, 1)} m</span><span class="chip">zapis ${item.nType || 'N20'}</span><span class="chip">max ${Math.max(...iv.map((s) => s.n))} udaraca</span></div>`;
    body += dpshChart(item, { width: 345, height: 480, marker: markerDepth });
    // srednje vrednosti po slojevima interpretiranog modela
    if (S.geology?.valid) {
      const col = S.geology.columnAtLocal(item.E - S.terrain.E0, item.N - S.terrain.N0, z0);
      const rows = col.map((c) => {
        const inside = iv.filter((s) => z0 - (s.top + s.bottom) / 2 <= c.top && z0 - (s.top + s.bottom) / 2 > c.bottom);
        if (!inside.length) return '';
        const avg = inside.reduce((s, q) => s + q.n20, 0) / inside.length;
        return `<tr><td><b>${esc(c.code)}</b></td><td class="num">${f(z0 - c.top, 1)}–${f(Math.min(z0 - c.bottom, iv[iv.length - 1].bottom), 1)}</td><td class="num">${f(avg, 1)}</td><td>${dpshClass(avg).name}</td></tr>`;
      }).join('');
      if (rows) body += `<h4>N20 ekv. po jedinicama modela</h4><table><tr><th>jed.</th><th>dubina [m]</th><th class="num">N20 sr.</th><th>klasa</th></tr>${rows}</table>`;
    }
  }
  $('infoBody').innerHTML = body;
}

// ------------------------------------------------------------------ hover / status / klik u 3D
let hoverPending = null, downPos = null;
const el3d = viewer.renderer.domElement;
el3d.addEventListener('pointermove', (e) => {
  if (hoverPending) { hoverPending = e; return; }
  hoverPending = e;
  requestAnimationFrame(() => { const ev = hoverPending; hoverPending = null; onHover(ev); });
});
el3d.addEventListener('pointerleave', () => { $('hoverTip').hidden = true; setHover(null); });
el3d.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
el3d.addEventListener('pointerup', (e) => {
  if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5 || e.button !== 0) return;
  if (drawTool.active) return;
  if (measure.active) { measure.click(e); return; }
  const h = pickAt(e);
  if (h?.item) select(h.item), showInfo(h.item, h.kind, h.depth);
  else if (h?.kind === 'curtain') openSection(h.section);
  else if (h?.kind === 'unit') showUnitInfo(h);
});
el3d.addEventListener('dblclick', (e) => {
  if (drawTool.active || measure.active) return;
  const h = pickAt(e);
  if (h?.item) flyToItem(h.item);
  else if (h?.point) {
    // dvoklik na teren: centriraj pogled na tačku
    const target = h.worldPoint;
    const off = viewer.camera.position.clone().sub(viewer.controls.target).multiplyScalar(0.6);
    viewer.flyTo(target.clone().add(off), target);
  }
});

function pickAt(e) {
  if (!S.terrain) return null;
  viewer.setPointer(e);
  const targets = [];
  if (S.probes) targets.push(S.probes.groups.bh, S.probes.groups.cpt, S.probes.groups.dpsh);
  if (curtains.visible) targets.push(curtains);
  if (S.terrainMesh?.visible) targets.push(S.terrainMesh);
  if (S.block?.group.visible) targets.push(S.block.group);
  const hit = viewer.pick(targets);
  if (!hit) return null;
  const local = viewer.world.worldToLocal(hit.point.clone());
  // pomeraj eksplodiranog prikaza
  let o = hit.object, ud = null, unitOffset = 0;
  while (o) {
    if (o.userData?.kind && !ud) ud = o.userData;
    if (o.userData?.kind === 'unit' && o.isGroup) unitOffset = o.position.y;
    o = o.parent;
  }
  const point = { E: local.x + S.terrain.E0, N: -local.z + S.terrain.N0, Z: local.y - unitOffset + S.terrain.Z0 };
  const res = { point, worldPoint: hit.point.clone(), kind: ud?.kind };
  if (ud?.item && ['bh', 'cpt', 'dpsh'].includes(ud.kind)) {
    res.item = ud.item;
    res.kind = ud.kind;
    res.depth = Math.max(0, (ud.item._z0 ?? ud.item.Z) - point.Z);
    res.layer = ud.layer;
  } else if (ud?.kind === 'unit') {
    res.soil = ud.soil;
  } else if (ud?.kind === 'curtain') {
    res.section = S.sections.find((s) => s.curtain?.userData.mesh === hit.object);
  }
  return res;
}

function setHover(item) {
  if (S.hovered === item) return;
  const old = S.probes?.items.find((i) => i.item === S.hovered)?.object;
  if (old && S.hovered !== S.selected) setHighlight(old, false);
  S.hovered = item;
  const obj = S.probes?.items.find((i) => i.item === item)?.object;
  if (obj) setHighlight(obj, true);
  el3d.style.cursor = item && !drawTool.active && !measure.active ? 'pointer' : '';
}

function onHover(e) {
  if (!e || !S.terrain) return;
  const h = pickAt(e);
  const tip = $('hoverTip');
  if (!h) { $('status').innerHTML = '<span class="muted">Van terena</span>'; tip.hidden = true; setHover(null); return; }
  const p = h.point;
  const tz = S.terrain.elevationAt(p.E, p.N);
  let s = `Y <b>${fc(p.E, 2)}</b>  X <b>${fc(p.N, 2)}</b>  Z <b>${f(p.Z, 2)}</b>`;
  if (h.kind !== 'terrain' && isFinite(tz)) s += `  dubina <b>${f(Math.max(0, tz - p.Z), 2)} m</b>`;
  $('status').innerHTML = s;
  if (measure.active) measure.move(h);
  if (h.item && !drawTool.active) {
    setHover(h.item);
    tip.hidden = false;
    tip.innerHTML = tipFor(h);
    const r = $('viewport').getBoundingClientRect();
    tip.style.left = e.clientX - r.left + 'px';
    tip.style.top = e.clientY - r.top + 'px';
  } else if (h.kind === 'unit' && !drawTool.active) {
    setHover(null);
    tip.hidden = false;
    tip.innerHTML = `<span class="sw" style="background:${h.soil.color}"></span><b>${esc(h.soil.code)}</b> ${esc(h.soil.name)}<br><span class="muted">interpretirani model · kota ${f(p.Z, 2)}</span>`;
    const r = $('viewport').getBoundingClientRect();
    tip.style.left = e.clientX - r.left + 'px';
    tip.style.top = e.clientY - r.top + 'px';
  } else { tip.hidden = true; setHover(null); }
}

function tipFor(h) {
  const it = h.item, d = h.depth;
  let s = `<b>${esc(it.id)}</b> <span class="muted">${KIND_NAME[h.kind]}</span><br>dubina ${f(d, 2)} m · kota ${f(h.point.Z, 2)}`;
  if (h.kind === 'bh') {
    const l = h.layer || it.layers.find((q) => d >= q.top && d <= q.bottom);
    if (l) {
      const so = S.project.soils.find((q) => q.code === l.code);
      s += `<br><span class="sw" style="background:${so?.color}"></span><b>${esc(l.code)}</b> ${f(l.top, 1)}–${f(l.bottom, 1)} m<br><span class="muted">${esc(l.description || so?.name || '')}</span>`;
    }
  } else if (h.kind === 'cpt' && it._proc?.length) {
    const p = nearest(it._proc, d);
    s += `<br>q<sub>c</sub> ${f(p.qc, 2)} MPa · f<sub>s</sub> ${f(p.fs, 1)} kPa · R<sub>f</sub> ${f(p.rf, 1)}%<br>I<sub>c</sub> ${f(p.ic, 2)} · <span class="sw" style="background:${SBT_ZONES[p.zone]?.color}"></span>${SBT_ZONES[p.zone]?.name || ''}`;
  } else if (h.kind === 'dpsh') {
    const iv = dpshIntervals(it).find((q) => d >= q.top - 1e-6 && d <= q.bottom + 1e-6);
    if (iv) s += `<br>${it.nType || 'N20'} = <b>${iv.n}</b> (${f(iv.top, 1)}–${f(iv.bottom, 1)} m)<br><span class="sw" style="background:${dpshClass(iv.n20).color}"></span>${dpshClass(iv.n20).name}`;
  }
  return s;
}

const nearest = (arr, z) => arr.reduce((b, p) => (Math.abs(p.z - z) < Math.abs(b.z - z) ? p : b), arr[0]);

function showUnitInfo(h) {
  $('infopanel').hidden = false;
  $('infoKind').textContent = KIND_NAME.unit;
  $('infoTitle').textContent = h.soil.code;
  const col = S.geology.columnAtLocal(h.point.E - S.terrain.E0, h.point.N - S.terrain.N0);
  const wells = S.geology.wells.filter((w) => w.status[S.geology.unitIndex.get(h.soil.code)] !== 'none');
  const k = S.geology.unitIndex.get(h.soil.code);
  $('infoBody').innerHTML = `
    <p><span class="sw" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${h.soil.color};vertical-align:-2px"></span> ${esc(h.soil.name)}</p>
    <h4>Stub modela u tački</h4>
    <dl class="kv"><dt>Y / X</dt><dd>${fc(h.point.E, 1)} / ${fc(h.point.N, 1)}</dd></dl>
    <table><tr><th>jedinica</th><th class="num">krovina</th><th class="num">podina</th><th class="num">debljina</th></tr>
    ${col.map((c) => `<tr${c.code === h.soil.code ? ' style="font-weight:650"' : ''}><td>${esc(c.code)}</td><td class="num">${f(c.top, 2)}</td><td class="num">${f(c.bottom, 2)}</td><td class="num">${f(c.top - c.bottom, 2)}</td></tr>`).join('')}</table>
    <h4>Debljine u bušotinama</h4>
    <table><tr><th>bušotina</th><th class="num">debljina [m]</th><th>status</th></tr>
    ${wells.map((w) => `<tr><td>${esc(w.id)}</td><td class="num">${f(w.thk[k], 2)}</td><td>${w.status[k] === 'known' ? 'probijena' : 'bušotina završena u jedinici (≥)'}</td></tr>`).join('')}</table>
    <div class="note">Model je interpretacija: debljine jedinica interpolirane su IDW metodom (p = 2) između bušotina i slagane od terena naniže.</div>`;
}

// ------------------------------------------------------------------ preseci
const drawTool = new SectionDrawTool(viewer, () => S.terrainMesh, null, {
  onFinish: (pts) => {
    setDrawUI(false);
    const n = S.sections.length;
    const letter = String.fromCharCode(65 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : '');
    const sec = { id: 'sec' + Date.now(), name: `Presek ${letter}–${letter}'`, labels: [letter, letter + "'"], vertices: pts, buffer: +$('secBuffer').value || 20 };
    S.sections.push(sec);
    buildSectionGeometry(sec);
    renderSectionList();
    openSection(sec);
  },
  onCancel: () => setDrawUI(false),
  onChange: (pts, L) => {
    const len = L ?? pts.reduce((s, p, i) => (i ? s + Math.hypot(p.E - pts[i - 1].E, p.N - pts[i - 1].N) : 0), 0);
    $('drawLen').textContent = pts.length ? `${pts.length} tem. · ${f(len, 1)} m` : '';
  },
});

function setDrawUI(on) {
  $('btnDraw').classList.toggle('on', on);
  $('btnDraw').querySelector('span').textContent = on ? 'Završi (Enter)' : 'Nacrtaj presek';
  $('drawHint').hidden = !on;
  $('viewport').classList.toggle('drawing', on);
  if (!on) $('drawLen').textContent = '';
}
function startDraw() {
  if (!S.terrain) return;
  if (drawTool.active) { drawTool.finish(); return; }
  measure.stop();
  closeInfo();
  setDrawUI(true);
  drawTool.start();
}
$('btnDraw').onclick = startDraw;
$('btnDraw2').onclick = startDraw;

function buildSectionGeometry(sec) {
  if (sec.curtain) { disposeTree(sec.curtain); curtains.remove(sec.curtain); }
  sec.data = computeSection(sec.vertices, { terrain: S.terrain, geology: S.geology, project: S.project, buffer: sec.buffer ?? 20 });
  if (!sec.data) return;
  sec.curtain = buildCurtain(sec.data, S.terrain, S.project, { labels: sec.labels });
  sec.labelsObj = sec.curtain.children.filter((c) => c.isCSS2DObject);
  curtains.add(sec.curtain);
}
viewer.onFrame(() => {
  const r = el3d;
  curtains.traverse((o) => { if (o.material?.isLineMaterial) o.material.resolution.set(r.width, r.height); });
  fx.traverse((o) => { if (o.material?.isLineMaterial) o.material.resolution.set(r.width, r.height); });
});

function renderSectionList() {
  const host = $('sectionList');
  if (!S.sections.length) { host.innerHTML = '<div class="empty">Nema preseka. Klikni „Nacrtaj presek” i zadaj temena mišem po terenu.</div>'; return; }
  host.innerHTML = S.sections.map((s) => `<div class="row ${S.active === s ? 'sel' : ''}" data-id="${s.id}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" stroke-width="2.4"><path d="M3 17l6-6 4 4 8-8"/></svg>
      <span>${esc(s.name)}</span><span class="muted">${f(s.data?.L, 0)} m</span>
      <button class="del" title="Obriši presek">✕</button></div>`).join('');
  host.querySelectorAll('.row').forEach((r) => {
    const sec = S.sections.find((s) => s.id === r.dataset.id);
    r.addEventListener('click', () => openSection(sec));
    r.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (sec.curtain) { disposeTree(sec.curtain); curtains.remove(sec.curtain); }
      S.sections = S.sections.filter((s) => s !== sec);
      if (S.active === sec) { S.active = null; $('drawer').hidden = true; S.clip.on = false; applyClip(); }
      renderSectionList();
      markSectionLabels();
      syncProjectSections();
    });
  });
  $('secSelect').innerHTML = S.sections.map((s) => `<option value="${s.id}" ${S.active === s ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  syncProjectSections();
}

function syncProjectSections() {
  S.project.sections = S.sections.map((s) => ({ id: s.id, name: s.name, labels: s.labels, vertices: s.vertices, buffer: s.buffer }));
}

function openSection(sec) {
  if (!sec?.data) return;
  S.active = sec;
  $('drawer').hidden = false;
  $('secBuffer').value = sec.buffer ?? 20;
  $('btnClip').disabled = false;
  renderSectionList();
  markSectionLabels();
  applyClip();
  requestAnimationFrame(renderProfile);
}
$('secSelect').addEventListener('change', () => openSection(S.sections.find((s) => s.id === $('secSelect').value)));
$('drawerClose').onclick = () => {
  $('drawer').hidden = true; S.active = null; S.clip.on = false; applyClip();
  $('btnClip').disabled = true; renderSectionList(); markSectionLabels(); hoverMarker.visible = false;
};
$('drawerMax').onclick = () => { $('drawer').classList.toggle('max'); $('drawer').style.height = ''; requestAnimationFrame(renderProfile); };
$('secBuffer').addEventListener('change', () => {
  if (!S.active) return;
  S.active.buffer = Math.max(0, +$('secBuffer').value || 0);
  buildSectionGeometry(S.active);
  markSectionLabels();
  syncProjectSections();
  renderProfile();
});
['secVe', 'secGeo', 'secCptScale', 'secDpScale'].forEach((id) => $(id).addEventListener('input', () => renderProfile()));

function markSectionLabels() {
  if (!S.probes) return;
  const ids = new Set(S.active?.data?.probes.map((p) => p.item.id) || []);
  for (const l of S.probes.groups.labels.children) l.element.classList.toggle('in-sec', ids.has(l.userData.item.id));
}

let profileLayout = null;
function renderProfile() {
  const sec = S.active;
  if (!sec?.data) return;
  const host = $('profileHost');
  const veSel = $('secVe').value;
  const { svg, layout } = renderProfileSVG(sec.data, S.project, {
    width: host.clientWidth - 2, height: host.clientHeight - 2, ve: veSel === 'auto' ? 'auto' : +veSel,
    cptScale: +$('secCptScale').value, dpshScale: +$('secDpScale').value, showGeo: $('secGeo').checked,
    title: sec.name.replace(/\s+\S+–\S+$/, ''), labels: sec.labels, buffer: sec.buffer,
  });
  host.innerHTML = svg + '<div class="profile-cross" id="pcross" hidden><div class="v"></div><div class="h"></div></div>';
  profileLayout = layout;
  const svgEl = host.querySelector('svg');
  svgEl.addEventListener('mousemove', onProfileHover);
  svgEl.addEventListener('mouseleave', () => { $('pcross').hidden = true; hoverMarker.visible = false; $('secReadout').textContent = ''; });
  svgEl.addEventListener('click', (e) => {
    const g = e.target.closest('.probe');
    if (g) { const it = findItem(g.dataset.id); if (it) select(it); }
  });
}
new ResizeObserver(() => { if (!$('drawer').hidden) renderProfile(); }).observe($('profileHost'));

// marker u 3D koji prati kursor u profilu
const hoverMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false }));
hoverMarker.renderOrder = 30;
hoverMarker.visible = false;
hoverMarker.userData.keepRound = true;
fx.add(hoverMarker);

function onProfileHover(e) {
  const L = profileLayout, sec = S.active?.data;
  if (!L || !sec) return;
  const svgEl = e.currentTarget;
  const r = svgEl.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const s = (mx - L.M.l) / L.sx, z = L.zTop - (my - L.M.t) / L.sy;
  if (s < 0 || s > sec.L || my < L.M.t || my > L.M.t + L.plotH) { $('pcross').hidden = true; hoverMarker.visible = false; return; }
  const zt = interpTerrain(sec, s);
  let txt = `st. ${f(s, 1)} m · kota ${f(z, 2)}`;
  if (z <= zt) {
    txt += ` · dub. ${f(zt - z, 2)} m`;
    const st = interpStack(sec, s);
    if (st && $('secGeo').checked) for (let k = 0; k < sec.K; k++) if (z <= st[k] && z > st[k + 1]) { txt += ` · ${sec.units[k].code}`; break; }
  } else txt += ` · teren ${f(zt, 2)}`;
  // vrednost istražnog rada ispod kursora
  const near = sec.probes.find((p) => Math.abs(L.M.l + p.s * L.sx - mx) < 10);
  if (near) {
    const it = near.item, d = (it._z0 ?? it.Z) - z;
    if (near.kind === 'cpt' && it._proc?.length && d >= 0 && d <= it._proc[it._proc.length - 1].z) {
      const p = nearest(it._proc, d); txt += ` | ${it.id}: q_t ${f(p.qt, 2)} MPa, I_c ${f(p.ic, 2)}`;
    } else if (near.kind === 'dpsh') {
      const iv = dpshIntervals(it).find((q) => d >= q.top && d <= q.bottom); if (iv) txt += ` | ${it.id}: ${it.nType || 'N20'} = ${iv.n}`;
    } else if (near.kind === 'bh') {
      const l = it.layers.find((q) => d >= q.top && d <= q.bottom); if (l) txt += ` | ${it.id}: ${l.code}`;
    }
  }
  $('secReadout').textContent = txt;
  const pc = $('pcross');
  pc.hidden = false;
  const host = $('profileHost');
  const hr = host.getBoundingClientRect();
  const ox = r.left - hr.left + host.scrollLeft, oy = r.top - hr.top + host.scrollTop;
  pc.querySelector('.v').style.cssText = `left:${ox + mx}px;top:${oy + L.M.t}px;height:${L.plotH}px`;
  pc.querySelector('.h').style.cssText = `left:${ox + L.M.l}px;top:${oy + my}px;width:${L.plotW}px`;
  // 3D marker
  const S2 = sec.samples;
  let i = 1; while (i < S2.length - 1 && S2[i].s < s) i++;
  const a = S2[i - 1], b = S2[i], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  const E = a.E + (b.E - a.E) * t, N = a.N + (b.N - a.N) * t;
  const rad = Math.max(0.5, S.terrain.extent.width / 250);
  hoverMarker.scale.set(rad, rad / ve(), rad);
  hoverMarker.position.set(E - S.terrain.E0, z - S.terrain.Z0, -(N - S.terrain.N0));
  hoverMarker.visible = true;
}

// odsecanje
function applyClip() {
  const on = S.clip.on && S.active?.data;
  let planes = [];
  if (on) {
    // podrazumevano se uklanja strana bliža kameri, da se lice preseka vidi; Shift+klik okreće
    const pl = sectionClipPlane(S.active.data, S.terrain, false);
    if (S.clip.autoSide == null || S.clip.forSec !== S.active) {
      S.clip.autoSide = pl.distanceToPoint(viewer.camera.position) > 0;
      S.clip.forSec = S.active;
      S.clip.flip = false;
    }
    if (S.clip.autoSide !== S.clip.flip) pl.negate();
    planes = [pl];
  }
  const mats = [];
  if (S.terrainMesh) mats.push(S.terrainMesh.material);
  if (S.block) mats.push(...S.block.units.map((u) => u.material));
  for (const m of mats) { m.clippingPlanes = planes; m.needsUpdate = true; }
  $('btnClip').classList.toggle('on', !!on);
}
$('btnClip').onclick = (e) => {
  if (e.shiftKey && S.clip.on) S.clip.flip = !S.clip.flip;
  else { S.clip.on = !S.clip.on; S.clip.autoSide = null; }
  applyClip();
};

/** Kamera upravno na presek, sa strane koja je odsečena (lice preseka ka posmatraču). */
function viewSection() {
  const sec = S.active?.data;
  if (!sec) return;
  viewer._resize(); // fioka profila je možda upravo promenila visinu prikaza
  const t = S.terrain;
  const a = sec.vertices[0], b = sec.vertices[sec.vertices.length - 1];
  const mid = sec.samples[Math.floor(sec.samples.length / 2)];
  const zc = ((sec.zmax + sec.zmin) / 2 - t.Z0) * ve();
  const target = new THREE.Vector3(mid.E - t.E0, zc, -(mid.N - t.N0));
  const dx = b.E - a.E, dz = -(b.N - a.N), L = Math.hypot(dx, dz) || 1;
  let n = new THREE.Vector3(-dz / L, 0, dx / L);
  const pl = sectionClipPlane(sec, t, false);
  if (S.clip.on && S.clip.autoSide !== S.clip.flip) pl.negate();
  // kamera na strani koja je uklonjena (negativna strana ravni)
  if (S.clip.on ? pl.normal.dot(n) > 0 : n.dot(viewer.camera.position.clone().sub(target)) < 0) n.negate();
  const tanV = Math.tan((viewer.camera.fov * Math.PI) / 360);
  const distH = sec.L / (2 * tanV * viewer.camera.aspect);
  const distV = ((sec.zmax - sec.zmin) * ve()) / (2 * tanV);
  const dist = Math.max(distH, distV) * 1.12;
  viewer.flyTo(target.clone().add(n.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * 0.12, 0)), target);
}
$('secView').onclick = () => {
  if (!S.clip.on) { S.clip.on = true; S.clip.autoSide = null; applyClip(); }
  viewSection();
};

// izvoz profila
function profileSvgText() {
  const svg = $('profileHost').querySelector('svg');
  return svg ? '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML : null;
}
const fileBase = () => (S.project.name || 'projekat').replace(/[^\p{L}\p{N}_-]+/gu, '_');
$('secSvg').onclick = () => { const t = profileSvgText(); if (t) download(`${fileBase()}_${S.active.labels[0]}.svg`, t, 'image/svg+xml'); };
$('secPng').onclick = () => {
  const svg = $('profileHost').querySelector('svg');
  if (!svg) return;
  const w = +svg.getAttribute('width'), h = +svg.getAttribute('height'), k = 2.5;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = w * k; cv.height = h * k;
    const c = cv.getContext('2d');
    c.scale(k, k); c.drawImage(img, 0, 0);
    cv.toBlob((b) => download(`${fileBase()}_${S.active.labels[0]}.png`, b));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
};

// promena visine fioke
{
  let startY = 0, startH = 0;
  const onMove = (e) => { $('drawer').style.height = Math.max(160, Math.min(window.innerHeight - 160, startH - (e.clientY - startY))) + 'px'; };
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); renderProfile(); };
  $('drawerResize').addEventListener('pointerdown', (e) => {
    startY = e.clientY; startH = $('drawer').getBoundingClientRect().height;
    $('drawer').classList.remove('max');
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });
}

// ------------------------------------------------------------------ merenje
const measure = {
  active: false, pts: [], group: new THREE.Group(),
  start() { this.active = true; this.reset(); el3d.classList.add('measuring'); $('viewport').classList.add('measuring'); $('btnMeasure').classList.add('on'); toast('Merenje: klik na prvu pa na drugu tačku. Esc — kraj.'); },
  stop() { this.active = false; el3d.classList.remove('measuring'); $('viewport').classList.remove('measuring'); $('btnMeasure').classList.remove('on'); this.reset(); },
  reset() { this.pts = []; disposeTree(this.group); this.group.clear(); },
  click(e) {
    const h = pickAt(e);
    if (!h) return;
    if (this.pts.length >= 2) this.reset();
    this.pts.push(h.point);
    this.draw();
  },
  move(h) { if (this.pts.length === 1) this.draw(h.point); },
  draw(cursor) {
    disposeTree(this.group); this.group.clear();
    const t = S.terrain;
    const P = [...this.pts, ...(cursor ? [cursor] : [])];
    const loc = (p) => [p.E - t.E0, p.Z - t.Z0, -(p.N - t.N0)];
    for (const p of this.pts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.4, t.extent.width / 350), 14, 10), new THREE.MeshBasicMaterial({ color: 0x1d2228, depthTest: false }));
      m.position.set(...loc(p)); m.scale.y = 1 / ve(); m.userData.keepRound = true; m.renderOrder = 31;
      this.group.add(m);
    }
    if (P.length === 2) {
      const g = new LineGeometry(); g.setPositions([...loc(P[0]), ...loc(P[1])]);
      const l = new Line2(g, new LineMaterial({ color: 0x1d2228, linewidth: 2.5, depthTest: false, transparent: true }));
      l.renderOrder = 31;
      this.group.add(l);
      const dh = Math.hypot(P[1].E - P[0].E, P[1].N - P[0].N), dz = P[1].Z - P[0].Z;
      const div = document.createElement('div');
      div.className = 'lbl lbl-measure';
      div.innerHTML = `${f(dh, 2)} m · Δz ${dz >= 0 ? '+' : ''}${f(dz, 2)} m · ${f(dh > 0 ? (dz / dh) * 100 : 0, 1)}% · kosa ${f(Math.hypot(dh, dz), 2)} m`;
      const o = new CSS2DObject(div);
      const a = loc(P[0]), b = loc(P[1]);
      o.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      this.group.add(o);
    }
  },
};
fx.add(measure.group);
$('btnMeasure').onclick = () => (measure.active ? measure.stop() : (drawTool.active && drawTool.cancel(), measure.start()));

// ------------------------------------------------------------------ uvoz / izvoz
async function handleFiles(files) {
  files = [...files];
  if (!files.length) return;
  const json = files.find((fl) => /\.json$/i.test(fl.name));
  if (json) {
    try {
      const p = JSON.parse(await json.text());
      if (!p.terrain || !p.boreholes) throw new Error('nije projekat GeoTeren 3D');
      p.cpts ||= []; p.dpsh ||= []; p.soils ||= []; p.sections ||= [];
      if (loadProject(p)) { S.isDemo = false; toast(`✓ Učitan projekat „${p.name}”`); }
    } catch (e) { toast(`✕ ${json.name}: ${e.message}`, 'err'); }
    return;
  }
  const items = await Promise.all(files.map(async (fl) => {
    const text = await fl.text();
    let kind = null;
    try { const T = parseTable(text); kind = T.headerless ? 'topo' : detectKind(T.head); } catch { /* prijava ispod */ }
    return { name: fl.name, text, kind };
  }));
  const order = { soils: 0, points: 1, topo: 2, layers: 3, cpt: 4, dpsh: 5 };
  items.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  const fresh = !S.project || (S.isDemo && items.some((i) => i.kind === 'points'));
  const st = fresh ? emptyStaging() : projectToStaging(S.project);
  if (fresh) st.name = 'Novi projekat';
  for (const it of items) {
    const r = importTable(st, it.text, it.name);
    toast(r.msg, r.ok ? '' : 'err');
  }
  const { project, warnings } = stagingToProject(st);
  warnings.forEach((w) => toast(w, w.startsWith('!') ? 'warn' : ''));
  if (!project.terrain.points.length) { toast('Nema dovoljno podataka za teren: učitaj tabelu tačaka sa kotama (Z) ili topografiju.', 'err'); return; }
  if (loadProject(project, { fit: fresh })) S.isDemo = false;
}

$('fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
{
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('dropOverlay').hidden = false; });
  window.addEventListener('dragleave', () => { depth--; if (depth <= 0) { depth = 0; $('dropOverlay').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('dropOverlay').hidden = true; handleFiles(e.dataTransfer.files); });
}

$('btnDemo').onclick = () => { loadProject(generateSampleProject()); S.isDemo = true; toast('Učitan demonstracioni projekat. Klikni „Nacrtaj presek” i zadaj liniju po terenu.'); };
$('btnHelp').onclick = () => $('helpDlg').showModal();
$('projName').addEventListener('change', () => { if (S.project) S.project.name = $('projName').value; });

$('btnExport').onclick = (e) => { e.stopPropagation(); $('exportMenu').classList.toggle('open'); };
document.addEventListener('click', () => $('exportMenu').classList.remove('open'));
$('exportMenu').addEventListener('click', (e) => {
  const k = e.target.dataset.exp;
  if (!k || !S.project) return;
  if (k === 'json') {
    syncProjectSections();
    const txt = JSON.stringify(S.project, (key, v) => (key.startsWith('_') || key === 'label' ? undefined : v));
    download(`${fileBase()}.geoteren.json`, txt, 'application/json');
  } else if (k === 'csv') {
    const files = exportCSVs(S.project);
    Object.entries(files).forEach(([n, t], i) => setTimeout(() => download(`${fileBase()}_${n}`, '﻿' + t, 'text/csv;charset=utf-8'), i * 250));
  } else if (k === 'png3d') {
    el3d.toBlob((b) => download(`${fileBase()}_3D.png`, b));
  }
});

// ------------------------------------------------------------------ prečice
window.addEventListener('keydown', (e) => {
  if (/input|select|textarea/i.test(document.activeElement?.tagName)) return;
  if (e.key === 'Escape') {
    if (measure.active) measure.stop();
    else if (!drawTool.active) closeInfo();
  }
  if (drawTool.active || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p') startDraw();
  else if (k === 'h') homeView();
  else if (k === 't') topView();
  else if (k === 'm') $('btnMeasure').click();
});

// ------------------------------------------------------------------ start
readLayers();
loadProject(generateSampleProject());
S.isDemo = true;
window.__geo = S; // za proveru iz konzole
window.__geoApi = { drawTool, openSection, viewer, applyClip, homeView, handleFiles };
