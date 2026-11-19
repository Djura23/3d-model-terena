/**
 * Interpretativni geološki model između bušotina.
 *
 * Metod: za svaku litološku jedinicu (redosled iz legende, "order") računa se DEBLJINA u svakoj bušotini,
 * pa se debljina interpolira IDW metodom (inverzno ponderisanje rastojanjem) i jedinice se "slažu" od
 * površine terena naniže. Time:
 *  - model tačno prolazi kroz podatke iz bušotina,
 *  - granice slojeva se nikad ne seku,
 *  - plitki slojevi prate morfologiju terena.
 * Bušotina koja nije probila jedinicu daje samo DONJU granicu njene debljine.
 */
export class GeologyModel {
  constructor(project, terrain, { power = 2, maxAnisoRadius = Infinity } = {}) {
    this.terrain = terrain;
    this.power = power;
    this.maxRadius = maxAnisoRadius;
    const soils = [...project.soils].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    this.units = soils;
    this.unitIndex = new Map(soils.map((s, i) => [s.code, i]));
    const K = soils.length;

    // podaci po bušotini
    this.wells = [];
    for (const bh of project.boreholes) {
      if (!bh.layers || !bh.layers.length) continue;
      const thk = new Array(K).fill(0);
      let deepestIdx = -1;
      for (const l of bh.layers) {
        const k = this.unitIndex.get(l.code);
        if (k == null) continue;
        thk[k] += Math.max(0, l.bottom - l.top);
      }
      const last = [...bh.layers].sort((a, b) => b.bottom - a.bottom)[0];
      deepestIdx = this.unitIndex.get(last.code) ?? -1;
      // status: 'known' (probijena), 'partial' (bušotina se završila u jedinici), 'none' (nije dosegnuta)
      const status = thk.map((_, k) => (k < deepestIdx ? 'known' : k === deepestIdx ? 'partial' : 'none'));
      this.wells.push({ id: bh.id, x: bh.E - terrain.E0, y: bh.N - terrain.N0, thk, status });
    }

    // efektivne debljine (partial → max(opaženo, IDW iz poznatih))
    this.eff = [];
    for (let k = 0; k < K; k++) {
      const known = this.wells.filter((w) => w.status[k] === 'known').map((w) => ({ x: w.x, y: w.y, v: w.thk[k] }));
      const vals = [];
      for (const w of this.wells) {
        if (w.status[k] === 'known') vals.push({ x: w.x, y: w.y, v: w.thk[k] });
        else if (w.status[k] === 'partial') {
          const est = known.length ? this._idw(known, w.x, w.y) : w.thk[k];
          vals.push({ x: w.x, y: w.y, v: Math.max(w.thk[k], est) });
        }
      }
      this.eff.push(vals);
    }
    // jedinice bez ijednog podatka: debljina 0 (osim ako je poslednja — podloga)
    this.lastUnit = K - 1;
    while (this.lastUnit > 0 && this.eff[this.lastUnit].length === 0) this.lastUnit--;

    // donja granica modela
    let minBot = Infinity;
    for (const bh of project.boreholes) {
      const z = (bh.Z ?? terrain.elevationAt(bh.E, bh.N)) - (bh.depth ?? Math.max(...bh.layers.map((l) => l.bottom)));
      minBot = Math.min(minBot, z);
    }
    for (const t of [...(project.cpts || []), ...(project.dpsh || [])]) {
      const d = t.data?.length ? Math.max(...t.data.map((p) => p.z)) : 0;
      minBot = Math.min(minBot, (t.Z ?? terrain.elevationAt(t.E, t.N)) - d);
    }
    this.base = isFinite(minBot) ? Math.floor(minBot - 3) : terrain.bounds.minZ - 20;
    this.valid = this.wells.length > 0;
  }

  _idw(pts, x, y) {
    let sw = 0, sv = 0;
    for (const p of pts) {
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d2 < 1e-6) return p.v;
      const w = 1 / Math.pow(d2, this.power / 2);
      sw += w; sv += w * p.v;
    }
    return sw > 0 ? sv / sw : 0;
  }

  /**
   * Granice jedinica u tački (lokalne x,y). Vraća [{k, code, top, bottom}] — samo jedinice debljine > 0.
   * @param {number} [surfaceZ] kota površine (podrazumevano iz terena)
   */
  columnAtLocal(x, y, surfaceZ) {
    const s = surfaceZ ?? this.terrain.elevationAtLocal(x, y);
    if (!isFinite(s) || !this.valid) return [];
    const res = [];
    let top = s;
    for (let k = 0; k <= this.lastUnit; k++) {
      let bottom;
      if (k === this.lastUnit) bottom = Math.min(this.base, top);
      else {
        const vals = this.eff[k];
        const t = vals.length ? Math.max(0, this._idw(vals, x, y)) : 0;
        bottom = Math.max(this.base, top - t);
      }
      if (top - bottom > 1e-4) res.push({ k, code: this.units[k].code, top, bottom });
      top = bottom;
    }
    return res;
  }

  /** Granice kao niz kota dužine K+1 (vrh prve jedinice ... dno poslednje), za izradu mreža. */
  boundaryStackLocal(x, y, surfaceZ) {
    const s = surfaceZ ?? this.terrain.elevationAtLocal(x, y);
    const K = this.lastUnit + 1;
    const z = new Float64Array(K + 1);
    z[0] = s;
    for (let k = 0; k < K; k++) {
      if (k === K - 1) z[k + 1] = Math.min(this.base, z[k]);
      else {
        const vals = this.eff[k];
        const t = vals.length ? Math.max(0, this._idw(vals, x, y)) : 0;
        z[k + 1] = Math.max(this.base, z[k] - t);
      }
    }
    return z;
  }
}
