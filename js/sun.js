/* Sun position (NOAA approximation, accuracy ~0.1–0.3°), clear-sky helpers, time zones. */
(function (root) {
  'use strict';
  const PVP = root.PVP = root.PVP || {};
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const YEAR = 2025;                 // reference (non-leap) year
  const DAY_MS = 86400000;

  /** day: 0..364, minutesUTC: 0..1439. Returns {el, az} in degrees (az clockwise from north). */
  function position(lat, lon, day, minutesUTC) {
    const hr = minutesUTC / 60;
    const g = 2 * Math.PI / 365 * (day + (hr - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = minutesUTC + eqt + 4 * lon;
    const ha = (tst / 4 - 180) * D2R;
    const la = lat * D2R;
    let cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
    cz = Math.max(-1, Math.min(1, cz));
    const zen = Math.acos(cz);
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) * R2D + 180;
    az = ((az % 360) + 360) % 360;
    return { el: 90 - zen * R2D, az, decl };
  }

  /** Unit vector towards the sun in world coordinates (x east, y up, z south). */
  function direction(el, az) {
    const e = el * D2R, a = az * D2R;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  }

  function extraterrestrial(day) { return 1361 * (1 + 0.033 * Math.cos(2 * Math.PI * (day + 1) / 365)); }

  /** Clear-sky GHI shape (Haurwitz-like) used only for the daily course; scaled to monthly sums. */
  function clearSkyGHI(el) {
    if (el <= 0) return 0;
    const cz = Math.sin(el * D2R);
    return 1098 * cz * Math.exp(-0.057 / Math.max(cz, 0.02));
  }

  const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  function monthOfDay(day) { let m = 0; while (day >= MONTH_START[m + 1]) m++; return m; }

  /** Monthly extraterrestrial irradiation on a horizontal plane (kWh/m²). */
  function monthlyH0(lat) {
    const out = new Array(12).fill(0);
    for (let d = 0; d < 365; d++) {
      let s = 0;
      for (let m = 0; m < 1440; m += 10) {
        const p = position(lat, 0, d, m);
        if (p.el > 0) s += extraterrestrial(d) * Math.sin(p.el * D2R) * (10 / 60);
      }
      out[monthOfDay(d)] += s / 1000;
    }
    return out;
  }

  /** Offset of local time vs UTC in minutes for a UTC instant, using the IANA zone. */
  const dtfCache = {};
  function tzOffset(timeZone, utcMs) {
    try {
      let f = dtfCache[timeZone];
      if (!f) {
        f = dtfCache[timeZone] = new Intl.DateTimeFormat('en-US', {
          timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
      }
      const parts = {};
      for (const p of f.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
      const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
      return Math.round((asUTC - Math.floor(utcMs / 60000) * 60000) / 60000);
    } catch (e) {
      return 0;
    }
  }
  /** Offset for local noon of a given day index. */
  function dayOffset(timeZone, day) { return tzOffset(timeZone, Date.UTC(YEAR, 0, 1) + day * DAY_MS + 12 * 3600000); }

  function dateOfDay(day) { return new Date(Date.UTC(YEAR, 0, 1) + day * DAY_MS); }
  function dayOfDate(month, dom) { return MONTH_START[month] + dom - 1; }

  PVP.sun = { position, direction, extraterrestrial, clearSkyGHI, monthlyH0, monthOfDay, MONTH_START,
    tzOffset, dayOffset, dateOfDay, dayOfDate, YEAR };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
