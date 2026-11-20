/* 2D drawings as SVG strings: roof faces seen from outside, site plan, charts; heat map on canvas. */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};
  const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STRING_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#8e5bd6', '#d6457a', '#3aa6b9', '#7a8a1f', '#a0522d', '#5468ff'];

  function compass(az) {
    const n = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const e = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const i = Math.round(((az % 360) + 360) % 360 / 22.5) % 16;
    return (PVP.i18n && PVP.i18n.lang === 'en' ? e : n)[i];
  }

  let FS = 12;
  function dimH(x0, x1, y, label, off) {
    const t = FS * 0.35; off = off === undefined ? -FS * 0.35 : off;
    return `<g class="dim"><line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/><line x1="${x0}" y1="${y - t}" x2="${x0}" y2="${y + t}"/><line x1="${x1}" y1="${y - t}" x2="${x1}" y2="${y + t}"/>` +
      `<text x="${(x0 + x1) / 2}" y="${y + off}" text-anchor="middle">${label}</text></g>`;
  }
  function dimV(x, y0, y1, label) {
    const t = FS * 0.35;
    return `<g class="dim"><line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/><line x1="${x - t}" y1="${y0}" x2="${x + t}" y2="${y0}"/><line x1="${x - t}" y1="${y1}" x2="${x + t}" y2="${y1}"/>` +
      `<text x="${x - FS * 0.4}" y="${(y0 + y1) / 2}" text-anchor="middle" transform="rotate(-90 ${x - FS * 0.4} ${(y0 + y1) / 2})">${label}</text></g>`;
  }

  /** Roof face seen from outside. units: 1 = 1 cm in the viewBox. */
  function faceSVG(project, g, face, modules, opts) {
    opts = opts || {};
    const t = PVP.i18n ? PVP.i18n.t : (k => k);
    const F = g.faces[face], W = g.roofLen * 100, H = F.slope * 100;
    FS = Math.max(14, Math.min(34, W / 42));
    const mx = FS * 5, my = FS * 4.5;
    const X = p => mx + p * 100, Y = s => my + (F.slope - s) * 100;
    let o = `<svg xmlns="http://www.w3.org/2000/svg" class="faceplan" viewBox="0 0 ${W + 2 * mx} ${H + 2 * my + FS * 2}" data-face="${face}">`;
    o += `<style>.faceplan text{font:${FS}px system-ui,sans-serif;fill:#334} .faceplan .dim line{stroke:#556;stroke-width:${FS / 14}} .faceplan .dim text{font-size:${FS * 0.9}px} .faceplan .mod text{font-weight:700;fill:#fff;font-size:${FS * 1.15}px} .faceplan .mod text.sub{font-weight:400;font-size:${FS * 0.8}px}</style>`;
    // roof
    o += `<rect x="${X(0)}" y="${Y(F.slope)}" width="${W}" height="${H}" fill="#e9c9bd" stroke="#7a4030" stroke-width="1.5"/>`;
    // own section
    const sec = project.building.section;
    if (sec.from > 1e-6 || sec.to < g.L - 1e-6) {
      const pa = PVP.geom.uToP(g, face, sec.from > 1e-6 ? sec.from : g.u0), pb = PVP.geom.uToP(g, face, sec.to < g.L - 1e-6 ? sec.to : g.u1);
      const p0 = Math.min(pa, pb), p1 = Math.max(pa, pb);
      o += `<rect x="${X(0)}" y="${Y(F.slope)}" width="${W}" height="${H}" fill="#cfc6c2" opacity=".55"/>`;
      o += `<rect x="${X(p0)}" y="${Y(F.slope)}" width="${(p1 - p0) * 100}" height="${H}" fill="#f0cfc2" stroke="#e08a2a" stroke-width="2"/>`;
      for (const u of [sec.from, sec.to]) if (u > 1e-6 && u < g.L - 1e-6) { const p = PVP.geom.uToP(g, face, u); o += `<line x1="${X(p)}" y1="${Y(F.slope) - 8}" x2="${X(p)}" y2="${Y(0) + 8}" stroke="#e08a2a" stroke-width="2" stroke-dasharray="6 4"/>`; }
    }
    // usable area
    const L = project.layout;
    const [pMin, pMax] = PVP.geom.usableRange(g, face, L);
    o += `<rect x="${X(pMin)}" y="${Y(F.slope - L.marginRidge)}" width="${(pMax - pMin) * 100}" height="${(F.slope - L.marginRidge - L.marginEave) * 100}" fill="none" stroke="#7a4030" stroke-dasharray="5 4" stroke-width=".8"/>`;
    // obstacles
    const obLabels = [];
    for (const ob of project.obstacles.filter(x => x.face === face)) {
      const R = PVP.geom.obstacleRect(g, ob);
      const c = (ob.clearance !== undefined && ob.clearance !== null && ob.clearance !== '') ? +ob.clearance : L.clearanceDefault;
      o += `<rect x="${X(R.p0 - c)}" y="${Y(R.s1 + c)}" width="${(R.p1 - R.p0 + 2 * c) * 100}" height="${(R.s1 - R.s0 + 2 * c) * 100}" fill="none" stroke="#555" stroke-dasharray="3 3" stroke-width=".8"/>`;
      o += `<rect x="${X(R.p0)}" y="${Y(R.s1)}" width="${(R.p1 - R.p0) * 100}" height="${(R.s1 - R.s0) * 100}" fill="${ob.kind === 'window' ? '#3b4f63' : ob.kind === 'chimney' ? '#7a5a4a' : '#8a8a8a'}" stroke="#222"/>`;
      obLabels.push(`<text x="${X((R.p0 + R.p1) / 2)}" y="${Y(R.s1 + c) - FS * 0.3}" text-anchor="middle" style="paint-order:stroke;stroke:#fff;stroke-width:${FS / 4}px">${esc(ob.label || t('kind_' + ob.kind))}</text>`);
    }
    // modules
    modules.forEach((m, i) => {
      if (m.face !== face) return;
      const col = (opts.colors && opts.colors[i]) || (m.disabled ? '#9aa4b2' : '#1d2f4d');
      o += `<g class="mod" data-mod="${i}" style="cursor:pointer"><rect x="${X(m.p)}" y="${Y(m.s + m.h)}" width="${m.w * 100}" height="${m.h * 100}" fill="${col}" stroke="#d7dde6" stroke-width="1.5" rx="2"/>`;
      o += `<text x="${X(m.p + m.w / 2)}" y="${Y(m.s + m.h / 2) + (opts.sub ? -FS * 0.1 : FS * 0.4)}" text-anchor="middle">${m.n}</text>`;
      if (opts.sub && opts.sub[i]) o += `<text class="sub" x="${X(m.p + m.w / 2)}" y="${Y(m.s + m.h / 2) + FS * 1.0}" text-anchor="middle">${esc(opts.sub[i])}</text>`;
      o += `</g>`;
    });
    o += obLabels.join('');
    // dimensions
    o += dimH(X(0), X(g.roofLen), Y(0) + FS * 1.6, f2(g.roofLen) + ' m');
    o += dimV(X(0) - FS * 1.6, Y(F.slope), Y(0), f2(F.slope) + ' m');
    const fm = modules.filter(m => m.face === face);
    if (fm.length) {
      const a = Math.min(...fm.map(m => m.p)), b = Math.max(...fm.map(m => m.p + m.w));
      const s0 = Math.min(...fm.map(m => m.s)), s1 = Math.max(...fm.map(m => m.s + m.h));
      o += dimH(X(a), X(b), Y(F.slope) - FS * 1.2, f2(b - a) + ' m');
      if (a > 0.05) o += dimH(X(0), X(a), Y(F.slope) - FS * 1.2, f2(a));
      o += dimV(X(g.roofLen) + FS * 2.4, Y(s1), Y(s0), f2(s1 - s0) + ' m');
      if (s0 > 0.05) o += dimV(X(g.roofLen) + FS * 2.4, Y(s0), Y(0), f2(s0));
    }
    o += `<text x="${X(g.roofLen / 2)}" y="${Y(0) + FS * 3.1}" text-anchor="middle" style="font-weight:600">${t('eave')}</text>`;
    o += `<text x="${X(g.roofLen / 2)}" y="${Y(F.slope) - FS * 2.6}" text-anchor="middle" style="font-weight:600">${t('ridge')}</text>`;
    o += `</svg>`;
    return o;
  }

  /** Top view of the site; selection callback via data attributes. */
  function siteSVG(project, g, modules, opts) {
    opts = opts || {};
    const pts = [];
    const G = PVP.geom;
    const outline = [[g.u0, g.vEA], [g.u1, g.vEA], [g.u1, g.vEB], [g.u0, g.vEB]].map(([u, v]) => { const w = G.toWorld(g, u, v, 0); return [w[0], -w[2]]; });
    pts.push(...outline);
    for (const nb of project.neighbors) pts.push(...(nb.footprint || []));
    for (const t of project.trees || []) pts.push([t.e - t.crownRadius, t.n - t.crownRadius], [t.e + t.crownRadius, t.n + t.crownRadius]);
    let x0 = Math.min(...pts.map(p => p[0])) - 4, x1 = Math.max(...pts.map(p => p[0])) + 4;
    let y0 = Math.min(...pts.map(p => p[1])) - 4, y1 = Math.max(...pts.map(p => p[1])) + 4;
    const S = 10; // px per m
    const X = e => (e - x0) * S, Y = n => (y1 - n) * S;
    const P = arr => arr.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    let o = `<svg xmlns="http://www.w3.org/2000/svg" class="siteplan" viewBox="0 0 ${(x1 - x0) * S} ${(y1 - y0) * S}">`;
    o += `<style>.siteplan text{font:11px system-ui,sans-serif;fill:#334}</style>`;
    for (const nb of project.neighbors) {
      if (!nb.footprint) continue;
      o += `<polygon points="${P(nb.footprint)}" fill="#c9ccd1" stroke="#6b7280" data-nb="${nb.id}"/>`;
      const c = nb.footprint.reduce((a, p) => [a[0] + p[0] / nb.footprint.length, a[1] + p[1] / nb.footprint.length], [0, 0]);
      o += `<text x="${X(c[0])}" y="${Y(c[1]) + 4}" text-anchor="middle">${(nb.ridgeHeight || nb.wallHeight || 0).toFixed(1)} m</text>`;
    }
    for (const t of project.trees || []) o += `<circle cx="${X(t.e)}" cy="${Y(t.n)}" r="${t.crownRadius * S}" fill="${t.type === 'conifer' ? '#2f6b3a' : '#4f8a3c'}" opacity=".75"/><text x="${X(t.e)}" y="${Y(t.n) + 4}" text-anchor="middle" style="fill:#fff">${t.height} m</text>`;
    o += `<polygon points="${P(outline)}" fill="#e9c9bd" stroke="#7a4030" stroke-width="1.5"/>`;
    const ridge = [[g.u0, g.r], [g.u1, g.r]].map(([u, v]) => { const w = G.toWorld(g, u, v, 0); return [w[0], -w[2]]; });
    o += `<polyline points="${P(ridge)}" stroke="#7a4030" stroke-width="2"/>`;
    for (const m of modules) {
      const c = [[m.p, m.s], [m.p + m.w, m.s], [m.p + m.w, m.s + m.h], [m.p, m.s + m.h]].map(([p, s]) => { const w = G.facePoint(g, m.face, p, s); return [w[0], -w[2]]; });
      o += `<polygon points="${P(c)}" fill="#1d2f4d" stroke="#d7dde6" stroke-width=".6"/>`;
    }
    // face labels
    for (const f of ['A', 'B']) {
      const F = g.faces[f]; const w = G.facePoint(g, f, g.roofLen / 2, F.slope * 0.25);
      o += `<text x="${X(w[0])}" y="${Y(-w[2])}" text-anchor="middle" style="font-weight:700">${f} · ${compass(F.azimuth)}</text>`;
    }
    // north arrow + scale
    const nx = (x1 - x0) * S - 30, ny = 40;
    o += `<g transform="translate(${nx},${ny})"><polygon points="0,-22 8,8 0,2 -8,8" fill="#c0392b"/><text x="0" y="22" text-anchor="middle" style="font-weight:700">N</text></g>`;
    o += `<g transform="translate(20,${(y1 - y0) * S - 20})"><rect width="${10 * S}" height="5" fill="#334"/><text x="${5 * S}" y="-4" text-anchor="middle">10 m</text></g>`;
    o += `</svg>`;
    return o;
  }

  /** Heat map: x = day of year, y = local time, value = shaded share (0..100), 101 = face not lit. */
  function drawHeat(canvas, sim, sel, tz) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const ml = 34, mb = 18, mt = 4, mr = 4;
    ctx.clearRect(0, 0, W, H);
    const slots = sim.heatSlots, step = 1440 / slots;
    const pw = (W - ml - mr) / 365, ph = (H - mt - mb) / (24 * 60 / step);
    const mods = sel === 'all' ? sim.modules.map((_, i) => i) : sel === 'A' || sel === 'B' ? sim.modules.map((m, i) => m.face === sel ? i : -1).filter(i => i >= 0) : [sel];
    if (!mods.length) return;
    for (let d = 0; d < 365; d++) {
      const off = PVP.sun.dayOffset(tz, d);
      for (let k = 0; k < slots; k++) {
        let sum = 0, n = 0, unlit = 0;
        for (const m of mods) { const v = sim.heat[(m * 365 + d) * slots + k]; if (v === 255) continue; if (v === 101) { unlit++; continue; } sum += v; n++; }
        if (!n && !unlit) continue;
        const localMin = ((k + 0.5) * step + off + 1440) % 1440;
        const y = mt + (localMin / step) * ph;
        let col;
        if (!n) col = '#d9dde3';
        else { const v = sum / n / 100; const a = Math.pow(v, 0.6); col = `rgb(${Math.round(240 - 200 * a)},${Math.round(244 - 190 * a)},${Math.round(250 - 120 * a)})`; if (v < 0.005) col = '#fff6cf'; }
        ctx.fillStyle = col; ctx.fillRect(ml + d * pw, y - ph / 2, Math.ceil(pw), Math.ceil(ph) + 0.5);
      }
    }
    ctx.fillStyle = '#334'; ctx.font = '10px system-ui,sans-serif'; ctx.textAlign = 'right';
    for (let h = 0; h <= 24; h += 3) { const y = mt + h * 60 / step * ph; ctx.fillText(h + ':00', ml - 3, y + 3); ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(ml, y, W - ml - mr, 1); ctx.fillStyle = '#334'; }
    ctx.textAlign = 'center';
    const mn = PVP.i18n ? PVP.i18n.months() : ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    for (let m = 0; m < 12; m++) { const x = ml + (PVP.sun.MONTH_START[m] + 15) * pw; ctx.fillText(mn[m], x, H - 5); ctx.fillStyle = 'rgba(0,0,0,.1)'; ctx.fillRect(ml + PVP.sun.MONTH_START[m] * pw, mt, 1, H - mt - mb); ctx.fillStyle = '#334'; }
  }

  /** Monthly bar chart for two series (faces). */
  function monthlySVG(series, labels, colors) {
    const W = 640, H = 220, ml = 44, mb = 24, mt = 12;
    const max = Math.max(1, ...series[0].map((_, i) => series.reduce((a, s) => a + s[i], 0)));
    const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
    const bw = (W - ml - 10) / 12;
    let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="chart"><style>.chart text{font:11px system-ui,sans-serif;fill:#445}</style>`;
    for (let k = 0; k <= 4; k++) { const v = top * k / 4, y = H - mb - (H - mb - mt) * k / 4; o += `<line x1="${ml}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#e3e7ec"/><text x="${ml - 6}" y="${y + 4}" text-anchor="end">${Math.round(v)}</text>`; }
    const mn = PVP.i18n ? PVP.i18n.months() : [];
    for (let i = 0; i < 12; i++) {
      let y = H - mb;
      series.forEach((s, k) => { const h = (H - mb - mt) * s[i] / top; o += `<rect x="${ml + i * bw + 4}" y="${y - h}" width="${bw - 8}" height="${h}" fill="${colors[k]}"><title>${esc(labels[k])}: ${Math.round(s[i])} kWh</title></rect>`; y -= h; });
      o += `<text x="${ml + i * bw + bw / 2}" y="${H - 7}" text-anchor="middle">${mn[i] || i + 1}</text>`;
    }
    o += `</svg>`;
    return o;
  }

  PVP.plan2d = { faceSVG, siteSVG, drawHeat, monthlySVG, compass, STRING_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
