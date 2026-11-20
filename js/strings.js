/* String planning: voltage/current limits, candidate string layouts per roof face,
 * tracker assignment and a shading-aware local search (module swaps between strings). */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};

  function limits(project) {
    const m = project.module, inv = project.inverter, el = project.electrical;
    const vocCold = m.voc * (1 + m.tkVoc / 100 * (el.tMin - 25));
    const vmpHot = m.vmp * (1 + m.tkPmax / 100 * (el.tCellMax - 25));
    const vmpCold = m.vmp * (1 + m.tkPmax / 100 * (el.tMin - 25));
    const vocHot = m.voc * (1 + m.tkVoc / 100 * (el.tCellMax - 25));
    const nMax = Math.floor(inv.vmax / vocCold + 1e-9);
    const nMin = Math.max(1, Math.ceil(Math.max(inv.vmppMin / vmpHot, inv.vStart / vocHot) - 1e-9));
    const pMaxCur = Math.max(1, Math.min(inv.stringsPerTracker, Math.floor(inv.iscMax / m.isc + 1e-9)));
    return { vocCold, vmpHot, vmpCold, vocHot, nMin, nMax, parallel: pMaxCur };
  }

  /** Order modules of a face in a serpentine (row by row from the eave). */
  function spatialOrder(mods, idxs) {
    const rows = [];
    for (const i of idxs.slice().sort((a, b) => mods[a].s - mods[b].s)) {
      const r = rows.find(r => Math.abs(mods[r[0]].s - mods[i].s) < 0.2);
      if (r) r.push(i); else rows.push([i]);
    }
    const out = [];
    rows.forEach((r, k) => { r.sort((a, b) => mods[a].p - mods[b].p); if (k % 2) r.reverse(); out.push(...r); });
    return out;
  }

  function splitEven(n, k) { const out = []; for (let i = 0; i < k; i++) out.push(Math.floor(n / k) + (i < n % k ? 1 : 0)); return out; }

  /** Candidate options for one face: each option = list of trackers, each tracker = list of string lengths. */
  function faceOptions(n, lim, maxTrackers) {
    const opts = [];
    if (n === 0) return [{ trackers: [], drop: 0 }];
    for (let drop = 0; drop < Math.max(1, lim.nMin) && drop <= n; drop++) {
      const N = n - drop;
      if (N === 0) { opts.push({ trackers: [], drop }); continue; }
      for (let k = Math.ceil(N / lim.nMax); k <= Math.floor(N / lim.nMin); k++) {
        if (k < 1) continue;
        const lens = splitEven(N, k);
        if (lens.some(l => l < lim.nMin || l > lim.nMax)) continue;
        // a) one string per tracker
        if (k <= maxTrackers) opts.push({ trackers: lens.map(l => [l]), drop });
        // b) parallel strings of equal length
        if (lim.parallel > 1 && lens.every(l => l === lens[0]) && k > 1) {
          const tr = [];
          for (let i = 0; i < k; i += lim.parallel) tr.push(lens.slice(i, i + lim.parallel));
          if (tr.length < k && tr.length <= maxTrackers) opts.push({ trackers: tr, drop });
        }
      }
      if (opts.some(o => o.drop === drop)) break;   // prefer the smallest number of dropped modules
    }
    return opts;
  }

  function assign(order, option) {
    let k = 0;
    const trackers = option.trackers.map(lens => ({ strings: lens.map(l => { const s = order.slice(k, k + l); k += l; return s; }) }));
    return { trackers, unassigned: order.slice(k) };
  }

  /** Shading-aware improvement: swap modules between strings of the same face. */
  function improve(sim, E, plan, faceIdx, budget) {
    const inv = sim.project.inverter;
    const subset = [];
    for (let t = 0; t < sim.T; t++) if (sim.faceShaded[t * 2 + faceIdx]) subset.push(t);
    if (!subset.length) return plan;
    const trk = plan.trackers;
    const en = trk.map(t => PVP.energy.trackerEnergy(sim, E, t.strings, inv, subset));
    const refs = [];
    trk.forEach((t, ti) => t.strings.forEach((s, si) => refs.push([ti, si])));
    let evals = 0, improved = true;
    budget = budget || 4000;
    while (improved && evals < budget) {
      improved = false;
      for (let a = 0; a < refs.length && !improved; a++) for (let b = a + 1; b < refs.length && !improved; b++) {
        const [ta, sa] = refs[a], [tb, sb] = refs[b];
        const A = trk[ta].strings[sa], B = trk[tb].strings[sb];
        for (let i = 0; i < A.length && !improved; i++) for (let j = 0; j < B.length && !improved; j++) {
          const x = A[i], y = B[j];
          A[i] = y; B[j] = x;
          const ea = PVP.energy.trackerEnergy(sim, E, trk[ta].strings, inv, subset);
          const eb = ta === tb ? 0 : PVP.energy.trackerEnergy(sim, E, trk[tb].strings, inv, subset);
          evals++;
          const before = ta === tb ? en[ta] : en[ta] + en[tb];
          if (ea + eb > before + 1e-6) { en[ta] = ea; if (ta !== tb) en[tb] = eb; improved = true; }
          else { A[i] = x; B[j] = y; }
          if (evals >= budget) break;
        }
      }
    }
    return plan;
  }

  /** Main entry: returns best plan with evaluation. */
  function optimize(sim, E) {
    const project = sim.project, inv = project.inverter;
    const lim = limits(project);
    const faces = ['A', 'B'].map((f, fi) => ({ f, fi, idx: sim.modules.map((m, i) => m.face === f ? i : -1).filter(i => i >= 0) }));
    const per = faces.map(F => faceOptions(F.idx.length, lim, inv.trackers));
    const candidates = [];
    const recurse = (k, chosen, used) => {
      if (k === faces.length) { candidates.push(chosen.slice()); return; }
      for (const o of per[k]) {
        if (used + o.trackers.length > inv.trackers) continue;
        chosen.push(o); recurse(k + 1, chosen, used + o.trackers.length); chosen.pop();
      }
    };
    recurse(0, [], 0);
    if (!candidates.length) {
      // not enough trackers: connect as many faces as possible, biggest first
      return { plan: { trackers: [], unassigned: sim.modules.map((_, i) => i) }, lim, error: 'trackers' };
    }
    // rank candidates: fewer dropped modules, then energy
    let best = null;
    const minDrop = Math.min(...candidates.map(c => c.reduce((a, o) => a + o.drop, 0)));
    for (const cand of candidates) {
      const drop = cand.reduce((a, o) => a + o.drop, 0);
      if (drop > minDrop) continue;
      const plan = { trackers: [], unassigned: [] };
      faces.forEach((F, k) => {
        const order = spatialOrder(sim.modules, F.idx);
        const a = assign(order, cand[k]);
        a.trackers.forEach(t => t.face = F.f);
        improve(sim, E, a, F.fi, 1500);
        plan.trackers.push(...a.trackers); plan.unassigned.push(...a.unassigned);
      });
      const ev = PVP.energy.evaluate(sim, E, plan);
      if (!best || ev.total > best.ev.total + 1e-6) best = { plan, ev };
    }
    // order modules in each string as a short path (cabling)
    for (const t of best.plan.trackers) t.strings = t.strings.map(s => pathOrder(sim.modules, s));
    return { plan: best.plan, ev: best.ev, lim };
  }

  /** Nearest-neighbour path through the modules of a string, starting at the lowest/left module. */
  function pathOrder(mods, s) {
    if (s.length < 3) return s.slice();
    const rest = s.slice();
    rest.sort((a, b) => mods[a].s - mods[b].s || mods[a].p - mods[b].p);
    const out = [rest.shift()];
    while (rest.length) {
      const c = mods[out[out.length - 1]];
      let bi = 0, bd = 1e9;
      rest.forEach((m, i) => { const d = Math.abs(mods[m].p - c.p) + 1.3 * Math.abs(mods[m].s - c.s); if (d < bd) { bd = d; bi = i; } });
      out.push(rest.splice(bi, 1)[0]);
    }
    return out;
  }

  /** Cable lengths per string (home runs + bridges) and voltage drop. */
  function cables(project, g, mods, plan) {
    const c = project.cable, el = project.electrical, m = project.module;
    const ent = { face: c.face, p: c.p };
    const run = (mm, end) => {
      // terminal at the module's upper/lower edge centre
      const px = mm.p + mm.w / 2, sy = end === 'top' ? mm.s + mm.h : mm.s;
      if (mm.face === ent.face) return Math.abs(px - ent.p) + sy;
      const F = g.faces[mm.face], Fe = g.faces[ent.face];
      const pOther = g.roofLen - px;  // p on the entry face of the same point along the ridge
      return (F.slope - sy) + Math.abs(pOther - ent.p) + Fe.slope;
    };
    const out = [];
    plan.trackers.forEach((t, ti) => t.strings.forEach((s, si) => {
      const first = mods[s[0]], last = mods[s[s.length - 1]];
      const plusRoof = run(first, 'bottom'), minusRoof = run(last, 'bottom');
      let bridge = 0; const bridges = [];
      for (let i = 1; i < s.length; i++) {
        const a = mods[s[i - 1]], b = mods[s[i]];
        const d = Math.abs((a.p + a.w / 2) - (b.p + b.w / 2)) + Math.abs((a.s + a.h / 2) - (b.s + b.h / 2));
        if (d > 2.2) { const L = Math.ceil((d - 1.8) * 2) / 2; bridge += L; bridges.push({ from: a.n, to: b.n, len: L }); }
      }
      const extra = c.down + c.inside + c.reserve;
      const Lp = Math.ceil((plusRoof + extra) * 2) / 2, Lm = Math.ceil((minusRoof + extra) * 2) / 2;
      const R = el.rho * (Lp + Lm + bridge) / el.crossSection;
      const du = m.imp * R / (m.vmp * s.length) * 100;
      out.push({ tracker: ti + 1, string: si + 1, plus: Lp, minus: Lm, bridge, bridges, dU: du });
    }));
    return out;
  }

  PVP.strings = { limits, optimize, faceOptions, spatialOrder, cables, pathOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
