/* Small dependency-free WebGL renderer: flat-shaded triangles, lines, planar projected shadows,
 * orbit camera, picking. World frame: x east, y up, z south. */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};

  const VS = `attribute vec3 aPos; attribute vec3 aNor; attribute vec4 aCol;
uniform mat4 uMVP; uniform vec3 uLight; uniform float uAmb; uniform float uLit;
varying vec4 vCol;
void main(){ gl_Position = uMVP * vec4(aPos,1.0);
  float d = max(dot(normalize(aNor), uLight), 0.0);
  float k = mix(1.0, uAmb + (1.0-uAmb)*d, uLit);
  vCol = vec4(aCol.rgb * k, aCol.a); }`;
  const FS = `precision mediump float; varying vec4 vCol; void main(){ gl_FragColor = vCol; }`;

  // ---------- small math ----------
  const M4 = {
    mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
    lookAt(e, c, up) {
      let z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
      const o = new Float32Array(16);
      o[0] = x[0]; o[4] = x[1]; o[8] = x[2]; o[1] = y[0]; o[5] = y[1]; o[9] = y[2]; o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
      o[12] = -dot(x, e); o[13] = -dot(y, e); o[14] = -dot(z, e); o[15] = 1; return o;
    },
    xf(m, p) { const x = p[0], y = p[1], z = p[2]; const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w]; },
    inv(m) {
      const inv = new Float32Array(16);
      inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
      inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
      inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
      inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
      inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
      inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
      inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
      inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
      inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
      inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
      inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
      inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
      inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
      inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
      inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
      inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
      let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]; det = 1 / det;
      for (let i = 0; i < 16; i++) inv[i] *= det; return inv;
    }
  };
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scl(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function hex(c, a) { const n = parseInt(c.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a === undefined ? 1 : a]; }

  /** Mesh builder collecting triangles and lines. */
  function Mesh() { this.tri = []; this.line = []; this.shadow = []; }
  Mesh.prototype.addTri = function (a, b, c, col, n) {
    n = n || norm(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) this.tri.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], col[3]);
  };
  Mesh.prototype.addQuad = function (a, b, c, d, col, n) { this.addTri(a, b, c, col, n); this.addTri(a, c, d, col, n); };
  Mesh.prototype.addLine = function (a, b, col) { for (const p of [a, b]) this.line.push(p[0], p[1], p[2], 0, 1, 0, col[0], col[1], col[2], col[3]); };
  Mesh.prototype.addLoop = function (pts, col) { for (let i = 0; i < pts.length; i++) this.addLine(pts[i], pts[(i + 1) % pts.length], col); };
  Mesh.prototype.addBox = function (base, top, col, edge) {
    this.addQuad(top[0], top[1], top[2], top[3], col);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.addQuad(base[i], base[j], top[j], top[i], col); }
    if (edge) { this.addLoop(top, edge); for (let i = 0; i < 4; i++) this.addLine(base[i], top[i], edge); }
  };
  Mesh.prototype.addSphere = function (c, r, col, seg) {
    seg = seg || 10;
    const P = (i, j) => { const th = Math.PI * i / seg, ph = 2 * Math.PI * j / seg; return [c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph)]; };
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
      const a = P(i, j), b = P(i + 1, j), d = P(i, j + 1), e = P(i + 1, j + 1);
      const n = norm(sub(scl(add(add(a, b), add(d, e)), 0.25), c));
      this.addTri(a, b, e, col, n); this.addTri(a, e, d, col, n);
    }
  };

  function Renderer(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts || {};
    const gl = canvas.getContext('webgl', { antialias: true, stencil: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    this.pr = pr;
    this.loc = { pos: gl.getAttribLocation(pr, 'aPos'), nor: gl.getAttribLocation(pr, 'aNor'), col: gl.getAttribLocation(pr, 'aCol'),
      mvp: gl.getUniformLocation(pr, 'uMVP'), light: gl.getUniformLocation(pr, 'uLight'), amb: gl.getUniformLocation(pr, 'uAmb'), lit: gl.getUniformLocation(pr, 'uLit') };
    this.buf = { tri: gl.createBuffer(), line: gl.createBuffer(), shadow: gl.createBuffer(), over: gl.createBuffer() };
    this.n = { tri: 0, line: 0, shadow: 0, over: 0 };
    this.cam = { az: 210, el: 32, dist: 32, target: [0, 4, 0] };
    this.light = norm([0.4, 0.8, 0.45]);
    this.pickables = [];
    this.labels = [];
    this._bindInput();
    this.resize();
  }
  Renderer.prototype.upload = function (name, arr) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[name]); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW); this.n[name] = arr.length / 10;
  };
  Renderer.prototype.setScene = function (mesh, shadowMesh, overlay) {
    this.upload('tri', mesh.tri); this.upload('line', mesh.line);
    this.upload('shadow', shadowMesh ? shadowMesh.tri : []);
    this.upload('over', overlay ? overlay.tri : []);
    this.draw();
  };
  Renderer.prototype.resize = function () {
    const c = this.canvas, dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(10, c.clientWidth), h = Math.max(10, c.clientHeight);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.draw();
  };
  Renderer.prototype.matrices = function () {
    const c = this.cam, D2R = Math.PI / 180;
    const eye = [c.target[0] + c.dist * Math.cos(c.el * D2R) * Math.sin(c.az * D2R), c.target[1] + c.dist * Math.sin(c.el * D2R), c.target[2] - c.dist * Math.cos(c.el * D2R) * Math.cos(c.az * D2R)];
    const asp = this.canvas.width / this.canvas.height;
    const P = M4.persp(40 * D2R, asp, 0.3, 2000), V = M4.lookAt(eye, c.target, [0, 1, 0]);
    return { P, V, MVP: M4.mul(P, V), eye };
  };
  Renderer.prototype.draw = function () {
    if (this._raf) return;
    this._raf = (root.requestAnimationFrame || (f => setTimeout(f, 16)))(() => { this._raf = null; this._draw(); });
  };
  Renderer.prototype._bindAttr = function (name) {
    const gl = this.gl, L = this.loc; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[name]);
    gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(L.nor); gl.vertexAttribPointer(L.nor, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(L.col); gl.vertexAttribPointer(L.col, 4, gl.FLOAT, false, 40, 24);
  };
  Renderer.prototype._draw = function () {
    const gl = this.gl, L = this.loc;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = this.opts.background || [0.86, 0.9, 0.94, 1];
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.pr);
    const m = this.matrices(); this._m = m;
    gl.uniformMatrix4fv(L.mvp, false, m.MVP);
    gl.uniform3fv(L.light, this.light); gl.uniform1f(L.amb, 0.55);
    gl.uniform1f(L.lit, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.n.tri) { this._bindAttr('tri'); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); gl.drawArrays(gl.TRIANGLES, 0, this.n.tri); gl.disable(gl.POLYGON_OFFSET_FILL); }
    if (this.n.shadow) {
      gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.depthMask(false); gl.uniform1f(L.lit, 0);
      this._bindAttr('shadow'); gl.drawArrays(gl.TRIANGLES, 0, this.n.shadow);
      gl.depthMask(true); gl.disable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff);
    }
    gl.uniform1f(L.lit, 0);
    if (this.n.over) { this._bindAttr('over'); gl.drawArrays(gl.TRIANGLES, 0, this.n.over); }
    if (this.n.line) { this._bindAttr('line'); gl.drawArrays(gl.LINES, 0, this.n.line); }
    this._placeLabels();
  };
  Renderer.prototype.project = function (p) {
    const m = this._m || this.matrices();
    const q = M4.xf(m.MVP, p);
    if (q[3] <= 0) return null;
    return [(q[0] + 1) / 2 * this.canvas.clientWidth, (1 - q[1]) / 2 * this.canvas.clientHeight];
  };
  Renderer.prototype.setLabels = function (labels, host) {
    this.labelHost = host; this.labels = labels || [];
    if (!host) return;
    host.innerHTML = '';
    for (const l of this.labels) { const d = document.createElement('div'); d.className = 'lbl3d ' + (l.cls || ''); d.textContent = l.text; host.appendChild(d); l.el = d; }
    this.draw();
  };
  Renderer.prototype._placeLabels = function () {
    for (const l of this.labels) {
      if (!l.el) continue;
      const s = this.project(l.p);
      const back = l.n && this._m && dot(l.n, sub(this._m.eye, l.p)) <= 0;
      if (!s || l.hidden || back) { l.el.style.display = 'none'; continue; }
      l.el.style.display = ''; l.el.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-50%)`;
    }
  };
  /** Ray through a canvas pixel (CSS px). */
  Renderer.prototype.ray = function (x, y) {
    const m = this._m || this.matrices();
    const inv = M4.inv(m.MVP);
    const nx = x / this.canvas.clientWidth * 2 - 1, ny = 1 - y / this.canvas.clientHeight * 2;
    const a = M4.xf(inv, [nx, ny, -1]), b = M4.xf(inv, [nx, ny, 1]);
    return { o: [a[0], a[1], a[2]], d: norm(sub([b[0], b[1], b[2]], [a[0], a[1], a[2]])) };
  };
  Renderer.prototype.pick = function (x, y) {
    const r = this.ray(x, y); let best = null;
    for (const pk of this.pickables) {
      for (const [a, b, c] of pk.tris) {
        const e1 = sub(b, a), e2 = sub(c, a), pv = cross(r.d, e2), det = dot(e1, pv);
        if (Math.abs(det) < 1e-9) continue;
        const tv = sub(r.o, a), u = dot(tv, pv) / det; if (u < 0 || u > 1) continue;
        const qv = cross(tv, e1), v = dot(r.d, qv) / det; if (v < 0 || u + v > 1) continue;
        const t = dot(e2, qv) / det; if (t > 0 && (!best || t < best.t)) best = { t, item: pk.item };
      }
    }
    return best && best.item;
  };
  Renderer.prototype._bindInput = function () {
    const c = this.canvas; let drag = null; const ptrs = new Map();
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, moved: 0 };
      if (ptrs.size === 2) { const v = [...ptrs.values()]; drag.pinch = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); drag.mid = [(v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2]; }
    });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2 && drag.pinch) {
        const v = [...ptrs.values()], d = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]);
        this.cam.dist = Math.max(3, Math.min(400, this.cam.dist * drag.pinch / d)); drag.pinch = d;
        const mid = [(v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2];
        this._pan(mid[0] - drag.mid[0], mid[1] - drag.mid[1]); drag.mid = mid; drag.moved = 99; this.draw(); return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) this._pan(dx, dy);
      else { this.cam.az -= dx * 0.4; this.cam.el = Math.max(2, Math.min(89, this.cam.el + dy * 0.3)); }
      this.draw();
    });
    const up = e => {
      ptrs.delete(e.pointerId);
      if (drag && drag.moved < 4 && this.onPick && e.type === 'pointerup') {
        const r = c.getBoundingClientRect(); const it = this.pick(e.clientX - r.left, e.clientY - r.top); if (it) this.onPick(it);
      }
      if (!ptrs.size) drag = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist = Math.max(3, Math.min(400, this.cam.dist * Math.exp(e.deltaY * 0.001))); this.draw(); }, { passive: false });
  };
  Renderer.prototype._pan = function (dx, dy) {
    const k = this.cam.dist * 0.0016, a = this.cam.az * Math.PI / 180;
    const right = [-Math.cos(a), 0, -Math.sin(a)], fwd = [-Math.sin(a), 0, Math.cos(a)];
    this.cam.target = add(this.cam.target, add(scl(right, -dx * k), scl(fwd, dy * k)));
  };
  Renderer.prototype.view = function (name, center, size) {
    const t = center || this.cam.target, d = (size || 16) * 2.1;
    const v = { iso: [this.cam.az, 32], top: [this.cam.az, 89], N: [0, 12], E: [90, 12], S: [180, 12], W: [270, 12] }[name] || [210, 32];
    this.cam.az = v[0]; this.cam.el = v[1]; this.cam.target = t.slice(); this.cam.dist = d; this.draw();
  };

  // ---------- scene construction ----------
  const COL = {
    ground: hex('#cfd8c9'), wall: hex('#ece6dc'), wallOther: hex('#e1dbd1'), roof: hex('#b4553b'), roofOther: hex('#9d4b36'),
    edge: hex('#5b3a2e', 0.9), module: hex('#16233a'), moduleOff: hex('#16233a', 0.25), frame: hex('#a7b3c2', 0.9),
    chimney: hex('#7a5a4a'), window: hex('#2c3e50'), nbWall: hex('#c9ccd1'), nbRoof: hex('#8a9099'), tree: hex('#4f8a3c', 0.9), conifer: hex('#2f6b3a', 0.95),
    shadow: [0.05, 0.08, 0.15, 0.38], section: hex('#f5a623'), sun: hex('#f7b500'), north: hex('#c0392b')
  };

  function shadeColor(f) {
    // f: lit fraction 0..1 → blue (lit) to dark red (shaded)
    const a = hex('#1f5fa8'), b = hex('#3b1f2b');
    return [a[0] * f + b[0] * (1 - f), a[1] * f + b[1] * (1 - f), a[2] * f + b[2] * (1 - f), 1];
  }
  function lossColor(l) {
    // annual loss 0..0.15 → light → dark
    const k = Math.min(1, l / 0.12);
    const a = hex('#2a7fd6'), b = hex('#b5302b');
    return [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k, 1];
  }

  /** Build all meshes for a project. state: {modules, colors (per module) | null, sunDir|null, show:{...}} */
  function buildScene(project, state) {
    const G = PVP.geom, g = G.building(project.building);
    const mesh = new Mesh(), shadowMesh = new Mesh(), overlay = new Mesh();
    const show = state.show || {};
    const pick = [];
    // ground
    const R = 60;
    mesh.addQuad([-R, 0, -R], [-R, 0, R], [R, 0, R], [R, 0, -R], COL.ground, [0, 1, 0]);
    // north arrow on the ground
    const na = [[0, 0.02, -R * 0.2], [-1.2, 0.02, -R * 0.2 + 3], [1.2, 0.02, -R * 0.2 + 3]];
    overlay.addTri(na[0], na[1], na[2], COL.north, [0, 1, 0]);
    // building
    const bm = G.buildingMesh(g);
    for (const t of bm.walls) mesh.addTri(t[0], t[1], t[2], COL.wall);
    const sec = project.building.section;
    const partial = sec.from > 1e-6 || sec.to < g.L - 1e-6;
    for (const f of ['A', 'B']) {
      const c = bm.roof[f];
      if (partial) {
        // split roof along the own section to colour the neighbour part differently
        const cuts = [g.u0, sec.from > 1e-6 ? sec.from : g.u0, sec.to < g.L - 1e-6 ? sec.to : g.u1, g.u1];
        for (let k = 0; k < 3; k++) {
          const a = cuts[k], b = cuts[k + 1]; if (b - a < 1e-6) continue;
          const pa = G.uToP(g, f, a), pb = G.uToP(g, f, b);
          const p0 = Math.min(pa, pb), p1 = Math.max(pa, pb), F = g.faces[f];
          const q = [G.facePoint(g, f, p0, 0), G.facePoint(g, f, p1, 0), G.facePoint(g, f, p1, F.slope), G.facePoint(g, f, p0, F.slope)];
          mesh.addQuad(q[0], q[1], q[2], q[3], k === 1 ? COL.roof : COL.roofOther);
          if (k === 1 && show.section !== false) mesh.addLoop(q.map(p => [p[0], p[1] + 0.03, p[2]]), COL.section);
        }
      } else mesh.addQuad(c[0], c[1], c[2], c[3], COL.roof);
      mesh.addLoop(c, COL.edge);
    }
    // obstacles
    for (const o of project.obstacles) {
      if (o.top > 0) {
        const B = G.obstacleBox(g, o);
        mesh.addBox(B.base, B.top, COL.chimney, COL.edge);
        pick.push({ tris: [[B.top[0], B.top[1], B.top[2]], [B.top[0], B.top[2], B.top[3]]], item: { type: 'obstacle', id: o.id } });
      } else {
        const Rr = G.obstacleRect(g, o);
        const q = [[Rr.p0, Rr.s0], [Rr.p1, Rr.s0], [Rr.p1, Rr.s1], [Rr.p0, Rr.s1]].map(([p, s]) => G.facePoint(g, o.face, p, s, 0.03));
        mesh.addQuad(q[0], q[1], q[2], q[3], o.kind === 'window' ? COL.window : COL.chimney);
      }
    }
    // neighbours
    for (const nb of project.neighbors) {
      if (!nb.footprint || nb.footprint.length < 3) continue;
      const m = G.neighborMesh(nb);
      for (const t of m.walls) mesh.addTri(t[0], t[1], t[2], COL.nbWall);
      for (const t of m.roof) mesh.addTri(t[0], t[1], t[2], COL.nbRoof);
    }
    // trees
    for (const t of project.trees || []) {
      const s = G.treeSphere(t);
      mesh.addSphere(s.c, s.r, t.type === 'conifer' ? COL.conifer : COL.tree, 9);
      const trunk = 0.18;
      const b0 = [[t.e - trunk, 0, -t.n - trunk], [t.e + trunk, 0, -t.n - trunk], [t.e + trunk, 0, -t.n + trunk], [t.e - trunk, 0, -t.n + trunk]];
      mesh.addBox(b0, b0.map(p => [p[0], s.c[1] - s.r * 0.5, p[2]]), hex('#6b4f3a'));
    }
    // modules
    const mod = project.module, lift = mod.lift;
    (state.modules || []).forEach((m, i) => {
      const th = mod.thickness || 0.03;
      const c = [[m.p, m.s], [m.p + m.w, m.s], [m.p + m.w, m.s + m.h], [m.p, m.s + m.h]];
      const top = c.map(([p, s]) => G.facePoint(g, m.face, p, s, lift + th));
      const base = c.map(([p, s]) => G.facePoint(g, m.face, p, s, lift));
      const col = state.colors && state.colors[i] ? state.colors[i] : (m.disabled ? COL.moduleOff : COL.module);
      mesh.addBox(base, top, col);
      // cell grid hint
      const grid = [];
      const nx = m.orient === 'landscape' ? mod.cellsLong : mod.cellsShort, ny = m.orient === 'landscape' ? mod.cellsShort : mod.cellsLong;
      for (let k = 1; k < nx; k += (m.orient === 'landscape' ? 3 : 2)) grid.push([[m.p + m.w * k / nx, m.s], [m.p + m.w * k / nx, m.s + m.h]]);
      if (mod.halfCut) grid.push([[m.p, m.s + m.h / 2], [m.p + m.w, m.s + m.h / 2]].map(x => m.orient === 'landscape' ? x : x));
      const gc = [col[0] + 0.12, col[1] + 0.14, col[2] + 0.18, 0.5];
      for (const [a, b] of grid) mesh.addLine(G.facePoint(g, m.face, a[0], a[1], lift + th + 0.004), G.facePoint(g, m.face, b[0], b[1], lift + th + 0.004), gc);
      mesh.addLoop(top.map((p, k) => G.facePoint(g, m.face, c[k][0], c[k][1], lift + th + 0.004)), COL.frame);
      pick.push({ tris: [[top[0], top[1], top[2]], [top[0], top[2], top[3]]], item: { type: 'module', index: i, id: m.id } });
    });
    // cables (optional)
    if (state.cables) for (const c of state.cables) for (let i = 1; i < c.pts.length; i++) mesh.addLine(c.pts[i - 1], c.pts[i], c.col);
    // projected shadows
    if (state.sunDir && state.sunDir[1] > 0.01) projectShadows(project, g, state, shadowMesh, R);
    // sun marker
    if (state.sunDir) {
      const D = state.sunDir, c = [D[0] * 40, Math.max(2, D[1] * 40), D[2] * 40];
      if (D[1] > 0) { overlay.addSphere(c, 1.4, COL.sun, 8); mesh.addLine([0, 0.05, 0], [c[0], c[1], c[2]], [0.97, 0.7, 0, 0.6]); }
    }
    return { mesh, shadowMesh, overlay, pick, g };
  }

  /** Planar projected shadows on the ground, both roof planes and the module planes. */
  function projectShadows(project, g, state, out, R) {
    const G = PVP.geom, D = state.sunDir;
    const casters = [];
    const bm = G.buildingMesh(g);
    for (const t of bm.walls) casters.push(t);
    for (const f of ['A', 'B']) { const c = bm.roof[f]; casters.push([c[0], c[1], c[2]], [c[0], c[2], c[3]]); }
    const occ = G.occluders(project, g);
    for (const t of occ.tris) casters.push(t);
    for (const sp of occ.spheres) {
      // approximate crown as an octahedron fan
      const c = sp.c, r = sp.r; const P = [];
      for (let k = 0; k < 10; k++) { const a = 2 * Math.PI * k / 10; P.push(add(c, [r * Math.cos(a), 0, r * Math.sin(a)])); }
      const top = add(c, [0, r, 0]), bot = add(c, [0, -r, 0]);
      for (let k = 0; k < 10; k++) { casters.push([top, P[k], P[(k + 1) % 10]]); casters.push([bot, P[(k + 1) % 10], P[k]]); }
    }
    for (const m of state.modules || []) {
      const th = project.module.thickness || 0.03;
      const c = [[m.p, m.s], [m.p + m.w, m.s], [m.p + m.w, m.s + m.h], [m.p, m.s + m.h]].map(([p, s]) => G.facePoint(g, m.face, p, s, project.module.lift + th));
      casters.push([c[0], c[1], c[2]], [c[0], c[2], c[3]]);
    }
    const col = COL.shadow;
    // receivers: ground + roof planes (clipped to the roof rectangles) + module top planes
    const recv = [{ n: [0, 1, 0], d: 0.02, clip: null }];
    for (const f of ['A', 'B']) {
      const F = g.faces[f];
      if (F.normal[0] * D[0] + F.normal[1] * D[1] + F.normal[2] * D[2] <= 0) continue;   // face in self-shadow
      for (const lift of [0.01, project.module.lift + (project.module.thickness || 0.03) + 0.006]) {
        const o = G.facePoint(g, f, 0, 0, lift);
        recv.push({ n: F.normal, d: dot(F.normal, o), face: f, lift });
      }
    }
    for (const rc of recv) {
      const nd = dot(rc.n, D);
      if (nd <= 1e-4) continue;
      for (const t of casters) {
        // project each vertex along -D onto the plane
        const q = [];
        let above = 0;
        for (const p of t) { const dist = dot(rc.n, p) - rc.d; if (dist > 1e-3) above++; q.push(sub(p, scl(D, dist / nd))); }
        if (!above) continue;
        let poly = q;
        if (rc.face) {
          // clip to the roof face rectangle in face coordinates
          poly = clipFace(g, rc.face, poly);
          if (poly.length < 3) continue;
        } else {
          poly = poly.map(p => [Math.max(-R, Math.min(R, p[0])), 0.02, Math.max(-R, Math.min(R, p[2]))]);
        }
        for (let k = 1; k < poly.length - 1; k++) out.addTri(poly[0], poly[k], poly[k + 1], col, rc.n);
      }
    }
  }
  function clipFace(g, face, poly) {
    // map world points on the plane to (p, s), clip to [0,roofLen]x[0,slope], map back
    const F = g.faces[face];
    const o = PVP.geom.facePoint(g, face, 0, 0), ex = norm(sub(PVP.geom.facePoint(g, face, 1, 0), o)), ey = norm(sub(PVP.geom.facePoint(g, face, 0, 1), o));
    const off = dot(F.normal, sub(poly[0], o));
    let pts = poly.map(p => { const v = sub(p, o); return [dot(v, ex), dot(v, ey)]; });
    const clip = (pts, inside, inter) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(inter(a, b)); } return out; };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    pts = clip(pts, p => p[0] >= 0, (a, b) => lerp(a, b, (0 - a[0]) / (b[0] - a[0])));
    pts = clip(pts, p => p[0] <= g.roofLen, (a, b) => lerp(a, b, (g.roofLen - a[0]) / (b[0] - a[0])));
    pts = clip(pts, p => p[1] >= 0, (a, b) => lerp(a, b, (0 - a[1]) / (b[1] - a[1])));
    pts = clip(pts, p => p[1] <= F.slope, (a, b) => lerp(a, b, (F.slope - a[1]) / (b[1] - a[1])));
    return pts.map(([x, y]) => add(add(o, add(scl(ex, x), scl(ey, y))), scl(F.normal, off)));
  }

  PVP.render3d = { Renderer, Mesh, buildScene, shadeColor, lossColor, hex, COL };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
