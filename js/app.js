/* PV Roof Planner – user interface glue. */
(function () {
  'use strict';
  const PVP = window.PVP;
  const I = PVP.i18n;
  const t = (k, v) => I.t(k, v);
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const LS_KEY = 'pvrp.project.v1';
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d) => I.num(v, d === undefined ? 0 : d);

  let P = null;
  const S = { layout: null, g: null, res: null, stale: true, renderer: null, instCtx: null, instKey: '', playing: null, running: false, osm: null };

  // ---------------------------------------------------------------- persistence
  function loadInitial() {
    try { const s = localStorage.getItem(LS_KEY); if (s) return PVP.project.normalize(JSON.parse(s)); } catch (e) { /* ignore */ }
    return PVP.project.normalize(JSON.parse(JSON.stringify(PVP.EXAMPLE)));
  }
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(P)); } catch (e) { /* ignore */ } }, 300);
  }

  // ---------------------------------------------------------------- path helpers
  const getp = (o, path) => path.split('.').reduce((a, k) => a == null ? a : a[k], o);
  function setp(o, path, v) { const ks = path.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; }

  // ---------------------------------------------------------------- form definitions
  const F = (path, label, unit, opt) => Object.assign({ path, label, unit: unit || '' }, opt || {});
  function sections() {
    return [
      { id: 'site', title: 'sec_site', intro: 'sec_site_intro', fields: [
        F('site.lat', 'f_lat', '°', { step: 0.000001 }), F('site.lon', 'f_lon', '°', { step: 0.000001 }),
        F('site.timeZone', 'f_tz', '', { type: 'text' }), F('site.albedo', 'f_albedo', '', { step: 0.05, min: 0, max: 0.9 })
      ], buttons: [['osm', 'act_osm']] },
      { id: 'bld', title: 'sec_building', intro: 'sec_building_intro', fields: [
        F('building.azimuthA', 'f_azA', '°', { step: 1, min: 0, max: 360, hint: 'h_azA' }),
        F('building.length', 'f_len', 'm', { step: 0.01, min: 1 }), F('building.width', 'f_wid', 'm', { step: 0.01, min: 1 }),
        F('building.ridgeOffset', 'f_ridgeOff', 'm', { step: 0.01, min: 0 }), F('building.ridgeHeight', 'f_ridgeH', 'm', { step: 0.01, min: 1 }),
        F('building.pitchA', 'f_pitchA', '°', { step: 0.5, min: 5, max: 70 }), F('building.pitchB', 'f_pitchB', '°', { step: 0.5, min: 5, max: 70 }),
        F('building.overhangA', 'f_ovA', 'm', { step: 0.01, min: 0 }), F('building.overhangB', 'f_ovB', 'm', { step: 0.01, min: 0 }),
        F('building.overhangGable', 'f_ovG', 'm', { step: 0.01, min: 0 }),
        F('building.section.from', 'f_secFrom', 'm', { step: 0.01, min: 0, hint: 'h_section' }), F('building.section.to', 'f_secTo', 'm', { step: 0.01, min: 0 })
      ], info: 'bldInfo' },
      { id: 'obs', title: 'sec_obstacles', intro: 'sec_obstacles_intro', list: 'obstacles' },
      { id: 'env', title: 'sec_env', intro: 'sec_env_intro', list: 'neighbors', list2: 'trees', buttons: [['osm', 'act_osm']] },
      { id: 'mod', title: 'sec_module', intro: 'sec_module_intro', fields: [
        F('module.name', 'f_modName', '', { type: 'text', wide: true }),
        F('module.long', 'f_modLong', 'm', { step: 0.001 }), F('module.short', 'f_modShort', 'm', { step: 0.001 }),
        F('module.pmax', 'f_pmax', 'W', { step: 1 }), F('module.voc', 'f_voc', 'V', { step: 0.01 }), F('module.vmp', 'f_vmp', 'V', { step: 0.01 }),
        F('module.imp', 'f_imp', 'A', { step: 0.01 }), F('module.isc', 'f_isc', 'A', { step: 0.01 }),
        F('module.tkVoc', 'f_tkVoc', '%/K', { step: 0.01 }), F('module.tkPmax', 'f_tkP', '%/K', { step: 0.01 }), F('module.noct', 'f_noct', '°C', { step: 1 }),
        F('module.cellsShort', 'f_cellsS', '', { step: 1 }), F('module.cellsLong', 'f_cellsL', '', { step: 1 }),
        F('module.bypassDiodes', 'f_diodes', '', { step: 1, min: 1, max: 6 }), F('module.halfCut', 'f_halfCut', '', { type: 'checkbox' }),
        F('module.lift', 'f_lift', 'm', { step: 0.01 })
      ], sub: { title: 'sub_layout', fields: [
        F('layout.orientation', 'f_orient', '', { type: 'select', options: [['auto', 'o_auto'], ['portrait', 'o_portrait'], ['landscape', 'o_landscape']] }),
        F('layout.align', 'f_align', '', { type: 'select', options: [['grid', 'o_grid'], ['pack', 'o_pack']] }),
        F('layout.faces.A', 'f_faceA', '', { type: 'checkbox' }), F('layout.faces.B', 'f_faceB', '', { type: 'checkbox' }),
        F('layout.marginEave', 'f_mEave', 'm', { step: 0.01 }), F('layout.marginRidge', 'f_mRidge', 'm', { step: 0.01 }),
        F('layout.marginVerge', 'f_mVerge', 'm', { step: 0.01 }), F('layout.marginBoundary', 'f_mBound', 'm', { step: 0.01 }),
        F('layout.gap', 'f_gap', 'm', { step: 0.005 }), F('layout.clearanceDefault', 'f_clear', 'm', { step: 0.01 })
      ] }, info: 'layoutInfo' },
      { id: 'inv', title: 'sec_inverter', intro: 'sec_inverter_intro', fields: [
        F('inverter.name', 'f_invName', '', { type: 'text', wide: true }),
        F('inverter.trackers', 'f_trackers', '', { step: 1, min: 1 }), F('inverter.stringsPerTracker', 'f_spt', '', { step: 1, min: 1 }),
        F('inverter.vmax', 'f_vmax', 'V', { step: 1 }), F('inverter.vStart', 'f_vstart', 'V', { step: 1 }),
        F('inverter.vmppMin', 'f_vmppMin', 'V', { step: 1 }), F('inverter.vmppMax', 'f_vmppMax', 'V', { step: 1 }),
        F('inverter.imax', 'f_imax', 'A', { step: 0.1 }), F('inverter.iscMax', 'f_iscMax', 'A', { step: 0.1 }),
        F('inverter.pmax', 'f_pmaxT', 'W', { step: 10 }), F('inverter.eta', 'f_eta', '', { step: 0.005, min: 0.5, max: 1 }),
        F('electrical.tMin', 'f_tmin', '°C', { step: 1 }), F('electrical.tCellMax', 'f_tcell', '°C', { step: 1 }),
        F('electrical.otherLosses', 'f_losses', '', { step: 0.01, min: 0, max: 0.5 })
      ], sub: { title: 'sub_cable', fields: [
        F('cable.face', 'f_cFace', '', { type: 'select', options: [['A', 'face_A'], ['B', 'face_B']] }), F('cable.p', 'f_cP', 'm', { step: 0.05 }),
        F('cable.down', 'f_cDown', 'm', { step: 0.1 }), F('cable.inside', 'f_cIn', 'm', { step: 0.1 }),
        F('electrical.crossSection', 'f_cs', 'mm²', { step: 0.5 })
      ] }, info: 'invInfo' },
      { id: 'clim', title: 'sec_climate', intro: 'sec_climate_intro', climate: true },
      { id: 'run', title: 'sec_run', intro: 'sec_run_intro', run: true }
    ];
  }

  // ---------------------------------------------------------------- sidebar rendering
  function fieldHTML(f) {
    const v = getp(P, f.path);
    const id = 'f_' + f.path.replace(/\./g, '_');
    const lab = `<span class="lab">${esc(t(f.label))}${f.hint ? ` <i class="tip" title="${esc(t(f.hint))}">?</i>` : ''}</span>`;
    let inp;
    if (f.type === 'checkbox') inp = `<input type="checkbox" id="${id}" data-path="${f.path}" ${v ? 'checked' : ''}>`;
    else if (f.type === 'select') inp = `<select id="${id}" data-path="${f.path}">${f.options.map(([val, k]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select>`;
    else if (f.type === 'text') inp = `<input type="text" id="${id}" data-path="${f.path}" value="${esc(v)}">`;
    else inp = `<input type="number" id="${id}" data-path="${f.path}" value="${v === null || v === undefined ? '' : v}" step="${f.step || 'any'}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>`;
    return `<label class="fld ${f.wide ? 'wide' : ''} ${f.type === 'checkbox' ? 'cb' : ''}" for="${id}">${lab}<span class="inp">${inp}${f.unit ? `<em>${esc(f.unit)}</em>` : ''}</span></label>`;
  }

  const LISTS = {
    obstacles: { title: 'list_obstacles', cols: [
      ['face', 'c_face', 'select', [['A', 'face_A'], ['B', 'face_B']]], ['kind', 'c_kind', 'select', [['chimney', 'kind_chimney'], ['window', 'kind_window'], ['vent', 'kind_vent'], ['other', 'kind_other']]],
      ['label', 'c_label', 'text'], ['fromLeft', 'c_fromLeft', 'num'], ['fromEave', 'c_fromEave', 'num'], ['width', 'c_width', 'num'], ['depth', 'c_depth', 'num'],
      ['top', 'c_top', 'num'], ['clearance', 'c_clear', 'num'], ['mode', 'c_mode', 'select', [['plan', 'mode_plan'], ['roof', 'mode_roof']]]],
      make: () => ({ id: PVP.project.uid('o'), face: 'A', kind: 'chimney', label: '', fromLeft: 2, fromEave: 3, width: 0.5, depth: 0.5, top: P.building.ridgeHeight - 0.5, clearance: '', mode: 'plan' }) },
    neighbors: { title: 'list_neighbors', cols: [
      ['name', 'c_name', 'text'], ['rect.e', 'c_e', 'num'], ['rect.n', 'c_n', 'num'], ['rect.len', 'c_rlen', 'num'], ['rect.wid', 'c_rwid', 'num'], ['rect.rot', 'c_rrot', 'num'],
      ['base', 'c_base', 'num'], ['wallHeight', 'c_wallH', 'num'], ['roof', 'c_roof', 'select', [['gable', 'roof_gable'], ['hip', 'roof_hip'], ['flat', 'roof_flat']]],
      ['ridgeHeight', 'c_ridgeH', 'num'], ['ridgeDir', 'c_ridgeDir', 'select', [['long', 'rd_long'], ['short', 'rd_short']]]],
      make: () => ({ id: PVP.project.uid('n'), name: '', rect: { e: 0, n: 20, len: 10, wid: 9, rot: 90 }, base: 0, wallHeight: 6, roof: 'gable', ridgeHeight: 9.5, ridgeDir: 'long' }) },
    trees: { title: 'list_trees', cols: [
      ['e', 'c_e', 'num'], ['n', 'c_n', 'num'], ['height', 'c_treeH', 'num'], ['crownRadius', 'c_crown', 'num'],
      ['type', 'c_treeType', 'select', [['deciduous', 'tree_dec'], ['conifer', 'tree_con']]]],
      make: () => ({ id: PVP.project.uid('t'), e: 8, n: -10, height: 10, crownRadius: 3, type: 'deciduous' }) }
  };

  function rectFootprint(r) {
    const a = r.rot * Math.PI / 180, d = [Math.sin(a), Math.cos(a)], n = [-d[1], d[0]];
    const L = r.len / 2, W = r.wid / 2;
    return [[-L, -W], [L, -W], [L, W], [-L, W]].map(([x, y]) => [+(r.e + x * d[0] + y * n[0]).toFixed(3), +(r.n + x * d[1] + y * n[1]).toFixed(3)]);
  }
  function syncNeighbors() { for (const nb of P.neighbors) if (nb.rect) nb.footprint = rectFootprint(nb.rect); }

  function listHTML(name) {
    const L = LISTS[name], rows = P[name] || [];
    let h = `<div class="listblock" data-list="${name}"><div class="listhead"><b>${esc(t(L.title))}</b><button type="button" data-add="${name}">+ ${esc(t('add'))}</button></div>`;
    if (!rows.length) return h + `<p class="empty">${esc(t('empty_' + name))}</p></div>`;
    h += `<div class="tablewrap"><table class="edit"><thead><tr>${L.cols.map(c => `<th>${esc(t(c[1]))}</th>`).join('')}<th></th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      h += `<tr data-row="${i}">`;
      for (const [key, , type, opts] of L.cols) {
        const v = getp(r, key);
        let cell;
        if (name === 'neighbors' && key.startsWith('rect.') && !r.rect) { cell = key === 'rect.e' ? `<span class="osmtag" title="${esc(t('osm_fp'))}">OSM · ${(r.footprint || []).length} ${esc(t('pts'))}</span>` : ''; h += key === 'rect.e' ? `<td colspan="5">${cell}</td>` : ''; continue; }
        if (type === 'select') cell = `<select data-k="${key}">${opts.map(([val, k]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select>`;
        else if (type === 'text') cell = `<input type="text" data-k="${key}" value="${esc(v)}">`;
        else cell = `<input type="number" step="0.01" data-k="${key}" value="${v === null || v === undefined ? '' : v}">`;
        h += `<td>${cell}</td>`;
      }
      h += `<td><button type="button" class="del" data-del="${i}" title="${esc(t('remove'))}">×</button></td></tr>`;
    });
    return h + '</tbody></table></div></div>';
  }

  function climateHTML() {
    const c = PVP.project.climate(P), mn = I.months();
    const own = P.climate && P.climate.ghi && P.climate.ghi.length === 12;
    let h = `<p class="hint">${esc(t(own ? 'clim_own' : 'clim_est'))} <a href="https://re.jrc.ec.europa.eu/pvg_tools/" target="_blank" rel="noopener">PVGIS</a></p>`;
    h += `<div class="tablewrap"><table class="edit clim"><thead><tr><th></th>${mn.map(m => `<th>${m}</th>`).join('')}<th>Σ</th></tr></thead><tbody>`;
    const rows = [['ghi', 'clim_ghi', c.ghi, 0], ['diffuse', 'clim_fd', c.diffuse, 2], ['tamb', 'clim_ta', c.tamb, 0]];
    for (const [k, lab, arr, dp] of rows) {
      h += `<tr><th>${esc(t(lab))}</th>${arr.map((v, i) => `<td><input type="number" step="${dp ? 0.01 : 1}" data-clim="${k}" data-i="${i}" value="${(+v).toFixed(dp)}"></td>`).join('')}`;
      h += `<td>${k === 'ghi' ? Math.round(arr.reduce((a, b) => a + b, 0)) : ''}</td></tr>`;
    }
    h += `</tbody></table></div><div class="row"><button type="button" data-act="climReset">${esc(t('clim_reset'))}</button><button type="button" data-act="climPaste">${esc(t('clim_paste'))}</button></div>`;
    return h;
  }

  function runHTML() {
    return `<div class="runbox">
      <label class="fld"><span class="lab">${esc(t('f_quality'))}</span><span class="inp"><select data-path="sim.quality">
        ${['fast', 'normal', 'fine'].map(q => `<option value="${q}" ${P.sim.quality === q ? 'selected' : ''}>${esc(t('q_' + q))}</option>`).join('')}</select></span></label>
      <button type="button" class="primary big" data-act="run">${esc(t('act_run'))}</button>
      <div class="progress" hidden><div class="bar"></div><span></span></div>
      <p class="hint">${esc(t('run_hint'))}</p></div>`;
  }

  function renderSide() {
    const side = $('#side');
    const open = new Set($$('details[open]', side).map(d => d.dataset.sec));
    const first = !side.children.length;
    let h = '';
    sections().forEach((s, k) => {
      const isOpen = first ? (k < 2) : open.has(s.id);
      h += `<details data-sec="${s.id}" ${isOpen ? 'open' : ''}><summary><span class="num">${k + 1}</span>${esc(t(s.title))}</summary><div class="secbody">`;
      if (s.intro) h += `<p class="intro">${esc(t(s.intro))}</p>`;
      if (s.fields) h += `<div class="grid">${s.fields.map(fieldHTML).join('')}</div>`;
      if (s.sub) h += `<h4>${esc(t(s.sub.title))}</h4><div class="grid">${s.sub.fields.map(fieldHTML).join('')}</div>`;
      if (s.list) h += listHTML(s.list);
      if (s.list2) h += listHTML(s.list2);
      if (s.climate) h += climateHTML();
      if (s.run) h += runHTML();
      if (s.buttons) h += `<div class="row">${s.buttons.map(([a, k]) => `<button type="button" data-act="${a}">${esc(t(k))}</button>`).join('')}</div>`;
      if (s.info) h += `<div class="info" id="${s.info}"></div>`;
      h += `</div></details>`;
    });
    side.innerHTML = h;
    updateInfo();
  }

  function updateInfo() {
    const g = S.g; if (!g) return;
    const A = g.faces.A, B = g.faces.B;
    const bi = $('#bldInfo');
    if (bi) bi.innerHTML = `<table class="mini">
      <tr><th></th><th>${esc(t('face_A'))}</th><th>${esc(t('face_B'))}</th></tr>
      <tr><td>${esc(t('i_orient'))}</td><td>${fmt(A.azimuth)}° ${PVP.plan2d.compass(A.azimuth)}</td><td>${fmt(B.azimuth)}° ${PVP.plan2d.compass(B.azimuth)}</td></tr>
      <tr><td>${esc(t('i_slope'))}</td><td>${fmt(A.slope, 2)} m</td><td>${fmt(B.slope, 2)} m</td></tr>
      <tr><td>${esc(t('i_eaveH'))}</td><td>${fmt(A.eaveH, 2)} m</td><td>${fmt(B.eaveH, 2)} m</td></tr>
      <tr><td>${esc(t('i_roofLen'))}</td><td colspan="2">${fmt(g.roofLen, 2)} m</td></tr></table>`;
    const li = $('#layoutInfo');
    if (li && S.layout) {
      const mods = S.layout.modules, n = c => mods.filter(m => m.face === c).length;
      li.innerHTML = `<b>${mods.length}</b> ${esc(t('modules'))} · <b>${fmt(mods.length * P.module.pmax / 1000, 2)}</b> kWp · ${esc(t('face_A'))}: ${n('A')} · ${esc(t('face_B'))}: ${n('B')}
        ${P.layout.mode === 'fixed' ? `<br><span class="badge">${esc(t('layout_fixed'))}</span>` : ''}`;
    }
    const ii = $('#invInfo');
    if (ii) {
      const L = PVP.strings.limits(P);
      ii.innerHTML = `${esc(t('i_nRange', { a: L.nMin, b: L.nMax }))}<br>${esc(t('i_parallel', { p: L.parallel }))}<br>Voc(${P.electrical.tMin} °C) = ${fmt(L.vocCold, 2)} V · Vmp(${P.electrical.tCellMax} °C) = ${fmt(L.vmpHot, 2)} V`;
    }
  }

  // ---------------------------------------------------------------- change handling
  let recomputeTimer = null;
  function changed(opts) {
    opts = opts || {};
    persist();
    S.stale = true;
    S.instKey = '';
    markStale();
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => { recompute(); if (opts.side) renderSide(); else updateInfo(); }, opts.now ? 0 : 120);
  }
  function recompute() {
    syncNeighbors();
    S.g = PVP.geom.building(P.building);
    S.layout = PVP.layout.compute(P, S.g);
    refreshViews();
  }
  function markStale() {
    for (const el of $$('[data-stale]')) {
      el.hidden = !(S.res && S.stale);
      el.textContent = t('stale');
    }
  }

  function onSideInput(e) {
    const el = e.target;
    if (el.dataset.path) {
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
      if (el.type === 'number' && v === null) return;
      setp(P, el.dataset.path, v);
      if (el.dataset.path === 'building.length') { if (P.building.section.to > v || P.building.section.to === S.g.L) P.building.section.to = v; }
      changed({ side: el.tagName === 'SELECT' });
      return;
    }
    const lb = el.closest('[data-list]');
    if (lb && el.dataset.k) {
      const name = lb.dataset.list, row = +el.closest('[data-row]').dataset.row;
      let v = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
      setp(P[name][row], el.dataset.k, v);
      changed();
      return;
    }
    if (el.dataset.clim) {
      const c = PVP.project.climate(P);
      P.climate = { ghi: c.ghi.slice(), diffuse: c.diffuse.slice(), tamb: c.tamb.slice(), source: 'user' };
      P.climate[el.dataset.clim][+el.dataset.i] = +el.value;
      changed();
    }
  }
  function onSideClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) { P[b.dataset.add].push(LISTS[b.dataset.add].make()); changed({ side: true, now: true }); return; }
    if (b.dataset.del !== undefined) { const name = b.closest('[data-list]').dataset.list; P[name].splice(+b.dataset.del, 1); changed({ side: true, now: true }); return; }
    if (b.dataset.act) action(b.dataset.act);
  }

  // ---------------------------------------------------------------- actions
  function action(a) {
    switch (a) {
      case 'new': if (confirmLoss()) { P = PVP.project.normalize({ name: t('new_project') }); S.res = null; afterLoad(); } break;
      case 'example': if (confirmLoss()) { P = PVP.project.normalize(JSON.parse(JSON.stringify(PVP.EXAMPLE))); S.res = null; afterLoad(); } break;
      case 'open': $('#fileOpen').click(); break;
      case 'save': PVP.exporter.download(fileBase() + '.json', JSON.stringify(P, null, 2), 'application/json'); break;
      case 'osm': openOSM(); break;
      case 'run': runSim(); break;
      case 'restore': P.layout.disabled = []; changed(); break;
      case 'freeze':
        if (P.layout.mode === 'fixed') { P.layout.mode = 'auto'; P.layout.modules = []; P.layout.disabled = []; }
        else PVP.layout.freeze(P, S.layout.modules);
        changed({ side: true }); break;
      case 'svg': PVP.exporter.download(fileBase() + '_dachflaechen.svg', combinedFacesSVG(), 'image/svg+xml'); break;
      case 'csv': PVP.exporter.download(fileBase() + '_module.csv', PVP.exporter.csv(P, S.layout.modules, moduleExtra()), 'text/csv'); break;
      case 'dxf': PVP.exporter.download(fileBase() + '.dxf', PVP.exporter.dxf(P, S.layout.modules), 'application/dxf'); break;
      case 'print': printReport(); break;
      case 'fullscreen': { const w = $('.glwrap'); if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen().catch(() => {}); break; }
      case 'climReset': P.climate = { ghi: null, diffuse: null, tamb: null, source: 'estimate' }; changed({ side: true }); break;
      case 'climPaste': {
        const s = window.prompt(t('clim_paste_prompt'));
        if (!s) break;
        const nums = (s.match(/-?\d+([.,]\d+)?/g) || []).map(x => +x.replace(',', '.'));
        if (nums.length >= 12) { const c = PVP.project.climate(P); P.climate = { ghi: nums.slice(0, 12), diffuse: c.diffuse.slice(), tamb: c.tamb.slice(), source: 'user' }; changed({ side: true }); }
        break;
      }
    }
  }
  function confirmLoss() { return window.confirm(t('confirm_replace')); }
  function fileBase() { return (P.name || 'pv-projekt').replace(/[^\w\-äöüÄÖÜß]+/g, '_').slice(0, 60); }
  function afterLoad() {
    $('#projName').value = P.name || '';
    persist(); S.stale = true; renderSide(); recompute(); resetCamera(); markStale(); renderResult();
  }

  // ---------------------------------------------------------------- views
  function refreshViews() {
    render3D();
    renderFaces();
    renderSite();
    if (S.res && !S.stale) { renderHeat(); }
    $('#freezeBtn').textContent = t(P.layout.mode === 'fixed' ? 'act_unfreeze' : 'act_freeze');
  }

  function moduleColors(mode) {
    const mods = S.layout.modules;
    if (mode === 'loss' && S.res && !S.stale) return mods.map((m, i) => PVP.render3d.lossColor(S.res.ref.moduleLoss[i]));
    if (mode === 'strings' && S.res && !S.stale && S.res.opt.plan) {
      const map = stringMap();
      return mods.map((m, i) => map[i] ? PVP.render3d.hex(PVP.plan2d.STRING_COLORS[(map[i].tracker - 1) % 10]) : PVP.render3d.hex('#666f7a'));
    }
    return null;
  }
  function stringMap() {
    const map = {};
    if (!S.res || !S.res.opt.plan) return map;
    S.res.opt.plan.trackers.forEach((tr, ti) => tr.strings.forEach((s, si) => s.forEach((m, k) => { map[m] = { tracker: ti + 1, string: si + 1, pos: k + 1, len: s.length, face: tr.face }; })));
    return map;
  }

  function sunState() {
    const on = $('#sunOn').checked;
    const day = +$('#sunDay').value, lmin = +$('#sunMin').value;
    const off = PVP.sun.dayOffset(P.site.timeZone, day);
    const utc = lmin - off;
    const sp = PVP.sun.position(P.site.lat, P.site.lon, day, utc);
    const d = PVP.sun.dateOfDay(day);
    const hh = Math.floor(lmin / 60), mm = lmin % 60;
    $('#sunInfo').textContent = `${I.date(d)} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${t('sun_el')} ${fmt(sp.el, 1)}° · ${t('sun_az')} ${fmt(sp.az)}°`;
    return { on, day, utc, sp };
  }

  function instantColors(day, utc) {
    const mods = S.layout.modules;
    if (!mods.length) return null;
    const key = JSON.stringify([P.building, P.obstacles, P.neighbors, P.trees, P.site.lat, P.site.lon, mods.map(m => [m.face, m.p, m.s, m.orient])]);
    if (S.instKey !== key) { S.instCtx = PVP.shade.prepare(P, mods, { quality: 'fast' }); S.instKey = key; }
    const r = PVP.shade.instant(S.instCtx, day, utc);
    return Array.from(r.modules, v => v < 0 ? PVP.render3d.hex('#2b3445') : PVP.render3d.shadeColor(v));
  }

  function cableLines() {
    if (!$('#showCables').checked || !S.res || S.stale || !S.res.opt.plan) return null;
    const g = S.g, mods = S.layout.modules, G = PVP.geom, lift = P.module.lift + 0.08;
    const out = [];
    const ent = P.cable;
    const centre = m => [m.p + m.w / 2, m.s + m.h / 2];
    S.res.opt.plan.trackers.forEach((tr, ti) => tr.strings.forEach(s => {
      const col = PVP.render3d.hex(PVP.plan2d.STRING_COLORS[ti % 10]);
      const pts = s.map(i => { const c = centre(mods[i]); return G.facePoint(g, mods[i].face, c[0], c[1], lift); });
      out.push({ pts, col });
      for (const end of [s[0], s[s.length - 1]]) {
        const m = mods[end], c = centre(m);
        const route = [];
        if (m.face === ent.face) { route.push([m.face, c[0], c[1]], [m.face, c[0], 0.05], [m.face, ent.p, 0.05]); }
        else {
          const F = g.faces[m.face], Fe = g.faces[ent.face];
          const pE = g.roofLen - c[0];
          route.push([m.face, c[0], c[1]], [m.face, c[0], F.slope - 0.05], [ent.face, pE, Fe.slope - 0.05], [ent.face, pE, 0.05], [ent.face, ent.p, 0.05]);
        }
        out.push({ pts: route.map(([f, p, sl]) => G.facePoint(g, f, p, sl, lift)), col: [col[0], col[1], col[2], 0.55] });
      }
      // down pipe
      const e0 = G.facePoint(g, ent.face, ent.p, 0.05, lift);
      out.push({ pts: [e0, [e0[0], Math.max(0.2, e0[1] - ent.down), e0[2]]], col: [0.72, 0.45, 0.2, 1] });
    }));
    return out;
  }

  function render3D() {
    if (!S.renderer) return;
    const st = sunState();
    let colors = null;
    const mode = $('#colorMode').value;
    if (st.on && st.sp.el > 0 && mode === 'plain') colors = instantColors(st.day, st.utc);
    else if ($('#showCables').checked && mode === 'strings') colors = null;
    else if (!($('#showCables').checked && mode === 'strings')) colors = moduleColors(mode);
    const sunDir = st.on ? PVP.sun.direction(st.sp.el, st.sp.az) : null;
    const sc = PVP.render3d.buildScene(P, { modules: S.layout.modules, colors, sunDir, cables: cableLines(), show: {} });
    S.renderer.pickables = sc.pick;
    S.renderer.light = sunDir && sunDir[1] > 0 ? sunDir : [0.4, 0.8, 0.45];
    S.renderer.setScene(sc.mesh, sc.shadowMesh, sc.overlay);
    const labels = [];
    const R = 22;
    for (const [txt, az] of [['N', 0], [t('dir_E'), 90], ['S', 180], ['W', 270]]) labels.push({ text: txt, p: [Math.sin(az * Math.PI / 180) * R, 0.1, -Math.cos(az * Math.PI / 180) * R], cls: 'compass' });
    if ($('#showLabels').checked) {
      const g = S.g;
      for (const m of S.layout.modules) labels.push({ text: String(m.n), p: PVP.geom.facePoint(g, m.face, m.p + m.w / 2, m.s + m.h / 2, P.module.lift + 0.06), cls: 'mod', n: g.faces[m.face].normal });
      for (const f of ['A', 'B']) labels.push({ text: f, p: PVP.geom.facePoint(g, f, 0.25, g.faces[f].slope / 2, 0.2), cls: 'face', n: g.faces[f].normal });
    }
    S.renderer.setLabels(labels, $('#labels'));
  }

  function resetCamera() {
    if (!S.renderer || !S.g) return;
    const g = S.g;
    const c = PVP.geom.toWorld(g, (P.building.section.from + P.building.section.to) / 2, g.W / 2, g.H * 0.55);
    S.renderer.cam.target = c;
    S.renderer.cam.az = (g.faces.A.azimuth + 25) % 360; S.renderer.cam.el = 32;
    S.renderer.cam.dist = Math.max(g.roofLen, g.W) * 2.2;
    S.renderer.draw();
  }

  function renderFaces() {
    const mode = $('#faceMode').value;
    const mods = S.layout.modules;
    const map = stringMap();
    let colors = null, sub = null;
    if (mode === 'loss' && S.res && !S.stale) { colors = mods.map((m, i) => lossHex(S.res.ref.moduleLoss[i])); sub = mods.map((m, i) => fmt(S.res.ref.moduleLoss[i] * 100, 1) + ' %'); }
    if (mode === 'strings' && S.res && !S.stale) { colors = mods.map((m, i) => map[i] ? PVP.plan2d.STRING_COLORS[(map[i].tracker - 1) % 10] : '#666f7a'); sub = mods.map((m, i) => map[i] ? `T${map[i].tracker}.${map[i].string}-${map[i].pos}` : '–'); }
    let h = '';
    for (const f of ['A', 'B']) {
      const F = S.g.faces[f];
      h += `<figure><figcaption><b>${esc(t('face_' + f))}</b> · ${fmt(F.azimuth)}° ${PVP.plan2d.compass(F.azimuth)} · ${fmt(F.pitch, 1)}° · ${mods.filter(m => m.face === f).length} ${esc(t('modules'))}</figcaption>${PVP.plan2d.faceSVG(P, S.g, f, mods, { colors, sub })}</figure>`;
    }
    $('#faces').innerHTML = h;
    const w = S.layout.warnings || [];
    const fw = $('#faceWarn');
    fw.hidden = !w.length;
    fw.textContent = w.length ? t('warn_layout', { list: w.map(x => x.n).join(', ') }) : '';
  }
  function lossHex(l) { const c = PVP.render3d.lossColor(l); return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; }
  function combinedFacesSVG() {
    const parts = $$('#faces svg').map(s => s.outerHTML);
    let y = 0, body = '';
    const W = Math.max(...$$('#faces svg').map(s => s.viewBox.baseVal.width));
    $$('#faces svg').forEach((s, i) => { const vb = s.viewBox.baseVal; body += `<g transform="translate(0,${y})">${parts[i].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`; y += vb.height + 20; });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" height="${y}">${body}</svg>`;
  }

  function renderSite() { $('#site').innerHTML = PVP.plan2d.siteSVG(P, S.g, S.layout.modules); }

  function renderHeat() {
    if (!S.res || S.stale) return;
    const sel = $('#heatSel');
    const cur = sel.value;
    const mods = S.res.mods;
    sel.innerHTML = `<option value="all">${esc(t('heat_all'))}</option><option value="A">${esc(t('face_A'))}</option><option value="B">${esc(t('face_B'))}</option>` +
      mods.map((m, i) => `<option value="${i}">${esc(t('module'))} ${m.n} (${m.face}) · ${fmt(S.res.ref.moduleLoss[i] * 100, 1)} %</option>`).join('');
    sel.value = cur && [...sel.options].some(o => o.value === cur) ? cur : 'all';
    const v = sel.value;
    const cv = $('#heat');
    cv.width = Math.max(600, cv.clientWidth || 1100); cv.height = Math.round(cv.width * 0.34);
    PVP.plan2d.drawHeat(cv, S.res.ctx, v === 'all' || v === 'A' || v === 'B' ? v : +v, P.site.timeZone);
    // loss table
    const rows = mods.map((m, i) => ({ m, i, loss: S.res.ref.moduleLoss[i], kwh: S.res.ref.module[i] })).sort((a, b) => b.loss - a.loss);
    $('#lossTable').innerHTML = `<table class="data"><thead><tr><th>${esc(t('module'))}</th><th>${esc(t('c_face'))}</th><th>${esc(t('r_loss'))}</th><th>${esc(t('r_kwh_mod'))}</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${r.m.n}</td><td>${r.m.face}</td><td><span class="bar" style="--w:${Math.min(100, r.loss / 0.15 * 100)}%"></span>${fmt(r.loss * 100, 1)} %</td><td>${fmt(r.kwh)}</td></tr>`).join('') + '</tbody></table>';
  }

  // ---------------------------------------------------------------- simulation
  async function runSim() {
    if (S.running) return;
    recompute();
    const mods = S.layout.modules;
    if (!mods.length) { alert(t('no_modules')); return; }
    S.running = true;
    const pb = $('.progress'), bar = $('.progress .bar'), lab = $('.progress span');
    if (pb) pb.hidden = false;
    const btn = $('[data-act="run"]'); if (btn) btn.disabled = true;
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      const t0 = performance.now();
      const ctx = PVP.shade.prepare(P, mods, { quality: P.sim.quality });
      while (!ctx.done) {
        const p = PVP.shade.step(ctx, 300);
        if (bar) bar.style.width = (p * 80).toFixed(1) + '%';
        if (lab) lab.textContent = t('prog_shade', { p: Math.round(p * 100) });
        await tick();
      }
      if (lab) lab.textContent = t('prog_strings'); if (bar) bar.style.width = '85%';
      await tick();
      const E = PVP.energy.prepare(ctx);
      const ref = PVP.energy.reference(ctx, E);
      const opt = PVP.strings.optimize(ctx, E);
      const cab = opt.plan && opt.plan.trackers.length ? PVP.strings.cables(P, S.g, mods, opt.plan) : [];
      S.res = { ctx, E, ref, opt, cab, mods, ms: performance.now() - t0, climate: PVP.project.climate(P) };
      S.stale = false;
      if (bar) bar.style.width = '100%';
      if (lab) lab.textContent = t('prog_done', { s: fmt(S.res.ms / 1000, 1) });
      markStale(); refreshViews(); renderResult(); renderHeat();
      if ($('#colorMode').value === 'plain') $('#colorMode').value = 'strings';
      if ($('#faceMode').value === 'plain') $('#faceMode').value = 'strings';
      refreshViews();
      switchTab('result');
    } catch (e) {
      console.error(e);
      if (lab) lab.textContent = 'Error: ' + e.message;
    } finally {
      S.running = false; if (btn) btn.disabled = false;
    }
  }

  function moduleExtra() {
    const map = stringMap();
    return S.layout.modules.map((m, i) => {
      const e = {};
      if (map[i]) { e.tracker = map[i].tracker; e.string = map[i].string; }
      if (S.res && !S.stale) { e.loss = S.res.ref.moduleLoss[i]; e.kwh = S.res.ref.module[i]; }
      return e;
    });
  }

  function renderResult() {
    const el = $('#result');
    if (!S.res) { el.innerHTML = `<p class="empty">${esc(t('no_result'))}</p>`; return; }
    const R = S.res, mods = R.mods, ref = R.ref, opt = R.opt, kwp = mods.length * P.module.pmax / 1000;
    const total = opt.ev ? opt.ev.total : 0;
    const L = opt.lim;
    let h = '';
    if (R.climate.estimated) h += `<div class="warn">${esc(t('warn_clim'))}</div>`;
    if (opt.error) h += `<div class="warn">${esc(t('err_' + opt.error))}</div>`;
    h += `<div class="kpis">
      ${kpi(t('k_modules'), mods.length, fmt(kwp, 2) + ' kWp')}
      ${kpi(t('k_yield'), fmt(total) + ' kWh', t('k_per_year'))}
      ${kpi(t('k_specific'), fmt(total / kwp) + ' kWh/kWp', '')}
      ${kpi(t('k_shading'), fmt((1 - ref.ideal / ref.unshaded) * 100, 1) + ' %', t('k_shading_sub'))}
      ${kpi(t('k_micro'), (ref.micro - total >= 0 ? '+' : '') + fmt(ref.micro - total) + ' kWh', t('k_micro_sub'))}
    </div>`;
    // monthly chart
    const fA = ref.monthlyFace.A, fB = ref.monthlyFace.B;
    h += `<h3>${esc(t('r_monthly'))}</h3><div class="chartwrap">${PVP.plan2d.monthlySVG([fA, fB], [t('face_A'), t('face_B')], ['#e0a03a', '#2a78d6'])}</div>
      <p class="legend"><i style="background:#e0a03a"></i>${esc(t('face_A'))} (${PVP.plan2d.compass(S.g.faces.A.azimuth)}) <i style="background:#2a78d6"></i>${esc(t('face_B'))} (${PVP.plan2d.compass(S.g.faces.B.azimuth)})</p>`;
    // strings
    if (opt.plan && opt.plan.trackers.length) {
      h += `<h3>${esc(t('r_strings', { inv: P.inverter.name }))}</h3><div class="tablewrap"><table class="data"><thead><tr>
        <th>${esc(t('r_tracker'))}</th><th>${esc(t('c_face'))}</th><th>${esc(t('r_order'))}</th><th>n</th><th>kWp</th><th>Voc ${P.electrical.tMin} °C</th><th>Vmp</th><th>Isc</th><th>${esc(t('r_peak'))}</th><th>kWh</th></tr></thead><tbody>`;
      opt.plan.trackers.forEach((tr, ti) => {
        tr.strings.forEach((s, si) => {
          const n = s.length;
          const voc = n * L.vocCold, vmpLo = n * L.vmpHot, vmpHi = n * L.vmpCold;
          const warnV = voc > P.inverter.vmax ? ' bad' : '', warnM = vmpHi > P.inverter.vmppMax ? ' warnc' : '';
          h += `<tr>${si === 0 ? `<td rowspan="${tr.strings.length}"><i class="sw" style="background:${PVP.plan2d.STRING_COLORS[ti % 10]}"></i>T${ti + 1}</td>` : ''}
            <td>${tr.face}</td><td class="order">${s.map(i => mods[i].n).join('–')}</td><td>${n}</td><td>${fmt(n * P.module.pmax / 1000, 2)}</td>
            <td class="${warnV}">${fmt(voc)} V</td><td class="${warnM}">${fmt(vmpLo)}–${fmt(vmpHi)} V</td><td>${fmt(P.module.isc * tr.strings.length, 1)} A</td>
            ${si === 0 ? `<td rowspan="${tr.strings.length}">${fmt(opt.ev.peak[ti])} W</td><td rowspan="${tr.strings.length}">${fmt(opt.ev.trackers[ti])}</td>` : ''}</tr>`;
        });
      });
      h += `</tbody></table></div>`;
      if (opt.plan.unassigned.length) h += `<div class="warn">${esc(t('warn_unassigned', { list: opt.plan.unassigned.map(i => mods[i].n).join(', ') }))}</div>`;
      h += `<p class="hint">${esc(t('r_strings_note', { a: L.nMin, b: L.nMax }))}</p>`;
    }
    // comparison
    h += `<h3>${esc(t('r_compare'))}</h3><div class="tablewrap"><table class="data"><thead><tr><th>${esc(t('r_variant'))}</th><th>kWh</th><th>${esc(t('r_diff'))}</th></tr></thead><tbody>
      ${cmpRow(t('r_v_strings'), total, total)}
      ${cmpRow(t('r_v_micro'), ref.micro, total)}
      ${cmpRow(t('r_v_unshaded'), ref.unshaded, total)}
      </tbody></table></div><p class="hint">${esc(t('r_bypass_note'))}</p>`;
    // cables
    if (R.cab.length) {
      h += `<h3>${esc(t('r_cables'))}</h3><div class="tablewrap"><table class="data"><thead><tr><th>${esc(t('r_tracker'))}</th><th>+ (m)</th><th>− (m)</th><th>${esc(t('r_bridge'))}</th><th>ΔU</th></tr></thead><tbody>` +
        R.cab.map(c => `<tr><td>T${c.tracker}.${c.string}</td><td>${fmt(c.plus, 1)}</td><td>${fmt(c.minus, 1)}</td><td>${c.bridges.length ? c.bridges.map(b => `${b.from}→${b.to}: ${fmt(b.len, 1)} m`).join(', ') : '–'}</td><td>${fmt(c.dU, 2)} %</td></tr>`).join('') +
        `</tbody></table></div><p class="hint">${esc(t('r_cable_note', { cs: P.electrical.crossSection }))}</p>`;
    }
    h += `<h3>${esc(t('r_export'))}</h3><div class="row">
      <button type="button" data-act="print">${esc(t('act_print'))}</button><button type="button" data-act="csv">CSV</button>
      <button type="button" data-act="dxf">DXF (CAD)</button><button type="button" data-act="svg">SVG</button><button type="button" data-act="save">${esc(t('act_save'))}</button></div>
      <p class="hint">${esc(t('r_method'))}</p>`;
    el.innerHTML = h;
  }
  const kpi = (a, b, c) => `<div class="kpi"><span>${esc(a)}</span><b>${esc(b)}</b><em>${esc(c)}</em></div>`;
  const cmpRow = (name, v, base) => `<tr><td>${esc(name)}</td><td>${fmt(v)}</td><td>${v === base ? '–' : (v > base ? '+' : '') + fmt(v - base) + ' kWh (' + (v > base ? '+' : '') + fmt((v / base - 1) * 100, 1) + ' %)'}</td></tr>`;

  // ---------------------------------------------------------------- report
  function printReport() {
    const div = document.createElement('div');
    div.id = 'printout';
    let img = '';
    try { img = `<img src="${$('#gl').toDataURL('image/png')}" alt="3D">`; } catch (e) { /* ignore */ }
    div.innerHTML = `<h1>${esc(P.name)}</h1><p>${esc(t('rep_sub', { lat: P.site.lat, lon: P.site.lon }))} · ${I.date(new Date())}</p>${img}
      <h2>${esc(t('tab_faces'))}</h2>${$('#faces').innerHTML}<h2>${esc(t('tab_site'))}</h2>${$('#site').innerHTML}<h2>${esc(t('tab_result'))}</h2>${$('#result').innerHTML}`;
    document.body.appendChild(div);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); div.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 2000);
  }

  // ---------------------------------------------------------------- OSM dialog
  function openOSM() {
    const d = $('#osmDialog');
    $('#osmLat').value = P.site.lat; $('#osmLon').value = P.site.lon;
    $('#osmStatus').textContent = '';
    if (!S.osm) $('#osmMap').innerHTML = `<p class="empty">${esc(t('osm_empty'))}</p>`;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  async function osmSearch() {
    const q = $('#osmQuery').value.trim(); if (!q) return;
    $('#osmStatus').textContent = t('osm_searching');
    try {
      const hits = await PVP.osm.geocode(q, I.lang);
      $('#osmHits').innerHTML = hits.map((h, i) => `<button type="button" data-hit="${i}">${esc(h.name)}</button>`).join('') || esc(t('osm_nohit'));
      $('#osmHits').onclick = e => { const b = e.target.closest('[data-hit]'); if (!b) return; const h = hits[+b.dataset.hit]; $('#osmLat').value = h.lat.toFixed(6); $('#osmLon').value = h.lon.toFixed(6); $('#osmHits').innerHTML = ''; osmLoad(); };
      $('#osmStatus').textContent = '';
    } catch (e) { $('#osmStatus').textContent = t('osm_err', { e: e.message }); }
  }
  async function osmLoad() {
    const lat = +$('#osmLat').value, lon = +$('#osmLon').value, rad = +$('#osmRad').value || 80;
    $('#osmStatus').textContent = t('osm_loading');
    try {
      const data = await PVP.osm.fetchBuildings(lat, lon, rad);
      osmData(data, lat, lon);
    } catch (e) { $('#osmStatus').textContent = t('osm_err', { e: e.message }); }
  }
  function osmData(data, lat, lon) {
    const blds = PVP.osm.parse(data, lat, lon);
    S.osm = { blds, lat, lon, sel: {} };
    // preselect the building containing the centre point
    const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const hit = blds.find(b => inside([0, 0], b.footprint));
    if (hit) S.osm.sel[hit.id] = 'own';
    $('#osmStatus').textContent = t('osm_found', { n: blds.length });
    drawOSM();
  }
  function drawOSM() {
    const O = S.osm; if (!O) return;
    const pts = [].concat(...O.blds.map(b => b.footprint));
    if (!pts.length) { $('#osmMap').innerHTML = `<p class="empty">${esc(t('osm_none'))}</p>`; return; }
    const x0 = Math.min(...pts.map(p => p[0])) - 3, x1 = Math.max(...pts.map(p => p[0])) + 3, y0 = Math.min(...pts.map(p => p[1])) - 3, y1 = Math.max(...pts.map(p => p[1])) + 3;
    const k = 6, X = e => (e - x0) * k, Y = n => (y1 - n) * k;
    const col = { own: '#e07a1f', attached: '#f5c542', ignore: '#ffffff', neighbor: '#9aa3ad' };
    let s = `<svg viewBox="0 0 ${(x1 - x0) * k} ${(y1 - y0) * k}" xmlns="http://www.w3.org/2000/svg">`;
    for (const b of O.blds) {
      const st = O.sel[b.id] || 'neighbor';
      s += `<polygon data-b="${b.id}" points="${b.footprint.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="${col[st]}" stroke="#334" stroke-width="1" ${st === 'ignore' ? 'stroke-dasharray="4 3"' : ''} style="cursor:pointer"><title>${esc(b.tags['addr:street'] || '')} ${esc(b.tags['addr:housenumber'] || '')} (${esc(b.tags.building)})</title></polygon>`;
    }
    s += `<circle cx="${X(0)}" cy="${Y(0)}" r="4" fill="#c0392b"/><text x="${(x1 - x0) * k - 8}" y="22" font-size="16" font-weight="700" text-anchor="end">N ↑</text></svg>`;
    $('#osmMap').innerHTML = s;
  }
  function osmApply() {
    const O = S.osm; if (!O) return;
    const sel = { own: [], attached: [], ignore: [] };
    for (const [id, st] of Object.entries(O.sel)) if (sel[st]) sel[st].push(id);
    if (!sel.own.length) { $('#osmStatus').textContent = t('osm_need_own'); return; }
    try {
      PVP.osm.applySelection(P, O.blds, sel, O.lat, O.lon, { ridgeAcross: $('#osmAcross').checked });
      P.neighbors.forEach(n => { delete n.rect; });
      $('#osmDialog').close ? $('#osmDialog').close() : $('#osmDialog').removeAttribute('open');
      S.res = null; afterLoad();
    } catch (e) { $('#osmStatus').textContent = t('osm_err', { e: e.message }); }
  }

  // ---------------------------------------------------------------- tabs / init
  function switchTab(name) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
    if (name === '3d' && S.renderer) S.renderer.resize();
    if (name === 'shade') renderHeat();
  }

  function toggleModule(i) {
    const m = S.layout.modules[i]; if (!m) return;
    P.layout.disabled = (P.layout.disabled || []).concat([m.id]);
    changed();
  }

  function helpLink() { const a = $('[data-i18n="act_help"]'); if (a) a.href = I.lang === 'de' ? 'docs/ANLEITUNG.md' : 'docs/GUIDE.md'; }
  function init() {
    I.init();
    P = loadInitial();
    I.apply(); helpLink();
    $('#projName').value = P.name || '';
    $('#lang').value = I.lang;
    try {
      S.renderer = new PVP.render3d.Renderer($('#gl'));
      S.renderer.onPick = it => { if (it.type === 'module') toggleModule(it.index); };
      window.addEventListener('resize', () => S.renderer.resize());
      if (window.ResizeObserver) new ResizeObserver(() => S.renderer.resize()).observe($('#gl'));
    } catch (e) {
      const m = $('#glmsg'); m.hidden = false; m.textContent = t('no_webgl');
    }
    renderSide();
    recompute();
    resetCamera();
    renderResult();
    markStale();
    // events
    const side = $('#side');
    side.addEventListener('change', onSideInput);
    side.addEventListener('input', e => { if (e.target.type === 'number' || e.target.type === 'text') onSideInput(e); });
    side.addEventListener('click', onSideClick);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && !side.contains(b)) action(b.dataset.act);
      const tb = e.target.closest('[data-tab]'); if (tb) switchTab(tb.dataset.tab);
      const vb = e.target.closest('[data-view]');
      if (vb && S.renderer) { const g = S.g; S.renderer.view(vb.dataset.view, PVP.geom.toWorld(g, g.L / 2, g.W / 2, g.H * 0.5), Math.max(g.roofLen, g.W)); }
      const fm = e.target.closest('#faces [data-mod]'); if (fm) toggleModule(+fm.dataset.mod);
      const ob = e.target.closest('#osmMap [data-b]');
      if (ob && S.osm) { const mode = $('input[name="osmMode"]:checked').value; S.osm.sel[ob.dataset.b] = mode === 'neighbor' ? undefined : mode; drawOSM(); }
    });
    $('#projName').addEventListener('input', e => { P.name = e.target.value; persist(); });
    $('#lang').addEventListener('change', e => { I.setLang(e.target.value); I.apply(); helpLink(); renderSide(); refreshViews(); renderResult(); markStale(); });
    $('#fileOpen').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { P = PVP.project.normalize(JSON.parse(await f.text())); S.res = null; afterLoad(); } catch (err) { alert(t('err_file') + ' ' + err.message); }
      e.target.value = '';
    });
    for (const id of ['sunOn', 'sunDay', 'sunMin', 'colorMode', 'showCables', 'showLabels']) $('#' + id).addEventListener('input', render3D);
    $('#faceMode').addEventListener('change', renderFaces);
    $('#heatSel').addEventListener('change', renderHeat);
    $('#sunPlay').addEventListener('click', () => {
      if (S.playing) { clearInterval(S.playing); S.playing = null; $('#sunPlay').textContent = t('sun_play'); return; }
      $('#sunOn').checked = true;
      $('#sunPlay').textContent = t('sun_stop');
      S.playing = setInterval(() => { const el = $('#sunMin'); let v = +el.value + 10; if (v > 1320) v = 240; el.value = v; render3D(); }, 120);
    });
    $('#osmSearch').addEventListener('click', osmSearch);
    $('#osmQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); osmSearch(); } });
    $('#osmLoad').addEventListener('click', osmLoad);
    $('#osmApply').addEventListener('click', osmApply);
    window.addEventListener('beforeprint', () => { if (!document.body.classList.contains('printing')) { /* plain print */ } });
  }

  // test hooks
  PVP.app = { get project() { return P; }, get state() { return S; }, runSim, osmData, osmApply, action, switchTab, recompute };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
