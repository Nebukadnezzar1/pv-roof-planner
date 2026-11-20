/* OpenStreetMap import: geocoding (Nominatim) and building footprints (Overpass API).
 * Data © OpenStreetMap contributors, ODbL. */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};
  const D2R = Math.PI / 180;
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

  async function geocode(query, lang) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(query);
    const r = await fetch(url, { headers: { 'Accept-Language': lang || 'de' } });
    if (!r.ok) throw new Error('Nominatim HTTP ' + r.status);
    const js = await r.json();
    return js.map(x => ({ name: x.display_name, lat: +x.lat, lon: +x.lon }));
  }

  async function fetchBuildings(lat, lon, radius) {
    const q = `[out:json][timeout:25];(way["building"](around:${radius},${lat},${lon});relation["building"](around:${radius},${lat},${lon}););out body;>;out skel qt;`;
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!r.ok) throw new Error('Overpass HTTP ' + r.status);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  /** local metric projection around (lat0, lon0) → [east, north] */
  function projector(lat0, lon0) {
    const k = 111320;
    return {
      fwd: (lat, lon) => [(lon - lon0) * k * Math.cos(lat0 * D2R), (lat - lat0) * k],
      inv: (e, n) => [lat0 + n / k, lon0 + e / (k * Math.cos(lat0 * D2R))]
    };
  }

  /** Parse an Overpass JSON response into buildings with local footprints. */
  function parse(data, lat0, lon0) {
    const pr = projector(lat0, lon0);
    const nodes = {}, ways = {};
    for (const el of data.elements || []) {
      if (el.type === 'node') nodes[el.id] = [el.lat, el.lon];
      else if (el.type === 'way') ways[el.id] = el;
    }
    const out = [];
    const add = (id, nodeIds, tags) => {
      const pts = [];
      for (const nid of nodeIds) { const n = nodes[nid]; if (n) pts.push(pr.fwd(n[0], n[1])); }
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
      if (pts.length < 3) return;
      if (PVP.geom.polyArea(pts) < 0) pts.reverse();
      out.push({ id: String(id), tags: tags || {}, footprint: pts, area: Math.abs(PVP.geom.polyArea(pts)) });
    };
    for (const el of data.elements || []) {
      if (el.type === 'way' && el.tags && el.tags.building) add('w' + el.id, el.nodes, el.tags);
      if (el.type === 'relation' && el.tags && el.tags.building) {
        // use the first outer ring
        const outer = (el.members || []).find(m => m.type === 'way' && m.role === 'outer');
        if (outer && ways[outer.ref]) add('r' + el.id, ways[outer.ref].nodes, el.tags);
      }
    }
    return out;
  }

  function num(v) { if (v === undefined || v === null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? +m[0] : NaN; }

  /** Heights and roof shape from OSM tags with sensible defaults. */
  function heights(tags, short) {
    const levels = num(tags['building:levels']), roofLevels = num(tags['roof:levels']);
    const h = num(tags.height), rh = num(tags['roof:height']), minH = num(tags.min_height);
    const shape = (tags['roof:shape'] || '').toLowerCase();
    let roof = shape === 'flat' ? 'flat' : shape === 'hipped' || shape === 'half-hipped' ? 'hip' : shape ? 'gable' : 'gable';
    const btype = (tags.building || '').toLowerCase();
    if (!shape && ['garage', 'garages', 'carport', 'shed', 'commercial', 'industrial', 'retail', 'warehouse', 'supermarket'].includes(btype)) roof = 'flat';
    let wall, ridge;
    const pitchRidge = (short || 8) / 2 * Math.tan(35 * D2R);
    if (!isNaN(h)) {
      ridge = h;
      wall = roof === 'flat' ? h : (!isNaN(rh) ? h - rh : Math.max(2.5, h - Math.min(pitchRidge, h * 0.45)));
    } else {
      const lv = !isNaN(levels) ? levels : (['garage', 'garages', 'carport', 'shed'].includes(btype) ? 1 : 2);
      wall = lv * 2.9 + 0.3 + (isNaN(roofLevels) ? 0 : 0);
      ridge = roof === 'flat' ? wall : wall + (!isNaN(rh) ? rh : Math.min(pitchRidge, 5.5));
    }
    if (['garage', 'garages', 'carport', 'shed'].includes(btype) && isNaN(h)) { wall = Math.min(wall, 2.8); ridge = roof === 'flat' ? wall : wall + 1; }
    return { wall: +wall.toFixed(2), ridge: +ridge.toFixed(2), roof, base: isNaN(minH) ? 0 : minH, estimated: isNaN(h) };
  }

  /**
   * Build project geometry from a selection.
   * buildings: parsed list (footprints relative to (lat0,lon0)); own: ids of the own building part;
   * attached: ids sharing the same roof; ignore: ids to drop.
   */
  function applySelection(project, buildings, sel, lat0, lon0, opts) {
    opts = opts || {};
    const own = buildings.filter(b => sel.own.includes(b.id));
    if (!own.length) throw new Error('no own building selected');
    const main = own.concat(buildings.filter(b => (sel.attached || []).includes(b.id)));
    const allPts = [].concat(...main.map(b => b.footprint));
    const R = PVP.geom.minRect(allPts);
    let ridgeDir = R.longDir;
    if (opts.ridgeAcross) ridgeDir = [-ridgeDir[1], ridgeDir[0]];
    const len = opts.ridgeAcross ? R.short : R.long, wid = opts.ridgeAcross ? R.long : R.short;
    // face A = the face looking more to the south
    let nA = [-ridgeDir[1], ridgeDir[0]];
    if (nA[1] > 0) nA = [-nA[0], -nA[1]];          // pointing south-ish (negative north)
    const azA = (Math.atan2(nA[0], nA[1]) / D2R + 360) % 360;
    // new origin = centre of the main rectangle
    const c = R.center;
    const pr = projector(lat0, lon0);
    const [lat, lon] = pr.inv(c[0], c[1]);
    const b = project.building;
    const t = own[0].tags;
    const hh = heights(t, wid);
    b.azimuthA = Math.round(azA * 10) / 10;
    b.length = +len.toFixed(2); b.width = +wid.toFixed(2);
    b.ridgeOffset = +(wid / 2).toFixed(2);
    const pitch = num(t['roof:angle']);
    if (!isNaN(pitch)) { b.pitchA = b.pitchB = pitch; }
    if (!isNaN(num(t.height))) b.ridgeHeight = num(t.height);
    else b.ridgeHeight = +(hh.wall + wid / 2 * Math.tan(b.pitchA * D2R)).toFixed(2);
    // own section along the ridge
    const g = PVP.geom.building(b);
    const shift = p => [p[0] - c[0], p[1] - c[1]];
    if (main.length > own.length) {
      const us = [].concat(...own.map(o => o.footprint)).map(p => PVP.geom.toLocal(g, ...shift(p))[0]);
      let from = Math.max(0, Math.min(...us)), to = Math.min(b.length, Math.max(...us));
      if (from < 0.3) from = 0; if (to > b.length - 0.3) to = b.length;
      b.section = { from: +from.toFixed(2), to: +to.toFixed(2) };
    } else b.section = { from: 0, to: b.length };
    // neighbours
    const ign = new Set(sel.ignore || []);
    const mainIds = new Set(main.map(m => m.id));
    project.neighbors = buildings.filter(x => !mainIds.has(x.id) && !ign.has(x.id)).map(x => {
      const fp = x.footprint.map(shift);
      const rr = PVP.geom.minRect(fp);
      const h = heights(x.tags, rr ? rr.short : 8);
      return { id: 'osm' + x.id, name: (x.tags['addr:housenumber'] ? (x.tags['addr:street'] || '') + ' ' + x.tags['addr:housenumber'] : x.tags.building), footprint: fp.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]),
        base: h.base, wallHeight: h.wall, roof: h.roof, ridgeHeight: h.ridge, ridgeDir: 'long', estimated: h.estimated };
    });
    project.site.lat = +lat.toFixed(6); project.site.lon = +lon.toFixed(6);
    project.obstacles = [];
    project.layout.mode = 'auto'; project.layout.disabled = []; project.layout.modules = [];
    return project;
  }

  PVP.osm = { geocode, fetchBuildings, parse, heights, applySelection, projector };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
