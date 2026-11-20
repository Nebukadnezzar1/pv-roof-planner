/* Module layout: searches row sequences (portrait / landscape) and row offsets per roof face
 * to maximise the number of modules, keeping clearances to obstacles and roof edges. */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};

  function dims(mod, orient) {
    return orient === 'landscape' ? { w: mod.long, h: mod.short } : { w: mod.short, h: mod.long };
  }

  function faceBlocks(project, g, face) {
    const L = project.layout, out = [];
    for (const o of project.obstacles) {
      if (o.face !== face) continue;
      const R = PVP.geom.obstacleRect(g, o);
      const c = (o.clearance !== undefined && o.clearance !== null && o.clearance !== '') ? +o.clearance : L.clearanceDefault;
      out.push({ p0: R.p0 - c, p1: R.p1 + c, s0: R.s0 - c, s1: R.s1 + c, id: o.id });
    }
    return out;
  }

  /** Place one row in band [s, s+h]; returns array of p positions. */
  function placeRow(pMin, pMax, w, gap, s, h, blocks, align, anchor) {
    const hit = blocks.filter(b => b.s0 < s + h - 1e-9 && s < b.s1 - 1e-9);
    const res = [];
    if (align === 'pack') {
      // free intervals between blocks
      const iv = hit.map(b => [b.p0, b.p1]).sort((a, b) => a[0] - b[0]);
      let cur = pMin;
      const free = [];
      for (const [a, b] of iv) { if (a > cur) free.push([cur, Math.min(a, pMax)]); cur = Math.max(cur, b); }
      if (cur < pMax) free.push([cur, pMax]);
      for (const [a, b] of free) {
        const n = Math.floor((b - a + gap + 1e-9) / (w + gap));
        if (n <= 0) continue;
        // centre within the free interval if it touches no roof edge, else push to the edge
        let start = a;
        if (anchor === 'right') start = b - n * w - (n - 1) * gap;
        for (let k = 0; k < n; k++) res.push(start + k * (w + gap));
      }
      return res;
    }
    const n = Math.floor((pMax - pMin + gap + 1e-9) / (w + gap));
    if (n <= 0) return res;
    const span = n * w + (n - 1) * gap;
    const start = anchor === 'right' ? pMax - span : anchor === 'center' ? (pMin + pMax - span) / 2 : pMin;
    for (let k = 0; k < n; k++) {
      const p = start + k * (w + gap);
      if (hit.some(b => b.p0 < p + w - 1e-9 && p < b.p1 - 1e-9)) continue;
      res.push(p);
    }
    return res;
  }

  function sequences(n, policy) {
    const out = [];
    const rec = (cur) => {
      if (cur.length) out.push(cur.slice());
      if (cur.length >= n) return;
      for (const o of (policy === 'portrait' ? ['portrait'] : policy === 'landscape' ? ['landscape'] : ['portrait', 'landscape'])) {
        cur.push(o); rec(cur); cur.pop();
      }
    };
    rec([]);
    return out;
  }

  function layoutFace(project, g, face) {
    const L = project.layout, mod = project.module, F = g.faces[face];
    const [pMin, pMax] = PVP.geom.usableRange(g, face, L);
    const sMin = L.marginEave, sMax = F.slope - L.marginRidge;
    if (pMax - pMin < Math.min(mod.short, mod.long) || sMax - sMin < Math.min(mod.short, mod.long)) return { modules: [], info: { pMin, pMax, sMin, sMax } };
    const blocks = faceBlocks(project, g, face);
    const gap = L.gap;
    const dP = dims(mod, 'portrait'), dL = dims(mod, 'landscape');
    const maxRows = Math.floor((sMax - sMin + gap) / (Math.min(dP.h, dL.h) + gap));
    const seqs = sequences(Math.min(maxRows, 9), L.orientation);
    let best = null;
    const anchors = L.align === 'pack' ? ['left', 'right'] : ['left', 'right', 'center'];
    for (const seq of seqs) {
      const total = seq.reduce((a, o) => a + dims(mod, o).h, 0) + (seq.length - 1) * gap;
      const slack = sMax - sMin - total;
      if (slack < -1e-9) continue;
      const nSteps = Math.min(Math.floor(slack / 0.01 + 1e-9), 150);
      const switches = seq.reduce((a, o, i) => a + (i && o !== seq[i - 1] ? 1 : 0), 0);
      const portraitRows = seq.filter(o => o === 'portrait').length;
      for (const anchor of anchors) {
        for (let k = 0; k <= nSteps; k++) {
          const s0 = sMin + k * 0.01;
          let s = s0, count = 0;
          const rows = [];
          for (const o of seq) {
            const d = dims(mod, o);
            const ps = placeRow(pMin, pMax, d.w, gap, s, d.h, blocks, L.align, anchor);
            rows.push({ orient: o, s, ps, w: d.w, h: d.h });
            count += ps.length; s += d.h + gap;
          }
          const score = [count, -switches, portraitRows, -k, anchor === 'left' ? 1 : 0];
          if (!best || better(score, best.score)) best = { score, rows, seq, anchor, s0 };
        }
      }
    }
    const modules = [];
    if (best) for (const r of best.rows) for (const p of r.ps) modules.push({ face, p, s: r.s, w: r.w, h: r.h, orient: r.orient });
    return { modules, info: { pMin, pMax, sMin, sMax, seq: best && best.seq, anchor: best && best.anchor }, blocks };
  }
  function better(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return false; }

  function numberModules(mods) {
    // face A first; within a face rows from the eave, then left to right (seen from outside)
    mods.sort((a, b) => (a.face < b.face ? -1 : a.face > b.face ? 1 : 0) || (a.s - b.s > 0.05 ? 1 : b.s - a.s > 0.05 ? -1 : a.p - b.p));
    mods.forEach((m, i) => { m.n = i + 1; m.id = m.id || ('m' + (i + 1)); });
    return mods;
  }

  /** Returns modules for the project (auto or fixed) with numbering and ids. */
  function compute(project, g) {
    g = g || PVP.geom.building(project.building);
    const L = project.layout;
    let mods = [];
    const info = {};
    if (L.mode === 'fixed' && L.modules && L.modules.length) {
      const dis = new Set(L.disabled || []);
      mods = L.modules.filter(m => !dis.has(m.id)).map(m => Object.assign({}, m, dims(project.module, m.orient)));
    } else {
      for (const f of ['A', 'B']) {
        if (!L.faces[f]) continue;
        const r = layoutFace(project, g, f);
        info[f] = r.info;
        mods = mods.concat(r.modules);
      }
      mods = numberModules(mods);
      mods.forEach(m => { m.id = 'a' + m.face + Math.round(m.p * 100) + '_' + Math.round(m.s * 100); });
      const dis = new Set(L.disabled || []);
      mods = mods.filter(m => !dis.has(m.id));
    }
    numberModules(mods);
    return { modules: mods, info, warnings: check(project, g, mods) };
  }

  function check(project, g, mods) {
    const w = [];
    for (const f of ['A', 'B']) {
      const [pMin, pMax] = PVP.geom.usableRange(g, f, project.layout);
      const F = g.faces[f];
      const blocks = faceBlocks(project, g, f);
      for (const m of mods.filter(x => x.face === f)) {
        if (m.p < pMin - 0.005 || m.p + m.w > pMax + 0.005 || m.s < project.layout.marginEave - 0.005 || m.s + m.h > F.slope - project.layout.marginRidge + 0.005) w.push({ code: 'margin', n: m.n });
        if (blocks.some(b => b.p0 < m.p + m.w - 0.005 && m.p < b.p1 - 0.005 && b.s0 < m.s + m.h - 0.005 && m.s < b.s1 - 0.005)) w.push({ code: 'obstacle', n: m.n });
      }
    }
    return w;
  }

  /** Freeze the current layout into a fixed list. */
  function freeze(project, mods) {
    project.layout.mode = 'fixed';
    project.layout.modules = mods.map(m => ({ id: m.id, face: m.face, p: +m.p.toFixed(3), s: +m.s.toFixed(3), orient: m.orient }));
  }

  PVP.layout = { compute, layoutFace, faceBlocks, dims, freeze, numberModules };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
