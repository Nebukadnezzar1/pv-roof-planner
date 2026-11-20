/* Annual shading and irradiance simulation.
 * Every module is sampled cell by cell; cells belong to a bypass-diode section and (half-cut modules)
 * to one of two parallel halves. Beam shading is found by projecting all occluders onto a plane
 * perpendicular to the sun direction (a geometric shadow map) for every time step.
 * Irradiance: monthly GHI scaled clear-sky course, monthly diffuse fraction, Hay–Davies sky model
 * (circumsolar part treated like beam and shaded with it), ground reflection. */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};
  const D2R = Math.PI / 180;

  const QUALITY = {
    fast: { step: 60, stride: 4, rowDiv: 3 },
    normal: { step: 30, stride: 2, rowDiv: 2 },
    fine: { step: 15, stride: 1, rowDiv: 1 }
  };

  function prepare(project, modules, opts) {
    opts = opts || {};
    const q = QUALITY[opts.quality || (project.sim && project.sim.quality) || 'normal'];
    const g = PVP.geom.building(project.building);
    const mod = project.module;
    const clim = PVP.project.climate(project);
    const sections = Math.max(1, mod.bypassDiodes | 0);
    // ---- sample points ----
    const pts = []; // [x,y,z, moduleIndex, section, half, faceIdx]
    modules.forEach((m, mi) => {
      const rowsLong = Math.max(2, Math.round(mod.cellsLong / q.rowDiv));
      const colsShort = mod.cellsShort;
      for (let c = 0; c < colsShort; c++) {
        for (let r = 0; r < rowsLong; r++) {
          const section = Math.min(sections - 1, Math.floor(c * sections / colsShort));
          const half = mod.halfCut ? (r < rowsLong / 2 ? 0 : 1) : 0;
          let dp, ds;
          if (m.orient === 'landscape') { dp = (r + 0.5) / rowsLong * m.w; ds = (c + 0.5) / colsShort * m.h; }
          else { dp = (c + 0.5) / colsShort * m.w; ds = (r + 0.5) / rowsLong * m.h; }
          const w = PVP.geom.facePoint(g, m.face, m.p + dp, m.s + ds, mod.lift);
          pts.push([w[0], w[1], w[2], mi, section, half, m.face === 'A' ? 0 : 1]);
        }
      }
    });
    const NP = pts.length;
    const P = { x: new Float64Array(NP), y: new Float64Array(NP), z: new Float64Array(NP), m: new Int32Array(NP), sec: new Int32Array(NP), half: new Int32Array(NP), face: new Int32Array(NP) };
    pts.forEach((p, i) => { P.x[i] = p[0]; P.y[i] = p[1]; P.z[i] = p[2]; P.m[i] = p[3]; P.sec[i] = p[4]; P.half[i] = p[5]; P.face[i] = p[6]; });
    // ---- occluders ----
    const occ = PVP.geom.occluders(project, g);
    const NT = occ.tris.length;
    const T9 = new Float64Array(NT * 9);
    occ.tris.forEach((t, i) => { for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) T9[i * 9 + k * 3 + j] = t[k][j]; });
    // ---- time steps ----
    const steps = [];
    const cs = new Array(12).fill(0);
    for (let d = 0; d < 365; d += q.stride) {
      const nd = Math.min(q.stride, 365 - d);
      for (let mUTC = q.step / 2; mUTC < 1440; mUTC += q.step) {
        const sp = PVP.sun.position(project.site.lat, project.site.lon, d + (nd - 1) / 2, mUTC);
        if (sp.el <= 0.3) continue;
        const month = PVP.sun.monthOfDay(Math.min(364, d + Math.floor(nd / 2)));
        const w = nd * q.step / 60; // hours represented
        steps.push({ day: d, nd, min: mUTC, el: sp.el, az: sp.az, month, w });
        cs[month] += PVP.sun.clearSkyGHI(sp.el) * w;
      }
    }
    const scale = cs.map((v, i) => v > 0 ? clim.ghi[i] * 1000 / v : 0);
    const faceNormals = [g.faces.A.normal, g.faces.B.normal];
    const faceCos = [g.faces.A.cos, g.faces.B.cos];
    const M = modules.length, T = steps.length;
    return {
      project, modules, g, q, clim, P, NP, T9, NT, spheres: occ.spheres, steps, scale, faceNormals, faceCos, M, T, sections,
      gsec: new Float32Array(T * M * sections),
      g0: new Float32Array(T * M),
      beamFrac: new Float32Array(T * M),   // unshaded beam fraction per module (for statistics)
      faceShaded: new Uint8Array(T * 2),    // 1 if any point on the face is (partly) shaded
      heatSlots: 1440 / q.step,
      heat: new Uint8Array(M * 365 * (1440 / q.step)).fill(255),
      next: 0, done: false
    };
  }

  // scratch buffers
  let scratch = null;
  function getScratch(NP, NT) {
    if (!scratch || scratch.np < NP || scratch.nt < NT) {
      const np = Math.max(NP, 16), nt = Math.max(NT, 16);
      scratch = { np, nt, a: new Float64Array(np), b: new Float64Array(np), dep: new Float64Array(np), tr: new Float64Array(np), act: new Uint8Array(np),
        T: new Float64Array(nt * 14), rel: new Int32Array(nt), cellCount: null, cellIdx: null };
    }
    return scratch;
  }

  /** Beam transmission (0..1) per point for sun direction D. */
  function shadowStep(ctx, D, month) {
    const { P, NP, T9, NT, spheres } = ctx;
    const S = getScratch(NP, NT);
    // basis perpendicular to D
    let ax = Math.abs(D[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [D[1] * ax[2] - D[2] * ax[1], D[2] * ax[0] - D[0] * ax[2], D[0] * ax[1] - D[1] * ax[0]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
    const e2 = [D[1] * e1[2] - D[2] * e1[1], D[2] * e1[0] - D[0] * e1[2], D[0] * e1[1] - D[1] * e1[0]];
    let minA = 1e9, maxA = -1e9, minB = 1e9, maxB = -1e9, minDep = 1e9, nAct = 0;
    for (let i = 0; i < NP; i++) {
      S.tr[i] = 1;
      if (!S.act[i]) continue;
      const x = P.x[i], y = P.y[i], z = P.z[i];
      const a = x * e1[0] + y * e1[1] + z * e1[2], b = x * e2[0] + y * e2[1] + z * e2[2];
      S.a[i] = a; S.b[i] = b; S.dep[i] = x * D[0] + y * D[1] + z * D[2];
      if (a < minA) minA = a; if (a > maxA) maxA = a; if (b < minB) minB = b; if (b > maxB) maxB = b;
      if (S.dep[i] < minDep) minDep = S.dep[i];
      nAct++;
    }
    if (!nAct) return S.tr;
    // relevant triangles
    const TT = S.T; let nRel = 0;
    for (let t = 0; t < NT; t++) {
      const o = t * 9;
      let ta = [0, 0, 0], tb = [0, 0, 0], td = [0, 0, 0];
      let dmax = -1e9;
      for (let k = 0; k < 3; k++) {
        const x = T9[o + k * 3], y = T9[o + k * 3 + 1], z = T9[o + k * 3 + 2];
        ta[k] = x * e1[0] + y * e1[1] + z * e1[2]; tb[k] = x * e2[0] + y * e2[1] + z * e2[2]; td[k] = x * D[0] + y * D[1] + z * D[2];
        if (td[k] > dmax) dmax = td[k];
      }
      if (dmax <= minDep + 1e-4) continue;
      const a0 = Math.min(ta[0], ta[1], ta[2]), a1 = Math.max(ta[0], ta[1], ta[2]);
      const b0 = Math.min(tb[0], tb[1], tb[2]), b1 = Math.max(tb[0], tb[1], tb[2]);
      if (a1 < minA || a0 > maxA || b1 < minB || b0 > maxB) continue;
      const v0a = ta[1] - ta[0], v0b = tb[1] - tb[0], v1a = ta[2] - ta[0], v1b = tb[2] - tb[0];
      const d00 = v0a * v0a + v0b * v0b, d01 = v0a * v1a + v0b * v1b, d11 = v1a * v1a + v1b * v1b;
      const den = d00 * d11 - d01 * d01;
      if (Math.abs(den) < 1e-12) continue;
      const k = nRel * 14;
      TT[k] = ta[0]; TT[k + 1] = tb[0]; TT[k + 2] = v0a; TT[k + 3] = v0b; TT[k + 4] = v1a; TT[k + 5] = v1b;
      TT[k + 6] = d00; TT[k + 7] = d01; TT[k + 8] = d11; TT[k + 9] = 1 / den;
      TT[k + 10] = td[0]; TT[k + 11] = td[1]; TT[k + 12] = td[2];
      S.rel[nRel * 1] = t;
      // store bbox for binning
      TT[k + 13] = 0;
      bboxes[nRel * 4] = a0; bboxes[nRel * 4 + 1] = a1; bboxes[nRel * 4 + 2] = b0; bboxes[nRel * 4 + 3] = b1;
      nRel++;
    }
    if (nRel) {
      // uniform grid over the points' projected bbox
      const ext = Math.max(maxA - minA, maxB - minB, 0.5);
      const cell = Math.max(0.25, ext / 96);
      const nx = Math.max(1, Math.ceil((maxA - minA) / cell) + 1), ny = Math.max(1, Math.ceil((maxB - minB) / cell) + 1);
      const NC = nx * ny;
      if (!S.cellCount || S.cellCount.length < NC + 1) { S.cellCount = new Int32Array(NC + 1); }
      const cc = S.cellCount; cc.fill(0, 0, NC + 1);
      const rng = new Int32Array(nRel * 4);
      let total = 0;
      for (let r = 0; r < nRel; r++) {
        const i0 = Math.max(0, Math.floor((bboxes[r * 4] - minA) / cell)), i1 = Math.min(nx - 1, Math.floor((bboxes[r * 4 + 1] - minA) / cell));
        const j0 = Math.max(0, Math.floor((bboxes[r * 4 + 2] - minB) / cell)), j1 = Math.min(ny - 1, Math.floor((bboxes[r * 4 + 3] - minB) / cell));
        rng[r * 4] = i0; rng[r * 4 + 1] = i1; rng[r * 4 + 2] = j0; rng[r * 4 + 3] = j1;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { cc[j * nx + i + 1]++; total++; }
      }
      for (let c = 0; c < NC; c++) cc[c + 1] += cc[c];
      if (!S.cellIdx || S.cellIdx.length < total) S.cellIdx = new Int32Array(Math.max(total, 1024) * 2);
      const fill = new Int32Array(NC);
      for (let r = 0; r < nRel; r++) {
        for (let j = rng[r * 4 + 2]; j <= rng[r * 4 + 3]; j++) for (let i = rng[r * 4]; i <= rng[r * 4 + 1]; i++) {
          const c = j * nx + i; S.cellIdx[cc[c] + fill[c]++] = r;
        }
      }
      const idx = S.cellIdx;
      for (let i = 0; i < NP; i++) {
        if (!S.act[i]) continue;
        const ci = Math.min(nx - 1, Math.floor((S.a[i] - minA) / cell)), cj = Math.min(ny - 1, Math.floor((S.b[i] - minB) / cell));
        const c = cj * nx + ci;
        const pa = S.a[i], pb = S.b[i], pd = S.dep[i];
        for (let q = cc[c]; q < cc[c + 1]; q++) {
          const k = idx[q] * 14;
          const v2a = pa - TT[k], v2b = pb - TT[k + 1];
          const d20 = v2a * TT[k + 2] + v2b * TT[k + 3], d21 = v2a * TT[k + 4] + v2b * TT[k + 5];
          const v = (TT[k + 8] * d20 - TT[k + 7] * d21) * TT[k + 9];
          if (v < -1e-9) continue;
          const w = (TT[k + 6] * d21 - TT[k + 7] * d20) * TT[k + 9];
          if (w < -1e-9 || v + w > 1 + 1e-9) continue;
          const dt = (1 - v - w) * TT[k + 10] + v * TT[k + 11] + w * TT[k + 12];
          if (dt > pd + 1e-3) { S.tr[i] = 0; break; }
        }
      }
    }
    // trees: semi-transparent spheres
    if (spheres && spheres.length) {
      for (const sp of spheres) {
        const op = PVP.geom.treeOpacity(sp.tree, month);
        const cx = sp.c[0], cy = sp.c[1], cz = sp.c[2], r2 = sp.r * sp.r;
        for (let i = 0; i < NP; i++) {
          if (!S.act[i] || S.tr[i] === 0) continue;
          const vx = cx - P.x[i], vy = cy - P.y[i], vz = cz - P.z[i];
          const t = vx * D[0] + vy * D[1] + vz * D[2];
          if (t <= 0) continue;
          const d2 = vx * vx + vy * vy + vz * vz - t * t;
          if (d2 < r2) {
            // path length through the sphere relative to the diameter
            const chord = 2 * Math.sqrt(r2 - d2) / (2 * sp.r);
            S.tr[i] *= 1 - op * Math.min(1, 0.35 + 0.65 * chord);
          }
        }
      }
    }
    return S.tr;
  }
  let bboxes = new Float64Array(4 * 4096);

  /** Process up to maxSteps time steps. Returns progress 0..1. */
  function step(ctx, maxSteps) {
    const { P, NP, steps, M, sections, project, faceNormals, faceCos, clim } = ctx;
    const S = getScratch(NP, ctx.NT);
    if (bboxes.length < ctx.NT * 4) bboxes = new Float64Array(ctx.NT * 4);
    const albedo = project.site.albedo;
    const minG = new Float64Array(M * sections * 2);
    const pts = new Int32Array(M), shadedPts = new Float64Array(M);
    const end = Math.min(steps.length, ctx.next + (maxSteps || steps.length));
    for (let ti = ctx.next; ti < end; ti++) {
      const st = steps[ti];
      const D = PVP.sun.direction(st.el, st.az);
      const cz = Math.sin(st.el * D2R);
      const I0 = PVP.sun.extraterrestrial(st.day);
      const ghi = ctx.scale[st.month] * PVP.sun.clearSkyGHI(st.el);
      const dhi = clim.diffuse[st.month] * ghi;
      const dni = Math.min((ghi - dhi) / Math.max(cz, 0.05), I0);
      const Ai = dni / I0;
      const beamH = dni + dhi * Ai / Math.max(cz, 0.087);
      const cosi = [0, 0], diff = [0, 0], beam = [0, 0];
      for (let f = 0; f < 2; f++) {
        const n = faceNormals[f];
        cosi[f] = n[0] * D[0] + n[1] * D[1] + n[2] * D[2];
        diff[f] = dhi * (1 - Ai) * (1 + faceCos[f]) / 2 + ghi * albedo * (1 - faceCos[f]) / 2;
        beam[f] = beamH * Math.max(cosi[f], 0);
      }
      for (let i = 0; i < NP; i++) S.act[i] = cosi[P.face[i]] > 0 ? 1 : 0;
      const tr = shadowStep(ctx, D, st.month);
      minG.fill(1e9); pts.fill(0); shadedPts.fill(0);
      let fsh0 = 0, fsh1 = 0;
      for (let i = 0; i < NP; i++) {
        const f = P.face[i], m = P.m[i];
        const t = S.act[i] ? tr[i] : 0;
        const G = diff[f] + beam[f] * t;
        const k = (m * sections + P.sec[i]) * 2 + P.half[i];
        if (G < minG[k]) minG[k] = G;
        pts[m]++; shadedPts[m] += S.act[i] ? (1 - t) : 0;
        if (S.act[i] && t < 0.999) { if (f) fsh1 = 1; else fsh0 = 1; }
      }
      ctx.faceShaded[ti * 2] = fsh0; ctx.faceShaded[ti * 2 + 1] = fsh1;
      const slot = Math.floor(st.min / ctx.q.step);
      for (let m = 0; m < M; m++) {
        const f = ctx.modules[m].face === 'A' ? 0 : 1;
        const halves = project.module.halfCut ? 2 : 1;
        for (let s = 0; s < sections; s++) {
          let v = 0;
          for (let h = 0; h < halves; h++) v += minG[(m * sections + s) * 2 + h];
          ctx.gsec[(ti * M + m) * sections + s] = v / halves;
        }
        ctx.g0[ti * M + m] = diff[f] + beam[f];
        const frac = pts[m] ? shadedPts[m] / pts[m] : 0;
        ctx.beamFrac[ti * M + m] = cosi[f] > 0 ? 1 - frac : 0;
        const hv = cosi[f] > 0 ? Math.round(100 * frac) : 101;
        for (let dd = 0; dd < st.nd; dd++) ctx.heat[(m * 365 + st.day + dd) * ctx.heatSlots + slot] = hv;
      }
    }
    ctx.next = end;
    if (end >= steps.length) ctx.done = true;
    return steps.length ? end / steps.length : 1;
  }

  function run(project, modules, opts) {
    const ctx = prepare(project, modules, opts);
    step(ctx);
    return ctx;
  }

  /** Beam transmission for all module sample points at one instant (for the 3D view). */
  function instant(ctx, day, minutesUTC) {
    const sp = PVP.sun.position(ctx.project.site.lat, ctx.project.site.lon, day, minutesUTC);
    const out = new Float32Array(ctx.M).fill(-1);
    if (sp.el <= 0) return { sun: sp, modules: out };
    const D = PVP.sun.direction(sp.el, sp.az);
    const S = getScratch(ctx.NP, ctx.NT);
    if (bboxes.length < ctx.NT * 4) bboxes = new Float64Array(ctx.NT * 4);
    const cosi = ctx.faceNormals.map(n => n[0] * D[0] + n[1] * D[1] + n[2] * D[2]);
    for (let i = 0; i < ctx.NP; i++) S.act[i] = cosi[ctx.P.face[i]] > 0 ? 1 : 0;
    const tr = shadowStep(ctx, D, PVP.sun.monthOfDay(day));
    const sum = new Float64Array(ctx.M), cnt = new Float64Array(ctx.M);
    for (let i = 0; i < ctx.NP; i++) { const m = ctx.P.m[i]; cnt[m]++; sum[m] += S.act[i] ? tr[i] : 0; }
    for (let m = 0; m < ctx.M; m++) out[m] = cosi[ctx.modules[m].face === 'A' ? 0 : 1] > 0 ? sum[m] / cnt[m] : -1;
    return { sun: sp, modules: out, cosi };
  }

  PVP.shade = { prepare, step, run, instant, QUALITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
