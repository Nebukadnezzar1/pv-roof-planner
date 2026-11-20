/* Exports: project JSON, module CSV, DXF (R12, 3DFACE/LINE, 1 unit = 1 m). */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function csv(project, modules, extra) {
    const sep = ';', dec = v => String(v).replace('.', PVP.i18n && PVP.i18n.lang === 'en' ? '.' : ',');
    const t = PVP.i18n ? PVP.i18n.t : (k => k);
    const head = ['#', t('csv_face'), t('csv_orient'), t('csv_tracker'), t('csv_string'), t('csv_p'), t('csv_s'), t('csv_w'), t('csv_h'), t('csv_loss'), t('csv_kwh')];
    const rows = [head.join(sep)];
    modules.forEach((m, i) => {
      const e = extra && extra[i] || {};
      rows.push([m.n, m.face, m.orient, e.tracker || '', e.string || '', dec(m.p.toFixed(3)), dec(m.s.toFixed(3)), dec(m.w), dec(m.h),
        e.loss !== undefined ? dec((e.loss * 100).toFixed(1)) : '', e.kwh !== undefined ? Math.round(e.kwh) : ''].join(sep));
    });
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  /** DXF R12 writer. Coordinates: X east, Y north, Z up. */
  function dxf(project, modules) {
    const G = PVP.geom, g = G.building(project.building);
    const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '8'];
    const layers = [['ROOF', 30], ['WALLS', 8], ['OBSTACLES', 1], ['NEIGHBOURS', 9], ['TREES', 3], ['MODULES', 5], ['GROUND', 254], ['TEXT', 7]];
    for (const [n, c] of layers) out.push('0', 'LAYER', '2', n, '70', '0', '62', String(c), '6', 'CONTINUOUS');
    out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    const W = p => [p[0], -p[2], p[1]];   // world (x east, y up, z south) → DXF (x east, y north, z up)
    const f = v => (Math.round(v * 1000) / 1000).toString();
    const face3 = (layer, a, b, c, d) => {
      d = d || c; a = W(a); b = W(b); c = W(c); d = W(d);
      out.push('0', '3DFACE', '8', layer);
      [a, b, c, d].forEach((p, i) => out.push(String(10 + i), f(p[0]), String(20 + i), f(p[1]), String(30 + i), f(p[2])));
    };
    const bm = G.buildingMesh(g);
    for (const t of bm.walls) face3('WALLS', t[0], t[1], t[2]);
    for (const k of ['A', 'B']) { const c = bm.roof[k]; face3('ROOF', c[0], c[1], c[2], c[3]); }
    for (const o of project.obstacles) {
      if (o.top > 0) {
        const B = G.obstacleBox(g, o);
        face3('OBSTACLES', B.top[0], B.top[1], B.top[2], B.top[3]);
        for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; face3('OBSTACLES', B.base[i], B.base[j], B.top[j], B.top[i]); }
      } else {
        const R = G.obstacleRect(g, o);
        const q = [[R.p0, R.s0], [R.p1, R.s0], [R.p1, R.s1], [R.p0, R.s1]].map(([p, s]) => G.facePoint(g, o.face, p, s, 0.02));
        face3('OBSTACLES', q[0], q[1], q[2], q[3]);
      }
    }
    for (const nb of project.neighbors) {
      if (!nb.footprint || nb.footprint.length < 3) continue;
      const m = G.neighborMesh(nb);
      for (const t of m.walls.concat(m.roof)) face3('NEIGHBOURS', t[0], t[1], t[2]);
    }
    for (const t of project.trees || []) {
      const s = G.treeSphere(t), n = 8;
      for (let k = 0; k < n; k++) {
        const a = 2 * Math.PI * k / n, b = 2 * Math.PI * (k + 1) / n;
        const p1 = [s.c[0] + s.r * Math.cos(a), s.c[1], s.c[2] + s.r * Math.sin(a)], p2 = [s.c[0] + s.r * Math.cos(b), s.c[1], s.c[2] + s.r * Math.sin(b)];
        face3('TREES', [s.c[0], s.c[1] + s.r, s.c[2]], p1, p2); face3('TREES', [s.c[0], s.c[1] - s.r, s.c[2]], p2, p1);
      }
    }
    const th = project.module.thickness || 0.03;
    for (const m of modules || []) {
      const c = [[m.p, m.s], [m.p + m.w, m.s], [m.p + m.w, m.s + m.h], [m.p, m.s + m.h]].map(([p, s]) => G.facePoint(g, m.face, p, s, project.module.lift + th));
      face3('MODULES', c[0], c[1], c[2], c[3]);
      const mid = W(G.facePoint(g, m.face, m.p + m.w / 2, m.s + m.h / 2, project.module.lift + th + 0.01));
      out.push('0', 'TEXT', '8', 'TEXT', '10', f(mid[0]), '20', f(mid[1]), '30', f(mid[2]), '40', '0.25', '1', String(m.n));
    }
    const R = 40;
    face3('GROUND', [-R, 0, -R], [R, 0, -R], [R, 0, R], [-R, 0, R]);
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  PVP.exporter = { download, csv, dxf };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
