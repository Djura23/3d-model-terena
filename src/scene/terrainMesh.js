import * as THREE from 'three';

// hipsometrijska skala (nizije → uzvišenja), prigušeni tonovi da istražni radovi budu u prvom planu
const HYPSO = [
  [0.0, [0.56, 0.66, 0.47]],
  [0.25, [0.68, 0.74, 0.52]],
  [0.5, [0.82, 0.79, 0.6]],
  [0.75, [0.79, 0.69, 0.53]],
  [1.0, [0.7, 0.6, 0.5]],
];
export function hypso(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < HYPSO.length; i++) {
    if (t <= HYPSO[i][0]) {
      const [t0, c0] = HYPSO[i - 1], [t1, c1] = HYPSO[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return HYPSO[HYPSO.length - 1][1];
}

export function niceStep(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v - 1e-9) return k * p;
  return 10 * p;
}

/** Mreža terena iz TIN-a sa hipsometrijom, izohipsama i koordinatnom mrežom u šejderu. */
export function buildTerrainMesh(terrain) {
  const n = terrain.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const elev = new Float32Array(n);
  const { minZ, maxZ } = terrain.bounds;
  const tc = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const z = terrain.z[i];
    pos[3 * i] = terrain.xy[2 * i];
    pos[3 * i + 1] = z - terrain.Z0;
    pos[3 * i + 2] = -terrain.xy[2 * i + 1];
    elev[i] = z;
    const c = hypso((z - minZ) / Math.max(maxZ - minZ, 0.01));
    tc.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    col[3 * i] = tc.r; col[3 * i + 1] = tc.g; col[3 * i + 2] = tc.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aElev', new THREE.BufferAttribute(elev, 1));
  const idx = new Uint32Array(terrain.triangles);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // proveri orijentaciju (normale moraju gledati naviše)
  const nr = g.attributes.normal.array;
  let sy = 0;
  for (let i = 1; i < nr.length; i += 3) sy += nr[i];
  if (sy < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();

  const relief = maxZ - minZ;
  const uniforms = {
    uInterval: { value: niceStep(relief / 12) },
    uContourOn: { value: 1 },
    uGridOn: { value: 0 },
    uGridStep: { value: niceStep(Math.max(terrain.extent.width, terrain.extent.height) / 8) },
    uGridOff: { value: new THREE.Vector2() },
    uContourColor: { value: new THREE.Color(0x4a3f33) },
    uGwlOn: { value: 0 },
  };
  const setGridOffset = () => {
    const s = uniforms.uGridStep.value;
    uniforms.uGridOff.value.set(((terrain.E0 % s) + s) % s, ((terrain.N0 % s) + s) % s);
  };
  setGridOffset();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aElev;\nvarying float vElev;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = aElev;\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vElev; varying vec3 vLocal;
        uniform float uInterval, uContourOn, uGridOn, uGridStep;
        uniform vec2 uGridOff; uniform vec3 uContourColor;
        float isoLine(float v, float w) {
          float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-5);
          return 1.0 - clamp(f / w, 0.0, 1.0);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uContourOn > 0.5) {
          float c = vElev / uInterval;
          float l1 = isoLine(c, 0.9);
          float l5 = isoLine(c / 5.0, 1.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, uContourColor, max(l1 * 0.38, l5 * 0.75));
        }
        if (uGridOn > 0.5) {
          vec2 gg = (vec2(vLocal.x, -vLocal.z) + uGridOff) / uGridStep;
          float gl = max(isoLine(gg.x, 0.7), isoLine(gg.y, 0.7));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gl * 0.6);
        }`
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v1';

  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'teren';
  mesh.renderOrder = 2;
  mesh.userData = { kind: 'terrain', uniforms, setGridOffset };
  return mesh;
}

export function setTerrainOpacity(mesh, op) {
  const m = mesh.material;
  m.opacity = op;
  m.transparent = op < 0.999;
  m.depthWrite = op >= 0.999;
  m.needsUpdate = true;
}
