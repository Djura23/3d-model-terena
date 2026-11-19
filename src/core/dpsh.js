// DPSH-B (SRPS EN ISO 22476-2): malj 63.5 kg, visina pada 75 cm.
// Standardni zapis je N20 (udarci na 20 cm); podržan je i N10 (udarci na 10 cm).
// Za uporedivu klasifikaciju vrednosti se svode na N20 ekvivalent (N10 × 2 — ista energija po 20 cm).
// Klase su INDIKATIVNE (vizuelni pregled), ne zamenjuju korelacije za konkretno tlo.

export const DPSH_CLASSES = [
  { max: 4, name: 'vrlo rastresito / vrlo meko', color: '#dbe9f6' },
  { max: 10, name: 'rastresito / meko', color: '#9cc3e6' },
  { max: 20, name: 'srednje zbijeno / srednje kruto', color: '#5b9bd5' },
  { max: 40, name: 'zbijeno / kruto', color: '#2f6eb0' },
  { max: Infinity, name: 'vrlo zbijeno / tvrdo', color: '#173f73' },
];

/** Korak beleženja [m] iz tipa zapisa. */
export const stepOf = (t) => (t?.nType === 'N10' ? 0.1 : 0.2);

/** N20 ekvivalent jedne vrednosti. */
export const toN20 = (n, nType) => (nType === 'N10' ? n * 2 : n);

export function dpshClass(n20eq) {
  return DPSH_CLASSES.find((c) => n20eq < c.max) || DPSH_CLASSES[DPSH_CLASSES.length - 1];
}

/** Tačke {z, n} (z = dubina DNA intervala) → intervali {top, bottom, n, n20}. */
export function dpshIntervals(test) {
  const step = stepOf(test);
  const s = [...test.data].filter((d) => isFinite(d.z) && isFinite(d.n)).sort((a, b) => a.z - b.z);
  return s.map((d, i) => ({
    top: i === 0 ? Math.max(0, d.z - step) : s[i - 1].z,
    bottom: d.z,
    n: d.n,
    n20: toN20(d.n, test.nType),
  }));
}
