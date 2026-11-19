// Obrada CPT/CPTu zapisa — klasifikacija tla po Robertson (2009/2010), SBTn preko indeksa Ic.
// Ulaz: z [m], qc [MPa], fs [kPa], u2 [kPa]. Izlaz: qt, Rf, γ, σv0, σ'v0, Qtn, Fr, Ic, zona SBTn.

const PA = 101.325; // kPa
const GW = 9.81; // kN/m3

export const SBT_ZONES = {
  1: { name: 'Senzitivna sitnozrna tla', color: '#d0473c' },
  2: { name: 'Organska tla – treset', color: '#6d4a2f' },
  3: { name: 'Gline – prašinasta glina do glina', color: '#3f6fb5' },
  4: { name: 'Prašinaste mešavine', color: '#4aa3a2' },
  5: { name: 'Peskovite mešavine', color: '#8cc084' },
  6: { name: 'Peskovi – čist do prašinast pesak', color: '#e6c84f' },
  7: { name: 'Šljunkovit pesak do zbijen pesak', color: '#e0863a' },
  8: { name: 'Vrlo krut pesak do glinovit pesak (prekonsolid./cementiran)', color: '#9b6b3c' },
  9: { name: 'Vrlo kruto sitnozrno tlo (prekonsolid./cementirano)', color: '#4f5966' },
};

export function zoneFromIc(ic) {
  if (!isFinite(ic)) return null;
  if (ic < 1.31) return 7;
  if (ic < 2.05) return 6;
  if (ic < 2.6) return 5;
  if (ic < 2.95) return 4;
  if (ic < 3.6) return 3;
  return 2;
}

/**
 * SBTn zona sa normalizovanog dijagrama Qtn–Fr (Robertson 1990/2009).
 * Zone 2–7 po Ic; zona 1 i zone 8/9 po granicama sa dijagrama (aproksimacije Robertson 2010):
 *  - zona 1:   Qtn < 12·exp(−1.4·Fr)
 *  - zone 8/9: Fr > 1.5 i Qtn > 1 / (0.005(Fr−1) − 0.0003(Fr−1)² − 0.002); 8 ako je Ic ≤ 2.6, inače 9
 */
export function sbtnZone(Qtn, Fr, ic) {
  if (!isFinite(ic)) return null;
  if (isFinite(Qtn) && isFinite(Fr)) {
    if (Qtn < 12 * Math.exp(-1.4 * Fr)) return 1;
    if (Fr > 1.5) {
      const d = 0.005 * (Fr - 1) - 0.0003 * (Fr - 1) ** 2 - 0.002;
      if (d > 0 && Qtn > 1 / d) return ic <= 2.6 ? 8 : 9;
    }
  }
  return zoneFromIc(ic);
}

/**
 * @param {{z:number,qc:number,fs:number,u2?:number}[]} data
 * @param {{gwl?:number, a?:number}} opts gwl = dubina NPV od kote terena [m], a = odnos površina konusa
 */
export function processCPT(data, { gwl = 0, a = 0.8 } = {}) {
  const sorted = [...data].filter((d) => isFinite(d.z) && isFinite(d.qc)).sort((p, q) => p.z - q.z);
  let sv = 0, zPrev = 0;
  const out = [];
  for (const d of sorted) {
    const u2 = isFinite(d.u2) ? d.u2 : 0;
    const fs = isFinite(d.fs) ? Math.max(0, d.fs) : 0;
    const qt = d.qc * 1000 + u2 * (1 - a); // kPa
    const rf = qt > 0 ? (fs / qt) * 100 : 0;
    // Robertson & Cabal (2010): γ/γw = 0.27·log Rf + 0.36·log(qt/pa) + 1.236
    let gamma = GW * (0.27 * Math.log10(Math.max(rf, 0.1)) + 0.36 * Math.log10(Math.max(qt, 1) / PA) + 1.236);
    gamma = Math.min(22, Math.max(14, gamma));
    sv += gamma * (d.z - zPrev);
    zPrev = d.z;
    const u0 = d.z > gwl ? (d.z - gwl) * GW : 0;
    const svEff = Math.max(sv - u0, 1);
    const qnet = Math.max(qt - sv, 1);
    const F = fs > 0 ? (fs / qnet) * 100 : 0.1;
    let n = 1, Qtn = 0, ic = 0;
    for (let k = 0; k < 30; k++) {
      Qtn = (qnet / PA) * Math.pow(PA / svEff, n);
      ic = Math.sqrt((3.47 - Math.log10(Math.max(Qtn, 0.1))) ** 2 + (Math.log10(Math.max(F, 0.01)) + 1.22) ** 2);
      const nn = Math.min(1, Math.max(0.15, 0.381 * ic + 0.05 * (svEff / PA) - 0.15));
      if (Math.abs(nn - n) < 0.005) { n = nn; break; }
      n = nn;
    }
    out.push({
      z: d.z, qc: d.qc, fs, u2, qt: qt / 1000, rf, gamma, sv, u0, svEff, Qtn, F, ic, n, zone: sbtnZone(Qtn, F, ic),
    });
  }
  return out;
}

/** Spaja susedne tačke iste SBTn zone u intervale (za prikaz traka) — kratki intervali se utapaju. */
export function sbtIntervals(proc, minThk = 0.15) {
  const iv = [];
  for (let i = 0; i < proc.length; i++) {
    const p = proc[i];
    const top = i === 0 ? 0 : (proc[i - 1].z + p.z) / 2;
    const bot = i === proc.length - 1 ? p.z : (p.z + proc[i + 1].z) / 2;
    const last = iv[iv.length - 1];
    if (last && last.zone === p.zone) last.bottom = bot;
    else iv.push({ top, bottom: bot, zone: p.zone });
  }
  // utapanje tankih intervala u prethodni
  const merged = [];
  for (const s of iv) {
    const last = merged[merged.length - 1];
    if (last && (s.bottom - s.top < minThk || last.zone === s.zone)) last.bottom = s.bottom;
    else merged.push({ ...s });
  }
  return merged;
}
