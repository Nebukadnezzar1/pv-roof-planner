/* PV Roof Planner – project model, defaults and normalisation.
 * All lengths in metres, angles in degrees, azimuth clockwise from north.
 * Works in the browser (global PVP) and in Node (require). */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};

  const SCHEMA_VERSION = 1;

  // Monthly global horizontal irradiation (kWh/m²) and diffuse fraction for a typical
  // Central-European site (~49° N). Used only to derive a default when the user has
  // not entered PVGIS values for the real site.
  const REF_GHI = [31, 52, 92, 133, 160, 170, 174, 150, 106, 64, 33, 24];
  const REF_FD = [0.72, 0.63, 0.55, 0.50, 0.48, 0.47, 0.46, 0.47, 0.52, 0.60, 0.70, 0.75];
  const REF_TAMB = [1, 2, 6, 10, 14, 18, 20, 19, 15, 10, 5, 2];
  const REF_LAT = 48.97;

  function defaultProject() {
    return {
      schema: SCHEMA_VERSION,
      name: 'Neues Projekt',
      site: {
        lat: 51.0, lon: 10.0,
        timeZone: (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Europe/Berlin',
        albedo: 0.2
      },
      climate: { ghi: null, diffuse: null, tamb: null, source: 'estimate' },
      building: {
        azimuthA: 180,          // direction face A looks to (downslope), e.g. 180 = south
        length: 10,             // gable wall to gable wall (along the ridge)
        width: 9,               // eave wall to eave wall (across the ridge)
        ridgeOffset: 4.5,       // horizontal distance of the ridge from wall A
        ridgeHeight: 9,         // above ground
        pitchA: 35, pitchB: 35,
        overhangA: 0.5, overhangB: 0.5, overhangGable: 0.3,
        section: { from: 0, to: 10 }  // own part along the ridge, measured from the left gable wall seen from face A
      },
      obstacles: [],            // {id, face:'A'|'B', kind, fromLeft, fromEave, width, depth, top, clearance, mode:'plan'|'roof'}
      neighbors: [],            // {id, name, footprint:[[e,n],...], base, wallHeight, roof:'flat'|'gable'|'hip', ridgeHeight, ridgeDir:'long'|'short'}
      trees: [],                // {id, e, n, height, crownRadius, type:'deciduous'|'conifer'}
      module: {
        name: 'Generic 450 W (1762 × 1134)',
        long: 1.762, short: 1.134, thickness: 0.03,
        pmax: 450, voc: 39.5, vmp: 33.0, imp: 13.65, isc: 14.4,
        tkVoc: -0.25, tkPmax: -0.30, noct: 45,
        cellsShort: 6, cellsLong: 18, halfCut: true, bypassDiodes: 3,
        lift: 0.13              // module plane above roof covering
      },
      layout: {
        mode: 'auto',           // 'auto' | 'fixed'
        orientation: 'auto',    // 'auto' | 'portrait' | 'landscape'
        align: 'grid',          // 'grid' (columns aligned) | 'pack' (max per gap)
        faces: { A: true, B: true },
        marginEave: 0.30, marginRidge: 0.30, marginVerge: 0.35, marginBoundary: 0.10,
        gap: 0.02, clearanceDefault: 0.15,
        disabled: [],           // ids removed by the user in auto mode
        modules: []             // fixed layout: {id, face, p, s, orient}
      },
      inverter: {
        name: 'Generic MPPT, 2 trackers',
        trackers: 2, stringsPerTracker: 2,
        vmax: 1000, vStart: 120, vmppMin: 160, vmppMax: 850,
        imax: 16, iscMax: 20, pmax: 6000,
        eta: 0.97,
        microPmax: 1600 / 4, microEta: 0.965
      },
      electrical: { tMin: -15, tCellMax: 70, otherLosses: 0.10, crossSection: 6, rho: 0.0178 },
      strings: { mode: 'auto', list: [] },  // fixed: [{tracker, modules:[ids]}]
      cable: { face: 'A', p: 1.0, down: 6, inside: 5, reserve: 0.3 },
      sim: { quality: 'normal' }  // 'fast' | 'normal' | 'fine'
    };
  }

  function deepMerge(base, over) {
    if (over === undefined || over === null) return base;
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over;
    const out = Object.assign({}, base);
    for (const k of Object.keys(over)) {
      out[k] = (k in base && base[k] !== null && typeof base[k] === 'object' && !Array.isArray(base[k]))
        ? deepMerge(base[k], over[k]) : over[k];
    }
    return out;
  }

  function normalize(p) {
    const d = defaultProject();
    const out = deepMerge(d, p || {});
    out.schema = SCHEMA_VERSION;
    const b = out.building;
    if (!b.section || b.section.to === undefined) b.section = { from: 0, to: b.length };
    b.section.from = Math.max(0, Math.min(b.length, +b.section.from || 0));
    b.section.to = Math.max(b.section.from, Math.min(b.length, +b.section.to));
    let n = 1;
    for (const list of [out.obstacles, out.neighbors, out.trees]) {
      for (const o of list) if (!o.id) o.id = 'x' + (n++) + Math.random().toString(36).slice(2, 6);
    }
    return out;
  }

  /** Monthly climate for the site; estimates from the reference table if not given. */
  function climate(project) {
    const c = project.climate || {};
    const lat = project.site.lat;
    let ghi = c.ghi, est = false;
    if (!ghi || ghi.length !== 12) {
      // scale reference by the ratio of extraterrestrial monthly horizontal irradiation
      const ref = PVP.sun.monthlyH0(REF_LAT), here = PVP.sun.monthlyH0(lat);
      ghi = REF_GHI.map((g, i) => g * (ref[i] > 0 ? here[i] / ref[i] : 0));
      est = true;
    }
    const diffuse = (c.diffuse && c.diffuse.length === 12) ? c.diffuse : REF_FD.slice();
    const tamb = (c.tamb && c.tamb.length === 12) ? c.tamb : REF_TAMB.slice();
    return { ghi, diffuse, tamb, estimated: est };
  }

  function uid(prefix) { return (prefix || 'id') + Math.random().toString(36).slice(2, 9); }

  PVP.project = { SCHEMA_VERSION, defaultProject, normalize, climate, deepMerge, uid, REF_GHI, REF_FD, REF_TAMB };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
