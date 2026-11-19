import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Osnovni 3D pregledač.
 * Koordinate scene: x = E − E0 (istok), y = Z − Z0 (visina, skalirana grupom "world" za vertikalno uveličanje),
 * z = −(N − N0) (sever je ka −z).
 */
export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 50000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomToCursor = true;
    this.controls.maxPolarAngle = Math.PI * 0.495 + 0.4; // dozvoli malo pogled ispod horizonta (podzemlje)
    this.controls.screenSpacePanning = true;

    this.scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x5b5348, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, 1.0, 0.35).multiplyScalar(1000); // svetlo sa SZ — klasično senčenje reljefa
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    fill.position.set(0.7, 0.4, -0.5).multiplyScalar(1000);
    this.scene.add(fill);

    this.world = new THREE.Group(); // skalira se po y (vertikalno uveličanje)
    this.scene.add(this.world);
    this.overlay = new THREE.Group(); // elementi koji se ne skaliraju posebno
    this.world.add(this.overlay);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._listeners = [];
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onFrame(fn) { this._listeners.push(fn); }

  _frame() {
    this.controls.update();
    for (const fn of this._listeners) fn();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  setVerticalExaggeration(v) {
    this.world.scale.y = v;
    this.world.updateMatrixWorld(true);
  }

  /** Normalizovane koordinate pokazivača iz događaja. */
  setPointer(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pick(objects, recursive = true) {
    const hits = this.raycaster.intersectObjects(objects.filter((o) => o && o.visible), recursive);
    return hits.find((h) => isVisibleChain(h.object) && !isClipped(h)) || null;
  }

  /** Kadriranje na okvir (lokalne koordinate world grupe). */
  frame(box, { dir = new THREE.Vector3(-0.55, 0.62, 0.95), animate = true } = {}) {
    const b = box.clone();
    b.min.y *= this.world.scale.y; b.max.y *= this.world.scale.y;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3()).length();
    const dist = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 0.95;
    const to = c.clone().add(dir.clone().normalize().multiplyScalar(dist));
    this.flyTo(to, c, animate);
  }

  flyTo(pos, target, animate = true) {
    if (!animate) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const start = performance.now(), dur = 650;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  /** Azimut kamere u stepenima (0 = gleda ka severu). */
  get azimuth() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  }
}

function isVisibleChain(o) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

function isClipped(hit) {
  const planes = hit.object.material?.clippingPlanes;
  if (!planes || !planes.length) return false;
  return planes.some((p) => p.distanceToPoint(hit.point) < 0);
}
