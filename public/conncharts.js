/* ════════════════════════════════════════════════════════════════════════════
   conncharts.js — the chart layer for Connectivity / Calling Behaviour /
   Call Health, plus the "view the table" pop-up.

   WHY CHARTS, AND WHY THE TABLE MOVES BEHIND A BUTTON
   ---------------------------------------------------
   These three tabs were tables first, which is right for auditing a number and
   wrong for seeing a shape. The floor's own workbook makes the same charts —
   ranked bars for the reputation index, a day curve for behaviour, an hour
   curve for inbound — so the eye does the ranking and the table is there only
   when someone wants to check a row. Every card therefore carries a
   "View table" button that opens the SAME table in a pop-up: nothing is
   removed, it just stops being the first thing on the page.

   TWO RULES THIS FILE KEEPS
   1. One chart answers one question, and the metric switch is how you get the
      others — three charts of the same thing side by side is not a choice.
   2. A bar chart of a ratio must carry its baseline (100 for the index, the
      floor mean for a rate) or it invites a reading the number cannot support.

   Plain SVG, no chart library: these are small, static, and the page already
   loads ECharts for the heavier Floor Board grids — adding a second engine for
   twelve bars would cost more than it draws. Curves use the same Catmull-Rom
   smoothing as the Floor Board trend, at the same low tension, so a curve here
   and a curve there mean the same thing.
   ════════════════════════════════════════════════════════════════════════════ */

var CC_INK = '#18233f', CC_MUTED = '#6b7590', CC_RULE = '#e7ebf3';
var CC_BLUE = '#2348a8', CC_GREEN = '#1f6b45', CC_RED = '#b0382c', CC_GOLD = '#8a6d1f';

/* ── The pop-up ──────────────────────────────────────────────────────────────
   One overlay, created once and reused. Styled inline rather than through the
   shells' CSS so this file drops into both index.html and preview.html with no
   stylesheet edit. Escape and backdrop-click both close; the body keeps its
   scroll position because nothing about the page behind it changes. */
function ccModal(title, bodyHtml) {
  var host = document.getElementById('ccModal');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ccModal';
    host.style.cssText = 'position:fixed;inset:0;z-index:9000;display:none;'
      + 'background:rgba(16,22,40,.44);backdrop-filter:blur(2px);padding:28px';
    host.innerHTML = '<div id="ccModalBox" style="background:#fff;border:1px solid ' + CC_RULE
      + ';border-radius:10px;max-width:1180px;margin:0 auto;max-height:100%;display:flex;'
      + 'flex-direction:column;box-shadow:0 24px 60px rgba(16,22,40,.28)">'
      + '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid ' + CC_RULE + '">'
      +   '<b id="ccModalTitle" style="font-size:13px;color:' + CC_INK + ';letter-spacing:.02em"></b>'
      +   '<button id="ccModalX" style="margin-left:auto;border:1px solid ' + CC_RULE + ';background:#fff;'
      +     'border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer;color:' + CC_MUTED + '">Close</button>'
      + '</div>'
      + '<div id="ccModalBody" style="padding:12px 14px;overflow:auto"></div></div>';
    document.body.appendChild(host);
    host.addEventListener('click', function (e) { if (e.target === host) ccModalClose(); });
    host.querySelector('#ccModalX').addEventListener('click', ccModalClose);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && host.style.display !== 'none') ccModalClose();
    });
  }
  host.querySelector('#ccModalTitle').textContent = title;
  host.querySelector('#ccModalBody').innerHTML = bodyHtml;
  host.style.display = 'block';
}
function ccModalClose() {
  var host = document.getElementById('ccModal');
  if (host) { host.style.display = 'none'; host.querySelector('#ccModalBody').innerHTML = ''; }
}
/* Buttons are wired by data attribute after each render, so a renderer only has
   to stash the table HTML on the element. */
function ccTableBtn(label, src, title) {
  return '<button data-cctable="1"' + (src ? ' data-ccsrc="' + esc(src) + '"' : '')
    + (title ? ' data-cctitle="' + esc(title) + '"' : '')
    + ' style="border:1px solid ' + CC_RULE + ';background:#fff;border-radius:6px;'
    + 'padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;color:' + CC_MUTED + '">'
    + esc(label || 'View table') + '</button>';
}
function ccWireTables(panel, title, tableHtml) {
  panel.querySelectorAll('[data-cctable]').forEach(function (b) {
    if (b.getAttribute('data-ccwired')) return;
    b.setAttribute('data-ccwired', '1');
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      ccModal(b.getAttribute('data-cctitle') || title, window[b.getAttribute('data-ccsrc')] || tableHtml || '');
    });
  });
}

/* ── Ranked horizontal bars ──────────────────────────────────────────────────
   items: [{label, value, sub, tint}] already sorted by the caller.
   opts.baseline draws the reference line (100 for an index, a floor mean for a
   rate) and decides the tint when the caller does not set one — a bar for a
   ratio without its baseline is not readable.
   opts.signed centres the axis on zero for a +/- quantity (the shortfall). */
function ccRankedBars(items, opts) {
  var o = opts || {};
  if (!items || !items.length) return '<div class="fb-sub" style="padding:12px 0">Nothing to plot in this view.</div>';
  var rowH = o.rowH || 22, padT = 10, padB = 22, labelW = o.labelW || 148, valW = o.valW || 62;
  var W = 720, H = padT + padB + items.length * rowH;
  var vals = items.map(function (r) { return Number(r.value) || 0; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var base = o.signed ? 0 : (o.baseline !== undefined ? o.baseline : 0);
  var min, max;
  if (o.signed) {
    max = Math.max(Math.abs(lo), Math.abs(hi)) * 1.08 || 1;
    min = -max;
  } else if (o.baseline !== undefined) {
    /* A BASELINED AXIS SPANS THE DEVIATION, NOT ZERO (13 Sep 2026). The index
       is defined to sit near 100, and the coarser the rollup the tighter it
       clusters — an axis running 0→110 drew a 3-point spread as 1.5px slivers
       against 470px of empty gutter. Symmetric around the baseline so "above"
       and "below" stay visually comparable, with a floor on the half-width so a
       0.2-point spread is not magnified into drama. */
    var dev = Math.max(Math.abs(hi - base), Math.abs(base - lo));
    var pad = Math.max(dev * 1.15, o.minSpan !== undefined ? o.minSpan : Math.abs(base) * 0.06 || 1);
    min = base - pad; max = base + pad;
  } else {
    min = Math.min(0, lo);
    max = hi * 1.08 || 1;
  }
  var L = labelW, R = W - valW;
  var X = function (v) { return L + (R - L) * ((Number(v) || 0) - min) / ((max - min) || 1); };
  var s = '';
  var bx = X(base);
  items.forEach(function (r, i) {
    var y = padT + i * rowH, v = Number(r.value) || 0, x = X(v);
    var tint = r.tint || (o.goodHigh === false
      ? (v >= (o.badAt !== undefined ? o.badAt : Infinity) ? CC_RED : CC_BLUE)
      : (o.baseline !== undefined || o.signed
          ? (v >= base ? CC_GREEN : CC_RED)
          : CC_BLUE));
    var x0 = Math.min(bx, x), w = Math.max(1.5, Math.abs(x - bx));
    s += '<text x="' + (L - 8) + '" y="' + (y + rowH / 2 + 3.5) + '" text-anchor="end" font-size="11" fill="' + CC_INK + '">'
       +   esc(String(r.label).slice(0, 26))
       + '</text>'
       + (r.sub ? '<text x="' + (L - 8) + '" y="' + (y + rowH / 2 + 13) + '" text-anchor="end" font-size="8.5" fill="' + CC_MUTED + '">' + esc(r.sub) + '</text>' : '')
       + '<rect x="' + x0.toFixed(1) + '" y="' + (y + 4) + '" width="' + w.toFixed(1) + '" height="' + (rowH - 11)
       +   '" rx="2" fill="' + tint + '" fill-opacity="' + (r.faint ? .34 : .88) + '"/>'
       + '<text x="' + (R + 8) + '" y="' + (y + rowH / 2 + 3.5) + '" font-size="10.5" font-weight="700" fill="' + tint + '">'
       +   esc(o.fmt ? o.fmt(v) : (Math.round(v * 10) / 10) + (o.suffix || ''))
       + '</text>';
  });
  if (o.signed || o.baseline !== undefined) {
    s += '<line x1="' + bx.toFixed(1) + '" x2="' + bx.toFixed(1) + '" y1="' + (padT - 4) + '" y2="' + (H - padB + 6)
       + '" stroke="' + (o.signed ? '#9aa8c6' : CC_GOLD) + '" stroke-width="1.4" stroke-dasharray="4 3"/>'
       + '<text x="' + bx.toFixed(1) + '" y="' + (H - padB + 17) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="'
       + (o.signed ? CC_MUTED : CC_GOLD) + '">' + esc(o.baselineLabel || (o.signed ? '0' : String(base))) + '</text>';
  }
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" '
    + 'font-family="Segoe UI, system-ui, sans-serif" role="img" aria-label="' + esc(o.aria || 'ranked bars') + '">'
    + s + '</svg>';
}

/* ── Smooth multi-series line ────────────────────────────────────────────────
   Counts on the left axis, percentages on the right, so a volume series and a
   rate series can share one picture without either being rescaled into
   meaninglessness. A null value is a GAP, never a zero — an hour that has not
   happened must not draw a collapse. */
function ccSmoothLines(labels, series, opts) {
  var o = opts || {};
  var W = 760, H = o.height || 250, L = 46, R = 46, T = 16, B = 28, n = labels.length;
  if (!n) return '';
  var maxL = 0, maxR = 0;
  series.forEach(function (sr) {
    sr.values.forEach(function (v) {
      if (v === null || v === undefined) return;
      if (sr.axis === 'right') maxR = Math.max(maxR, Number(v) || 0);
      else maxL = Math.max(maxL, Number(v) || 0);
    });
  });
  maxL = (maxL || 1) * 1.15; maxR = Math.min(100, (maxR || 1) * 1.1);
  var X = function (i) { return L + (W - L - R) * (n > 1 ? i / (n - 1) : 0); };
  var YL = function (v) { return T + (H - T - B) * (1 - (Number(v) || 0) / maxL); };
  var YR = function (v) { return T + (H - T - B) * (1 - (Number(v) || 0) / maxR); };
  var curve = function (idx, PY) {
    var p = idx.map(function (i) { return [X(i), PY(i)]; });
    if (!p.length) return '';
    if (p.length < 3) return 'M' + p.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' L');
    var t = 0.18, d = 'M' + p[0][0].toFixed(1) + ',' + p[0][1].toFixed(1);
    for (var i = 0; i < p.length - 1; i++) {
      var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      d += ' C' + (p1[0] + (p2[0] - p0[0]) * t).toFixed(1) + ',' + (p1[1] + (p2[1] - p0[1]) * t).toFixed(1)
         + ' ' + (p2[0] - (p3[0] - p1[0]) * t).toFixed(1) + ',' + (p2[1] - (p3[1] - p1[1]) * t).toFixed(1)
         + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  };
  var s = '';
  [0, .5, 1].forEach(function (f) {
    var y = T + (H - T - B) * (1 - f);
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + CC_RULE + '"/>'
       + '<text x="' + (L - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="' + CC_MUTED + '">'
       + fmt(Math.round(maxL * f)) + '</text>'
       + '<text x="' + (W - R + 7) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9.5" fill="' + CC_MUTED + '">'
       + Math.round(maxR * f) + '%</text>';
  });
  series.forEach(function (sr) {
    var PY = sr.axis === 'right' ? YR : YL;
    // Split into runs of present values so a gap stays a gap.
    var runs = [], run = [];
    sr.values.forEach(function (v, i) {
      if (v === null || v === undefined) { if (run.length) runs.push(run); run = []; return; }
      run.push(i);
    });
    if (run.length) runs.push(run);
    runs.forEach(function (idx) {
      var d = curve(idx, function (i) { return PY(sr.values[i]); });
      if (sr.area && idx.length > 1) {
        s += '<path d="' + d + ' L' + X(idx[idx.length - 1]).toFixed(1) + ',' + PY(0).toFixed(1)
           + ' L' + X(idx[0]).toFixed(1) + ',' + PY(0).toFixed(1) + ' Z" fill="' + sr.area + '" stroke="none"/>';
      }
      s += '<path d="' + d + '" fill="none" stroke="' + sr.ink + '" stroke-width="' + (sr.width || 2.4)
         + '" stroke-linecap="round" stroke-linejoin="round"' + (sr.dash ? ' stroke-dasharray="' + sr.dash + '"' : '') + '/>';
      if (sr.dots !== false) idx.forEach(function (i) {
        s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + PY(sr.values[i]).toFixed(1) + '" r="2.6" fill="'
           + sr.ink + '" stroke="#fff" stroke-width="1.2"/>';
      });
    });
  });
  labels.forEach(function (lb, i) {
    s += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="9.5" fill="' + CC_MUTED + '">'
       + esc(String(lb)) + '</text>';
  });
  var leg = series.map(function (sr) {
    return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:' + CC_MUTED + '">'
      + '<i style="width:14px;height:0;border-top:2.5px ' + (sr.dash ? 'dashed' : 'solid') + ' ' + sr.ink + ';display:inline-block"></i>'
      + esc(sr.name) + (sr.axis === 'right' ? ' <u style="text-decoration:none;color:#aab3c8">right axis</u>' : '') + '</span>';
  }).join('');
  return '<div style="display:flex;gap:14px;flex-wrap:wrap;margin:0 0 4px">' + leg + '</div>'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" '
    + 'font-family="Segoe UI, system-ui, sans-serif" role="img" aria-label="' + esc(o.aria || 'trend') + '">' + s + '</svg>';
}

/* Card shell matching the existing .fb-box grammar, with the metric switch and
   the table button in the header where they are found without hunting. */
function ccCard(o) {
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>' + esc(o.title) + '</h4>'
    +   '<span class="fh-note" style="display:flex;align-items:center;gap:8px">'
    +     (o.note ? '<span>' + o.note + '</span>' : '')
    +     (o.table ? ccTableBtn(o.tableLabel, o.tableSrc, o.tableTitle) : '')
    +   '</span></div>'
    + (o.sub ? '<div class="fb-sub" style="margin:-4px 0 9px">' + o.sub + '</div>' : '')
    + (o.seg || '')
    + o.body
    + (o.foot ? '<div class="fb-hrnote">' + o.foot + '</div>' : '')
    + '</div>';
}
function ccSeg(attr, opts, active) {
  return '<div class="dist-lvl" style="margin-bottom:8px">' + opts.map(function (o) {
    return '<button ' + attr + '="' + esc(o[0]) + '" class="' + (active === o[0] ? 'on' : '') + '">' + esc(o[1]) + '</button>';
  }).join('') + '</div>';
}

Object.assign(window, {
  ccModal: ccModal, ccModalClose: ccModalClose, ccRankedBars: ccRankedBars,
  ccSmoothLines: ccSmoothLines, ccCard: ccCard, ccSeg: ccSeg,
  ccTableBtn: ccTableBtn, ccWireTables: ccWireTables,
  CC_BLUE: CC_BLUE, CC_GREEN: CC_GREEN, CC_RED: CC_RED, CC_GOLD: CC_GOLD, CC_MUTED: CC_MUTED
});
