/* Electrical yield model on top of the shading simulation.
 * Each bypass section is a current source (∝ irradiance of its weakest cell, half-cut halves in parallel)
 * with a temperature-dependent voltage. A series string at current I bypasses all sections below I;
 * the tracker picks the global maximum power point (also for parallel strings). */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};

  /** Precompute section currents and voltages for every time step. */
  function prepare(sim) {
    const { project, T, M, sections, steps, gsec, g0 } = sim;
    const mod = project.module, clim = sim.clim;
    const tkP = mod.tkPmax / 100;
    const cur = new Float32Array(T * M * sections);
    const volt = new Float32Array(T * M);       // per section, per module
    const cur0 = new Float32Array(T * M);       // unshaded current
    for (let t = 0; t < T; t++) {
      const ta = clim.tamb[steps[t].month] + 3;
      for (let m = 0; m < M; m++) {
        let gm = 0;
        for (let s = 0; s < sections; s++) gm += gsec[(t * M + m) * sections + s];
        gm /= sections;
        const tc = ta + gm / 800 * (mod.noct - 20);
        volt[t * M + m] = mod.vmp / sections * (1 + tkP * (tc - 25));
        for (let s = 0; s < sections; s++) cur[(t * M + m) * sections + s] = mod.imp * gsec[(t * M + m) * sections + s] / 1000;
        cur0[t * M + m] = mod.imp * g0[t * M + m] / 1000;
      }
    }
    return { cur, volt, cur0 };
  }

  const bufC = [], bufV = [];
  /** Power of one tracker (array of strings = arrays of module indices) at time step t. */
  function trackerPower(sim, E, strings, t, inv) {
    const M = sim.M, S = sim.sections;
    const vmin = inv.vmppMin, imax = inv.imax;
    if (strings.length === 1) {
      const str = strings[0];
      const n = str.length * S;
      let k = 0;
      for (const m of str) for (let s = 0; s < S; s++) { bufC[k] = E.cur[(t * M + m) * S + s]; bufV[k] = E.volt[t * M + m]; k++; }
      // sort by current (desc) – insertion sort, n is small
      for (let i = 1; i < n; i++) { const c = bufC[i], v = bufV[i]; let j = i - 1; while (j >= 0 && bufC[j] < c) { bufC[j + 1] = bufC[j]; bufV[j + 1] = bufV[j]; j--; } bufC[j + 1] = c; bufV[j + 1] = v; }
      let vc = 0, best = 0;
      for (let i = 0; i < n; i++) { vc += bufV[i]; if (vc < vmin) continue; const p = Math.min(bufC[i], imax) * vc; if (p > best) best = p; }
      return Math.min(best * inv.eta, inv.pmax);
    }
    // parallel strings: staircase I(V) per string, evaluate at all step voltages
    const st = strings.map(str => {
      const arr = [];
      for (const m of str) for (let s = 0; s < S; s++) arr.push([E.cur[(t * M + m) * S + s], E.volt[t * M + m]]);
      arr.sort((a, b) => b[0] - a[0]);
      let vc = 0; const V = [], C = [];
      for (const [c, v] of arr) { vc += v; V.push(vc); C.push(c); }
      return { V, C };
    });
    let best = 0;
    for (const a of st) for (const V of a.V) {
      if (V < vmin) continue;
      let I = 0;
      for (const b of st) { let k = 0; while (k < b.V.length && b.V[k] < V - 1e-9) k++; if (k < b.V.length) I += b.C[k]; }
      const p = Math.min(I, imax) * V;
      if (p > best) best = p;
    }
    return Math.min(best * inv.eta, inv.pmax);
  }

  /** Module-level MPPT (micro inverter / optimiser) power. */
  function modulePower(sim, E, m, t, eta, pcap) {
    const M = sim.M, S = sim.sections;
    const arr = [];
    for (let s = 0; s < S; s++) arr.push(E.cur[(t * M + m) * S + s]);
    arr.sort((a, b) => b - a);
    const v = E.volt[t * M + m];
    let best = 0;
    for (let k = 0; k < S; k++) best = Math.max(best, arr[k] * v * (k + 1));
    return Math.min(best * eta, pcap || 1e9);
  }

  function ideal(sim, E, m, t) {
    const M = sim.M, S = sim.sections; let p = 0;
    for (let s = 0; s < S; s++) p += E.cur[(t * M + m) * S + s] * E.volt[t * M + m];
    return p;
  }
  function unshaded(sim, E, m, t) { return E.cur0[t * sim.M + m] * E.volt[t * sim.M + m] * sim.sections; }

  /** Energy (kWh, before other losses) of a tracker, optionally over a subset of time steps. */
  function trackerEnergy(sim, E, strings, inv, subset) {
    let e = 0;
    if (subset) { for (const t of subset) e += trackerPower(sim, E, strings, t, inv) * sim.steps[t].w; }
    else for (let t = 0; t < sim.T; t++) e += trackerPower(sim, E, strings, t, inv) * sim.steps[t].w;
    return e / 1000;
  }

  /** Full evaluation of a string plan. plan = {trackers:[{strings:[[m...],...]}], unassigned:[m...]} */
  function evaluate(sim, E, plan) {
    const inv = sim.project.inverter, loss = 1 - sim.project.electrical.otherLosses;
    const monthly = new Array(12).fill(0);
    const tr = plan.trackers.map(() => 0);
    const peak = plan.trackers.map(() => 0);
    for (let t = 0; t < sim.T; t++) {
      const w = sim.steps[t].w, mo = sim.steps[t].month;
      plan.trackers.forEach((trk, i) => {
        const p = trackerPower(sim, E, trk.strings, t, inv);
        tr[i] += p * w / 1000; monthly[mo] += p * w / 1000;
        if (p > peak[i]) peak[i] = p;
      });
    }
    return {
      trackers: tr.map(v => v * loss), peak, monthly: monthly.map(v => v * loss),
      total: tr.reduce((a, b) => a + b, 0) * loss
    };
  }

  /** Reference yields: per module (module MPPT), ideal (no mismatch), unshaded; monthly per face. */
  function reference(sim, E) {
    const inv = sim.project.inverter, loss = 1 - sim.project.electrical.otherLosses;
    const M = sim.M;
    const mod = new Float64Array(M), modIdeal = new Float64Array(M), mod0 = new Float64Array(M);
    const monthlyFace = { A: new Array(12).fill(0), B: new Array(12).fill(0) };
    let micro = 0;
    const etaS = inv.eta;
    for (let t = 0; t < sim.T; t++) {
      const w = sim.steps[t].w, mo = sim.steps[t].month;
      for (let m = 0; m < M; m++) {
        const pm = modulePower(sim, E, m, t, 1, 0);
        mod[m] += pm * w; micro += Math.min(pm * inv.microEta, inv.microPmax || 1e9) * w;
        modIdeal[m] += ideal(sim, E, m, t) * w;
        mod0[m] += unshaded(sim, E, m, t) * w;
        monthlyFace[sim.modules[m].face][mo] += pm * etaS * w / 1000 * loss;
      }
    }
    const k = loss * etaS / 1000;
    return {
      module: Array.from(mod, v => v * k),
      moduleUnshaded: Array.from(mod0, v => v * k),
      moduleLoss: Array.from(mod, (v, i) => mod0[i] > 0 ? 1 - modIdeal[i] / mod0[i] : 0),
      ideal: Array.from(modIdeal).reduce((a, b) => a + b, 0) * k,
      unshaded: Array.from(mod0).reduce((a, b) => a + b, 0) * k,
      micro: micro * loss / 1000,
      monthlyFace
    };
  }

  PVP.energy = { prepare, trackerPower, trackerEnergy, modulePower, evaluate, reference };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
