// Generator demonstracionog projekta.
// Svi podaci (teren, bušotine, CPT, DPSH-B) izvedeni su iz ISTOG sintetičkog geološkog modela,
// pa su međusobno konzistentni — dobra osnova za proveru preseka i interpolacije.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Gaus-Krigerova projekcija, zona 7 (Y = istok, X = sever)
const E0 = 7456100;
const N0 = 4960250;
const W = 360; // m, pravac istok
const H = 260; // m, pravac sever

export const SAMPLE_SOILS = [
  { code: 'HU', name: 'Humus, tamnosmeđi', color: '#4b3a2a', order: 1, pattern: 'humus' },
  { code: 'CL', name: 'Glina prašinasta, srednje plastična (CL)', color: '#a87b55', order: 2, pattern: 'clay' },
  { code: 'ML', name: 'Prašina peskovita (ML)', color: '#cdb487', order: 3, pattern: 'silt' },
  { code: 'SP', name: 'Pesak sitnozrni, slabo graduiran (SP)', color: '#ecd27a', order: 4, pattern: 'sand' },
  { code: 'GW', name: 'Šljunak peskovit, dobro graduiran (GW)', color: '#dc9a52', order: 5, pattern: 'gravel' },
  { code: 'LP', name: 'Laporac, raspadnut do svež', color: '#8d9eac', order: 6, pattern: 'marl' },
];

// --- sintetički geološki model (lokalne koordinate x∈[0,W], y∈[0,H]) ---
function surface(x, y) {
  return (
    114.0 +
    0.022 * x -
    0.012 * y +
    6.5 * Math.exp(-((x - 250) ** 2 + (y - 175) ** 2) / (2 * 75 ** 2)) -
    3.6 * Math.exp(-((y - 55 - 0.28 * x) ** 2) / (2 * 16 ** 2)) +
    0.35 * Math.sin(x / 23) * Math.cos(y / 31) +
    0.2 * Math.sin((x + y) / 13)
  );
}
const humusThk = (x, y) => 0.3 + 0.15 * Math.sin(x / 40) * Math.cos(y / 35) + 0.05;
// donje kote slojeva (mnv)
function boundaries(x, y) {
  const s = surface(x, y);
  const hu = s - humusThk(x, y);
  const cl = Math.min(hu - 0.6, hu - (2.6 + 1.4 * Math.sin(x / 70) + 0.9 * Math.cos(y / 55) + 0.012 * (x - 150)));
  // sočivo prašine — postoji samo u severoistočnom delu
  const mlT = Math.max(0, 2.2 * Math.exp(-((x - 230) ** 2 + (y - 180) ** 2) / (2 * 80 ** 2)) - 0.35);
  const ml = cl - mlT;
  const sp = Math.min(ml - 0.5, 104.2 + 0.012 * x + 0.9 * Math.sin(y / 45) + 0.6 * Math.cos(x / 60));
  const gw = Math.min(sp - 0.8, 99.0 + 0.006 * x - 0.004 * y + 0.7 * Math.sin(x / 50 + y / 70));
  return { s, HU: hu, CL: cl, ML: ml, SP: sp, GW: gw };
}
const gwlElev = (x, y) => 108.6 + 0.008 * x - 0.004 * y;

function soilAt(b, z) {
  if (z > b.HU) return 'HU';
  if (z > b.CL) return 'CL';
  if (z > b.ML) return 'ML';
  if (z > b.SP) return 'SP';
  if (z > b.GW) return 'GW';
  return 'LP';
}

function makeLayers(x, y, depth) {
  const b = boundaries(x, y);
  const top = b.s;
  const seq = ['HU', 'CL', 'ML', 'SP', 'GW'];
  const layers = [];
  let cur = 0;
  for (const code of seq) {
    const bot = r1(Math.min(depth, top - b[code]));
    if (bot - cur >= 0.1) {
      layers.push({ top: r1(cur), bottom: bot, code });
      cur = bot;
    }
    if (cur >= depth) break;
  }
  if (cur < depth) layers.push({ top: r1(cur), bottom: r1(depth), code: 'LP' });
  return layers;
}

const DESCR = {
  HU: 'Humus, tamnosmeđi, sa korenjem',
  CL: 'Glina prašinasta, smeđa, tvrdo plastične do plastične konzistencije',
  ML: 'Prašina peskovita, žutosmeđa, vlažna',
  SP: 'Pesak sitnozrni, žut, srednje zbijen, vodozasićen',
  GW: 'Šljunak peskovit, sivožut, zbijen, vodozasićen',
  LP: 'Laporac sivoplavi, raspadnut u gornjem delu',
};

export function generateSampleProject() {
  const rnd = mulberry32(20261118);
  const noise = (a) => (rnd() * 2 - 1) * a;

  // --- teren: pravilna mreža 4 m ---
  const step = 4;
  const points = [];
  for (let y = 0; y <= H; y += step) {
    for (let x = 0; x <= W; x += step) {
      points.push([r3(E0 + x), r3(N0 + y), r3(surface(x, y))]);
    }
  }

  const loc = (id, x, y) => ({ id, E: r3(E0 + x), N: r3(N0 + y), Z: r2(surface(x, y)), x, y });

  // --- bušotine ---
  const bhDefs = [
    ['B-1', 60, 60, 18], ['B-2', 150, 95, 20], ['B-3', 245, 130, 20], ['B-4', 300, 205, 18],
    ['B-5', 110, 200, 16], ['B-6', 200, 30, 15], ['B-7', 210, 185, 20],
  ];
  const boreholes = bhDefs.map(([id, x, y, depth]) => {
    const L = loc(id, x, y);
    return {
      id, E: L.E, N: L.N, Z: L.Z, depth,
      gwl: r2(L.Z - gwlElev(x, y)),
      date: '2026-10-0' + (1 + (bhDefs.findIndex((d) => d[0] === id) % 9)),
      method: 'Rotaciono jezgrovanje Ø101 mm',
      layers: makeLayers(x, y, depth).map((l) => ({ ...l, description: DESCR[l.code] })),
    };
  });

  // --- CPTu ---
  const cptDefs = [
    ['CPT-1', 95, 75], ['CPT-2', 195, 112], ['CPT-3', 280, 160], ['CPT-4', 160, 170],
    ['CPT-5', 255, 60], ['CPT-6', 330, 235], ['CPT-7', 40, 150],
  ];
  const cpts = cptDefs.map(([id, x, y]) => {
    const L = loc(id, x, y);
    const b = boundaries(x, y);
    const gwl = L.Z - gwlElev(x, y);
    const data = [];
    const dz = 0.05;
    let qPrev = null;
    for (let d = dz; d <= 25; d += dz) {
      const z = L.Z - d;
      const soil = soilAt(b, z);
      let qc, rf, du;
      switch (soil) {
        case 'HU': qc = 0.6 + noise(0.15); rf = 3.5; du = 0; break;
        case 'CL': qc = 0.9 + 0.08 * d + noise(0.12); rf = 4.6 + noise(0.6); du = 120 + 25 * d; break;
        case 'ML': qc = 2.4 + noise(0.4); rf = 2.6 + noise(0.4); du = 25; break;
        case 'SP': qc = 7 + 0.5 * d + noise(2.2); rf = 0.9 + noise(0.25); du = 0; break;
        case 'GW': qc = 22 + noise(7); rf = 0.6 + noise(0.15); du = 0; break;
        default: qc = 16 + noise(3); rf = 2.2 + noise(0.4); du = 200; break;
      }
      qc = Math.max(0.15, qc);
      // blago zaglađivanje (konus "oseća" sloj ispred i iza vrha)
      qc = qPrev == null ? qc : 0.65 * qc + 0.35 * qPrev;
      qPrev = qc;
      const fs = Math.max(1, (rf / 100) * qc * 1000);
      const u0 = d > gwl ? (d - gwl) * 9.81 : 0;
      const u2 = soil === 'HU' ? 0 : Math.max(-20, u0 + du * (d > gwl ? 1 : 0.3) + noise(8));
      data.push({ z: r2(d), qc: r3(qc), fs: r1(fs), u2: r1(u2) });
      // prekid na odbijanju u šljunku / laporcu
      if ((soil === 'GW' && qc > 28) || (soil === 'LP' && d > (L.Z - b.GW) + 1.0)) break;
    }
    return { id, E: L.E, N: L.N, Z: L.Z, gwl: r2(gwl), date: '2026-10-12', cone: 'CPTu, A=10 cm², a=0.80', area_ratio: 0.8, data };
  });

  // --- DPSH-B ---
  const dpDefs = [
    ['DP-1', 120, 120], ['DP-2', 225, 90], ['DP-3', 300, 120], ['DP-4', 70, 215], ['DP-5', 265, 215],
  ];
  const dpsh = dpDefs.map(([id, x, y]) => {
    const L = loc(id, x, y);
    const b = boundaries(x, y);
    const data = [];
    for (let d = 0.2; d <= 20.001; d += 0.2) {
      const z = L.Z - d + 0.1;
      const soil = soilAt(b, z);
      let n;
      switch (soil) {
        case 'HU': n = 1 + noise(1); break;
        case 'CL': n = 3 + 0.25 * d + noise(1.5); break;
        case 'ML': n = 5 + noise(1.5); break;
        case 'SP': n = 9 + 0.6 * d + noise(4); break;
        case 'GW': n = 28 + noise(12); break;
        default: n = 40 + noise(10); break;
      }
      n = Math.max(0, Math.round(n));
      data.push({ z: r1(d), n });
      if (n >= 50) break; // odbijanje
    }
    return { id, E: L.E, N: L.N, Z: L.Z, nType: 'N20', date: '2026-10-15', device: 'DPSH-B (63.5 kg / 75 cm)', data };
  });

  return {
    name: 'Demo lokacija — Stambeno-poslovni kompleks',
    crs: 'MGI 1901 / Balkans zona 7 (EPSG:3909)',
    heightRef: 'mnv (Trst)',
    soils: SAMPLE_SOILS.map((s) => ({ ...s })),
    terrain: { points },
    boreholes,
    cpts,
    dpsh,
    sections: [],
  };
}
