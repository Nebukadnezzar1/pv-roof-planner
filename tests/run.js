/* Minimal test runner without dependencies: node tests/run.js */
'use strict';
const path = require('path');
const fs = require('fs');
for (const f of ['project', 'sun', 'geometry', 'layout', 'shade', 'energy', 'strings', 'osm', 'export', 'i18n']) require(path.join(__dirname, '..', 'js', f + '.js'));
require(path.join(__dirname, '..', 'examples', 'example.js'));
const PVP = globalThis.PVP;

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e && e.stack || e)); }
}
function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || ''} expected ${b} ± ${tol}, got ${a}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

console.log('sun');
test('solar noon elevation at the equinox ≈ 90° − latitude', () => {
  // 20 March (day 78) near 12:00 solar time at lon 0
  let best = -90;
  for (let m = 660; m <= 780; m += 1) best = Math.max(best, PVP.sun.position(48, 0, 78, m).el);
  near(best, 42, 0.8);
});
test('sun at summer solstice noon in Berlin ~ 61.6°', () => {
  let best = -90;
  for (let m = 600; m <= 720; m += 1) best = Math.max(best, PVP.sun.position(52.52, 13.4, 171, m).el);
  near(best, 60.9, 0.8);
});
test('azimuth is south at solar noon (northern hemisphere)', () => {
  let bestEl = -90, az = 0;
  for (let m = 600; m <= 720; m += 1) { const p = PVP.sun.position(48, 9, 171, m); if (p.el > bestEl) { bestEl = p.el; az = p.az; } }
  near(az, 180, 3);
});
test('time zone offset Europe/Berlin: winter +60, summer +120', () => {
  near(PVP.sun.dayOffset('Europe/Berlin', 15), 60, 0);
  near(PVP.sun.dayOffset('Europe/Berlin', 180), 120, 0);
});

console.log('geometry');
const base = () => PVP.project.normalize(JSON.parse(JSON.stringify(PVP.EXAMPLE)));
test('slope lengths and eave heights', () => {
  const p = base(); const g = PVP.geom.building(p.building);
  near(g.faces.A.slope, (5 + 0.5) / Math.cos(38 * Math.PI / 180), 1e-9);
  near(g.faces.A.eaveH, 9.4 - 5.5 * Math.tan(38 * Math.PI / 180), 1e-9);
});
test('face A normal points to its azimuth', () => {
  const p = base(); p.building.azimuthA = 180; const g = PVP.geom.building(p.building);
  const n = g.faces.A.normal; // south = +z
  ok(n[2] > 0.5 && Math.abs(n[0]) < 1e-9 && n[1] > 0, 'normal ' + n);
});
test('face points lie on the roof plane', () => {
  const p = base(); const g = PVP.geom.building(p.building);
  for (const f of ['A', 'B']) {
    const a = PVP.geom.facePoint(g, f, 1, 1), b = PVP.geom.facePoint(g, f, 3, 2), c = PVP.geom.facePoint(g, f, 5, 4);
    const n = g.faces[f].normal;
    const d1 = (a[0] - b[0]) * n[0] + (a[1] - b[1]) * n[1] + (a[2] - b[2]) * n[2];
    const d2 = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1] + (a[2] - c[2]) * n[2];
    near(d1, 0, 1e-9); near(d2, 0, 1e-9);
  }
});
test('triangulation of an L-shaped polygon', () => {
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
  const tr = PVP.geom.triangulate(L);
  ok(tr.length === 4, 'triangles ' + tr.length);
  const area = tr.reduce((a, [i, j, k]) => a + Math.abs(PVP.geom.polyArea([L[i], L[j], L[k]])), 0);
  near(area, 6, 1e-9);
});
test('minimum rectangle of a rotated rectangle', () => {
  const a = 30 * Math.PI / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
  const pts = [[-5, -2], [5, -2], [5, 2], [-5, 2]].map(([x, y]) => [x * d[0] + y * n[0] + 3, x * d[1] + y * n[1] - 1]);
  const R = PVP.geom.minRect(pts);
  near(R.long, 10, 1e-6); near(R.short, 4, 1e-6); near(R.center[0], 3, 1e-6);
});

console.log('layout');
test('empty roof: portrait grid fills the usable area', () => {
  const p = base(); p.obstacles = []; p.layout.orientation = 'portrait'; p.layout.faces.B = false;
  const r = PVP.layout.compute(p);
  // usable width 0.35..6.2 (5.85 m) → 5 columns; usable height 6.98-0.6 → 3 rows
  ok(r.modules.length === 15, 'modules ' + r.modules.length);
  ok(!r.warnings.length, 'warnings');
});
test('modules keep the clearance to obstacles', () => {
  const p = base(); const g = PVP.geom.building(p.building);
  const r = PVP.layout.compute(p, g);
  ok(!r.warnings.length, JSON.stringify(r.warnings));
  ok(r.modules.length > 20);
});
test('removed modules stay removed', () => {
  const p = base(); const r1 = PVP.layout.compute(p);
  p.layout.disabled = [r1.modules[0].id];
  const r2 = PVP.layout.compute(p);
  ok(r2.modules.length === r1.modules.length - 1);
});

console.log('shading');
function boxScene(withBox) {
  const p = base();
  p.obstacles = []; p.neighbors = []; p.trees = [];
  p.building.azimuthA = 180; p.layout.faces.B = false; p.layout.orientation = 'portrait';
  if (withBox) p.neighbors = [{ id: 'wall', footprint: [[-30, -14], [30, -14], [30, -13], [-30, -13]], base: 0, wallHeight: 30, roof: 'flat', ridgeHeight: 30 }];
  return p;
}
test('no occluders → no shading loss', () => {
  const p = boxScene(false); const lay = PVP.layout.compute(p);
  const sim = PVP.shade.run(p, lay.modules, { quality: 'fast' }); const E = PVP.energy.prepare(sim); const ref = PVP.energy.reference(sim, E);
  near(ref.ideal / ref.unshaded, 1, 1e-6);
});
test('a 30 m wall 13 m south shades heavily', () => {
  const p = boxScene(true); const lay = PVP.layout.compute(p);
  const sim = PVP.shade.run(p, lay.modules, { quality: 'fast' }); const E = PVP.energy.prepare(sim); const ref = PVP.energy.reference(sim, E);
  ok(ref.ideal / ref.unshaded < 0.6, 'ratio ' + ref.ideal / ref.unshaded);
});
test('a chimney low on a south roof shades the modules above it', () => {
  const p = base(); p.neighbors = []; p.trees = []; p.building.azimuthA = 180;
  p.obstacles = [{ id: 'c', face: 'A', kind: 'chimney', fromLeft: 3, fromEave: 0.2, width: 0.6, depth: 0.6, top: 7.5, clearance: 0.1, mode: 'plan' }];
  p.layout.faces.B = false; p.layout.orientation = 'portrait';
  const lay = PVP.layout.compute(p);
  const sim = PVP.shade.run(p, lay.modules, { quality: 'fast' }); const E = PVP.energy.prepare(sim); const ref = PVP.energy.reference(sim, E);
  const worst = Math.max(...ref.moduleLoss), best = Math.min(...ref.moduleLoss);
  ok(worst > 0.03 && best < 0.01, `worst ${worst} best ${best}`);
});

console.log('strings');
test('string limits from module and inverter data', () => {
  const p = base(); const L = PVP.strings.limits(p);
  near(L.vocCold, 39.5 * (1 - 0.0025 * (-40)), 1e-9);
  ok(L.nMax === Math.floor(1000 / L.vocCold));
  ok(L.nMin >= 1 && L.nMin <= L.nMax);
});
test('optimiser connects all modules within limits (example)', () => {
  const p = base(); const lay = PVP.layout.compute(p);
  const sim = PVP.shade.run(p, lay.modules, { quality: 'fast' }); const E = PVP.energy.prepare(sim);
  const r = PVP.strings.optimize(sim, E);
  ok(!r.error, r.error);
  const used = [].concat(...r.plan.trackers.map(t => [].concat(...t.strings)));
  ok(used.length + r.plan.unassigned.length === lay.modules.length);
  for (const t of r.plan.trackers) for (const s of t.strings) ok(s.length >= r.lim.nMin && s.length <= r.lim.nMax);
  ok(r.plan.trackers.length <= p.inverter.trackers);
  const ref = PVP.energy.reference(sim, E);
  ok(r.ev.total <= ref.unshaded * 1.0001, 'strings cannot beat the unshaded case');
});
test('bypass diodes: one fully shaded section costs about one third of the module', () => {
  // synthetic: 1 module, 3 sections, one section dark
  const sim = { M: 1, sections: 3, T: 1, steps: [{ w: 1, month: 0 }], project: { inverter: { vmppMin: 0, imax: 100, eta: 1, pmax: 1e9 } } };
  const E = { cur: new Float32Array([10, 10, 0]), volt: new Float32Array([10]) };
  const pw = PVP.energy.trackerPower(sim, E, [[0]], 0, sim.project.inverter);
  near(pw, 200, 1e-6);
});

console.log('osm');
test('parse sample Overpass response', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'overpass_sample.json')));
  const b = PVP.osm.parse(data, 51.0, 10.0);
  ok(b.length === 6, 'buildings ' + b.length);
  near(b[0].area, 60, 0.5);
});
test('apply selection: semi-detached pair → one roof with own section', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'overpass_sample.json')));
  const b = PVP.osm.parse(data, 51.0, 10.0);
  const p = base();
  PVP.osm.applySelection(p, b, { own: [b[0].id], attached: [b[1].id], ignore: [] }, 51.0, 10.0);
  near(p.building.length, 12, 0.05); near(p.building.width, 10, 0.05);
  near(p.building.azimuthA, 165, 0.5);
  near(p.building.section.to - p.building.section.from, 6, 0.1);
  ok(p.neighbors.length === 4);
});
test('OSM height heuristics', () => {
  const h1 = PVP.osm.heights({ building: 'house', height: '9', 'roof:shape': 'flat' });
  near(h1.wall, 9, 1e-9);
  const h2 = PVP.osm.heights({ building: 'garage' });
  ok(h2.roof === 'flat' && h2.wall <= 2.8);
});

console.log('i18n');
test('all keys exist in de and en', () => {
  const D = PVP.i18n.dict;
  const missing = Object.keys(D.de).filter(k => !(k in D.en)).concat(Object.keys(D.en).filter(k => !(k in D.de)));
  ok(!missing.length, 'missing: ' + missing.join(', '));
});
test('every key used in the UI is translated', () => {
  const src = ['js/app.js', 'js/plan2d.js', 'js/export.js', 'index.html'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  const used = new Set();
  for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-ph)?="([a-zA-Z0-9_]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/'((?:f|o|c|h|kind|face|mode|roof|rd|tree|q|sec|sub|act|list|clim|i)_[a-zA-Z0-9]+)'/g)) used.add(m[1]);
  const D = PVP.i18n.dict.de;
  const miss = [...used].filter(k => !k.endsWith('_') && !(k in D));
  ok(!miss.length, 'untranslated: ' + miss.join(', '));
});

console.log('export');
test('DXF is well-formed', () => {
  const p = base(); const lay = PVP.layout.compute(p);
  const d = PVP.exporter.dxf(p, lay.modules);
  ok(d.startsWith('0\r\nSECTION') && d.trim().endsWith('EOF'));
  ok((d.match(/3DFACE/g) || []).length > lay.modules.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
