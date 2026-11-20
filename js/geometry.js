/* Geometry: gable-roof building, roof faces, obstacles, neighbours, trees.
 *
 * World frame: x = east, y = up, z = south (metres). Origin = centre of the main building at ground level.
 * Building frame (u, v, h):
 *   u along the ridge, 0 = left gable wall seen from outside face A, L = right gable wall
 *   v across, 0 = eave wall A, W = eave wall B
 *   h height above ground
 * Face frame (p, s), each face seen from outside:
 *   p horizontal from the left roof edge (including gable overhang), s along the slope from the eave edge.
 */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};
  const D2R = Math.PI / 180;

  function building(b) {
    const aA = b.azimuthA * D2R;
    const nA = [Math.sin(aA), Math.cos(aA)];              // (east, north) outward of face A
    const dirV = [-nA[0], -nA[1]];
    const aU = aA - Math.PI / 2;
    const dirU = [Math.sin(aU), Math.cos(aU)];
    const tA = Math.tan(b.pitchA * D2R), tB = Math.tan(b.pitchB * D2R);
    const cA = Math.cos(b.pitchA * D2R), cB = Math.cos(b.pitchB * D2R);
    const sA = Math.sin(b.pitchA * D2R), sB = Math.sin(b.pitchB * D2R);
    const r = b.ridgeOffset, H = b.ridgeHeight, L = b.length, W = b.width;
    const vEA = -b.overhangA, vEB = W + b.overhangB;
    const u0 = -b.overhangGable, u1 = L + b.overhangGable;
    const g = {
      b, dirU, dirV, nA, r, H, L, W, u0, u1, vEA, vEB,
      roofLen: u1 - u0,
      faces: {
        A: { id: 'A', pitch: b.pitchA, tan: tA, cos: cA, sin: sA, slope: (r - vEA) / cA,
          eaveH: H - (r - vEA) * tA, wallH: H - r * tA, azimuth: (b.azimuthA % 360 + 360) % 360, overhang: b.overhangA },
        B: { id: 'B', pitch: b.pitchB, tan: tB, cos: cB, sin: sB, slope: (vEB - r) / cB,
          eaveH: H - (vEB - r) * tB, wallH: H - (W - r) * tB, azimuth: ((b.azimuthA + 180) % 360 + 360) % 360, overhang: b.overhangB }
      }
    };
    // world normals of the roof faces
    for (const f of ['A', 'B']) {
      const F = g.faces[f];
      const nv = f === 'A' ? -F.sin : F.sin;   // component along +v
      F.normal = toWorldDir(g, 0, nv, F.cos);
    }
    return g;
  }

  function toWorld(g, u, v, h) {
    const du = u - g.L / 2, dv = v - g.W / 2;
    const e = du * g.dirU[0] + dv * g.dirV[0], n = du * g.dirU[1] + dv * g.dirV[1];
    return [e, h, -n];
  }
  function toWorldDir(g, du, dv, dh) {
    const e = du * g.dirU[0] + dv * g.dirV[0], n = du * g.dirU[1] + dv * g.dirV[1];
    return [e, dh, -n];
  }
  /** world (e,n) -> building (u,v) */
  function toLocal(g, e, n) {
    // dirU and dirV are orthonormal
    const u = e * g.dirU[0] + n * g.dirU[1] + g.L / 2;
    const v = e * g.dirV[0] + n * g.dirV[1] + g.W / 2;
    return [u, v];
  }
  function roofHeight(g, v) {
    return v <= g.r ? g.H - (g.r - v) * g.faces.A.tan : g.H - (v - g.r) * g.faces.B.tan;
  }

  /** face coords -> building coords */
  function faceToLocal(g, face, p, s) {
    const F = g.faces[face];
    const u = face === 'A' ? g.u0 + p : g.u1 - p;
    const v = face === 'A' ? g.vEA + s * F.cos : g.vEB - s * F.cos;
    const h = F.eaveH + s * F.sin;
    return [u, v, h];
  }
  /** face coords (+ lift along the normal) -> world */
  function facePoint(g, face, p, s, lift) {
    const [u, v, h] = faceToLocal(g, face, p, s);
    const w = toWorld(g, u, v, h);
    if (lift) {
      const n = g.faces[face].normal;
      w[0] += n[0] * lift; w[1] += n[1] * lift; w[2] += n[2] * lift;
    }
    return w;
  }
  /** building u -> face p */
  function uToP(g, face, u) { return face === 'A' ? u - g.u0 : g.u1 - u; }

  /** Usable p-range on a face for modules (own section + margins). */
  function usableRange(g, face, layout) {
    const sec = g.b.section || { from: 0, to: g.L };
    const leftU = sec.from > 1e-6 ? sec.from + layout.marginBoundary : g.u0 + layout.marginVerge;
    const rightU = sec.to < g.L - 1e-6 ? sec.to - layout.marginBoundary : g.u1 - layout.marginVerge;
    const pa = uToP(g, face, leftU), pb = uToP(g, face, rightU);
    return [Math.min(pa, pb), Math.max(pa, pb)];
  }

  /** Obstacle rectangle in face coordinates {p0,p1,s0,s1} (without clearance). */
  function obstacleRect(g, o) {
    const F = g.faces[o.face];
    // fromLeft: horizontal distance from the left gable wall (seen from outside of that face)
    const p0 = o.fromLeft + g.b.overhangGable;
    let s0, s1;
    if (o.mode === 'roof') { s0 = o.fromEave; s1 = o.fromEave + o.depth; }
    else { s0 = (o.fromEave + F.overhang) / F.cos; s1 = s0 + o.depth / F.cos; }
    return { p0, p1: p0 + o.width, s0, s1 };
  }

  /** Box corners (world) of an obstacle that sticks out of the roof (top > roof). */
  function obstacleBox(g, o) {
    const R = obstacleRect(g, o);
    const F = g.faces[o.face];
    const lowH = F.eaveH + R.s0 * F.sin - 0.3;
    const top = o.top;
    const c = [];
    for (const [p, s] of [[R.p0, R.s0], [R.p1, R.s0], [R.p1, R.s1], [R.p0, R.s1]]) {
      const [u, v] = faceToLocal(g, o.face, p, s);
      c.push([u, v]);
    }
    return { base: c.map(([u, v]) => toWorld(g, u, v, lowH)), top: c.map(([u, v]) => toWorld(g, u, v, top)) };
  }

  // ---------- generic helpers ----------
  function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

  /** Ear clipping triangulation of a simple polygon [[x,y],...]; returns index triples. */
  function triangulate(pts) {
    const n = pts.length; if (n < 3) return [];
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    if (polyArea(pts) < 0) idx.reverse();
    const out = []; let guard = 0;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    while (idx.length > 3 && guard++ < 5000) {
      let found = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const a = pts[ia], b = pts[ib], c = pts[ic];
        if (cross(a, b, c) <= 1e-12) continue;
        let ok = true;
        for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(pts[j], a, b, c)) { ok = false; break; } }
        if (!ok) continue;
        out.push([ia, ib, ic]); idx.splice(i, 1); found = true; break;
      }
      if (!found) break;
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
  }

  /** Minimum-area enclosing rectangle (rotating calipers over hull edges). */
  function minRect(pts) {
    const hull = convexHull(pts);
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-9) continue;
      const ux = dx / l, uy = dy / l;
      let mi = 1e9, ma = -1e9, mj = 1e9, mb = -1e9;
      for (const p of hull) { const x = p[0] * ux + p[1] * uy, y = -p[0] * uy + p[1] * ux; mi = Math.min(mi, x); ma = Math.max(ma, x); mj = Math.min(mj, y); mb = Math.max(mb, y); }
      const area = (ma - mi) * (mb - mj);
      if (!best || area < best.area - 1e-9) best = { area, ux, uy, mi, ma, mj, mb };
    }
    if (!best) return null;
    const { ux, uy, mi, ma, mj, mb } = best;
    const P = (x, y) => [x * ux - y * uy, x * uy + y * ux];
    const corners = [P(mi, mj), P(ma, mj), P(ma, mb), P(mi, mb)];
    const lenA = ma - mi, lenB = mb - mj;
    const cx = (corners[0][0] + corners[2][0]) / 2, cy = (corners[0][1] + corners[2][1]) / 2;
    // long axis direction (east, north)
    const longDir = lenA >= lenB ? [ux, uy] : [-uy, ux];
    return { corners, center: [cx, cy], long: Math.max(lenA, lenB), short: Math.min(lenA, lenB), longDir };
  }
  function convexHull(pts) {
    const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  /** Triangles (world) and render info for a neighbour building. */
  function neighborMesh(nb) {
    const tris = [];        // [[a,b,c], ...] world
    const roofTris = [];
    const fp = nb.footprint;
    const base = nb.base || 0, wh = base + nb.wallHeight;
    const W = (e, h, n) => [e, h, -n];
    // walls
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const p1 = W(a[0], base, a[1]), p2 = W(b[0], base, b[1]), p3 = W(b[0], wh, b[1]), p4 = W(a[0], wh, a[1]);
      tris.push([p1, p2, p3], [p1, p3, p4]);
    }
    const roof = nb.roof || 'flat';
    const rh = base + Math.max(nb.ridgeHeight || nb.wallHeight, nb.wallHeight);
    if (roof === 'flat' || rh <= wh + 0.05) {
      for (const [i, j, k] of triangulate(fp)) roofTris.push([W(fp[i][0], wh, fp[i][1]), W(fp[j][0], wh, fp[j][1]), W(fp[k][0], wh, fp[k][1])]);
    } else {
      const R = minRect(fp);
      if (R) {
        let dir = R.longDir;
        if (nb.ridgeDir === 'short') dir = [-dir[1], dir[0]];
        const nrm = [-dir[1], dir[0]];
        const c = R.center;
        let la = 0, lb = 0;
        for (const q of R.corners) { const x = (q[0] - c[0]) * dir[0] + (q[1] - c[1]) * dir[1], y = (q[0] - c[0]) * nrm[0] + (q[1] - c[1]) * nrm[1]; la = Math.max(la, Math.abs(x)); lb = Math.max(lb, Math.abs(y)); }
        const pt = (x, y, h) => W(c[0] + x * dir[0] + y * nrm[0], h, c[1] + x * dir[1] + y * nrm[1]);
        const hipIn = roof === 'hip' ? Math.min(lb, la * 0.9) : 0;
        const r0 = pt(-la + hipIn, 0, rh), r1 = pt(la - hipIn, 0, rh);
        const e00 = pt(-la, -lb, wh), e10 = pt(la, -lb, wh), e11 = pt(la, lb, wh), e01 = pt(-la, lb, wh);
        roofTris.push([e00, e10, r1], [e00, r1, r0], [e11, e01, r0], [e11, r0, r1]);
        if (roof === 'hip') roofTris.push([e10, e11, r1], [e01, e00, r0]);
        else { tris.push([e10, e11, r1], [e01, e00, r0]); }
      }
    }
    return { walls: tris, roof: roofTris };
  }

  /** Tree crown sphere in world coords. */
  function treeSphere(t) {
    const r = t.crownRadius;
    return { c: [t.e, (t.base || 0) + t.height - r, -t.n], r };
  }
  function treeOpacity(t, month) {
    if (t.type === 'conifer') return 0.95;
    const leaf = [0.35, 0.35, 0.4, 0.6, 0.85, 0.9, 0.9, 0.9, 0.85, 0.7, 0.45, 0.35];
    return leaf[month];
  }

  /** Main building mesh (for rendering): walls, gables, roof faces. */
  function buildingMesh(g) {
    const b = g.b, L = g.L, W = g.W;
    const P = (u, v, h) => toWorld(g, u, v, h);
    const walls = [];
    const wA = g.faces.A.wallH, wB = g.faces.B.wallH;
    // long walls
    walls.push([P(0, 0, 0), P(L, 0, 0), P(L, 0, wA)], [P(0, 0, 0), P(L, 0, wA), P(0, 0, wA)]);
    walls.push([P(L, W, 0), P(0, W, 0), P(0, W, wB)], [P(L, W, 0), P(0, W, wB), P(L, W, wB)]);
    // gable walls (pentagon)
    for (const u of [0, L]) {
      const poly = [P(u, 0, 0), P(u, W, 0), P(u, W, wB), P(u, g.r, g.H), P(u, 0, wA)];
      walls.push([poly[0], poly[1], poly[2]], [poly[0], poly[2], poly[3]], [poly[0], poly[3], poly[4]]);
    }
    const roof = {};
    for (const f of ['A', 'B']) {
      const F = g.faces[f];
      const c = [facePoint(g, f, 0, 0), facePoint(g, f, g.roofLen, 0), facePoint(g, f, g.roofLen, F.slope), facePoint(g, f, 0, F.slope)];
      roof[f] = c;
    }
    return { walls, roof };
  }

  /** All occluding triangles for the shading simulation, plus tree spheres. */
  function occluders(project, g) {
    const tris = [];
    for (const o of project.obstacles) {
      if (!(o.top > 0)) continue;
      const B = obstacleBox(g, o);
      const t = B.top, s = B.base;
      tris.push([t[0], t[1], t[2]], [t[0], t[2], t[3]]);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; tris.push([s[i], s[j], t[j]], [s[i], t[j], t[i]]); }
    }
    for (const nb of project.neighbors) {
      if (!nb.footprint || nb.footprint.length < 3) continue;
      const m = neighborMesh(nb);
      for (const t of m.walls) tris.push(t);
      for (const t of m.roof) tris.push(t);
    }
    const spheres = (project.trees || []).map(t => Object.assign(treeSphere(t), { tree: t }));
    return { tris, spheres };
  }

  PVP.geom = { building, toWorld, toWorldDir, toLocal, roofHeight, faceToLocal, facePoint, uToP, usableRange,
    obstacleRect, obstacleBox, neighborMesh, buildingMesh, treeSphere, treeOpacity, occluders,
    triangulate, minRect, convexHull, polyArea };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
