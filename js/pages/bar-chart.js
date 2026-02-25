/* ================================================================
   bar-chart.js  –  Bar Chart Page
   Y-axis uses niceTick algorithm so grid lines, labels and bar
   heights are all computed from the SAME value→pixel formula:
       pixelY = midY - (value / range) * (ch / 2)
================================================================ */

window.BarChartPage = (() => {
    'use strict';

    const S = () => window.MEMSSerial.state;

    let canvas, ctx;
    let range = 1000;

    const BAR_COLORS = ['#00bcd4', '#e91e8c', '#f59e0b'];
    const BAR_LABELS = ['X', 'Y', 'Z'];

    /* ── Canvas resize ─────────────────────────────── */
    function resizeCanvas() {
        const wrap = canvas.parentElement;
        const dpr = devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        return { w, h };
    }

    /* ── Value → pixel (Y axis) ────────────────────
       midY is the 0-value pixel row.
       Positive values go UP  (subtract from midY).
       Negative values go DOWN (add to midY).
    ─────────────────────────────────────────────── */
    function valToY(v, midY, ch) {
        return midY - (v / range) * (ch / 2);
    }

    /* ── Nice tick generator ───────────────────────
       Returns an array of tick values given a full
       range [-range, +range] and a target tick count.
       Picks clean intervals: 1, 2, 5 × 10^n
    ─────────────────────────────────────────────── */
    function niceTicks(halfRange, targetCount = 8) {
        const span = halfRange * 2;
        const rawInterval = span / targetCount;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
        const norm = rawInterval / magnitude;

        let niceStep;
        if (norm < 1.5) niceStep = 1;
        else if (norm < 3.5) niceStep = 2;
        else if (norm < 7.5) niceStep = 5;
        else niceStep = 10;

        const step = niceStep * magnitude;
        const ticks = [];
        // Start from the lowest multiple of step that is >= -halfRange
        const start = Math.ceil(-halfRange / step) * step;
        for (let v = start; v <= halfRange + step * 0.001; v += step) {
            const rounded = Math.round(v / step) * step; // fix float drift
            if (rounded >= -halfRange && rounded <= halfRange) ticks.push(rounded);
        }
        return ticks;
    }

    /* ── Format Y label ───────────────────────────── */
    function fmtY(v) {
        const abs = Math.abs(v);
        if (abs >= 10000) return (v / 1000).toFixed(0) + 'k';
        if (abs >= 1000) return (v / 1000).toFixed(1) + 'k';
        return String(v);
    }

    /* ── Draw ──────────────────────────────────────── */
    function draw() {
        const { w, h } = resizeCanvas();
        const { x, y, z } = S().data;
        const vals = [x, y, z];

        ctx.clearRect(0, 0, w, h);

        const PL = 58, PR = 14, PT = 14, PB = 28;
        const cw = w - PL - PR;
        const ch = h - PT - PB;
        const midY = PT + ch / 2;

        // ── Clip to chart area ─────────────────────────
        ctx.save();
        ctx.beginPath();
        ctx.rect(PL, PT, cw, ch);
        ctx.clip();

        // ── Background ────────────────────────────────
        ctx.fillStyle = 'rgba(13,17,23,0.6)';
        ctx.fillRect(PL, PT, cw, ch);
        ctx.restore();

        // ── Compute ticks ──────────────────────────────
        const ticks = niceTicks(range, 8);

        // ── Horizontal grid lines (at tick values) ────
        ctx.setLineDash([3, 5]);
        ticks.forEach(v => {
            const py = valToY(v, midY, ch);
            if (py < PT || py > PT + ch) return;

            ctx.strokeStyle = v === 0
                ? 'rgba(255,255,255,.20)'   // zero line brighter
                : 'rgba(255,255,255,.06)';
            ctx.lineWidth = v === 0 ? 1.2 : 1;
            ctx.beginPath();
            ctx.moveTo(PL, py);
            ctx.lineTo(PL + cw, py);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // ── Y-axis labels (at tick values, same formula) ──
        ctx.font = '9.5px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ticks.forEach(v => {
            const py = valToY(v, midY, ch);
            if (py < PT - 4 || py > PT + ch + 4) return;
            ctx.fillStyle = v === 0
                ? 'rgba(200,200,200,.85)'
                : 'rgba(139,148,158,.70)';
            ctx.fillText(fmtY(v), PL - 5, py + 3.5);
        });

        // ── Left axis border ───────────────────────────
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PL, PT);
        ctx.lineTo(PL, PT + ch);
        ctx.stroke();

        // ── Bars ───────────────────────────────────────
        const groupW = cw / vals.length;
        const barW = Math.min(groupW * 0.44, 90);

        vals.forEach((val, i) => {
            const clamped = Math.max(-range, Math.min(range, val));

            // Pixel positions (same valToY formula)
            const zeroY = midY;                         // pixel of value 0
            const topY = valToY(clamped, midY, ch);    // pixel of actual value

            const barTop = Math.min(zeroY, topY);
            const barH = Math.abs(zeroY - topY);
            const bx = PL + groupW * i + (groupW - barW) / 2;

            if (barH < 0.5) {
                // Draw a 2-px tick at zero so zero-value is visible
                ctx.fillStyle = BAR_COLORS[i] + '55';
                ctx.fillRect(bx, zeroY - 1, barW, 2);
                ctx.fillStyle = 'rgba(139,148,158,.85)';
                ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(BAR_LABELS[i], bx + barW / 2, PT + ch + 20);
                return;
            }

            // Gradient (always top-to-bottom visually)
            const grad = ctx.createLinearGradient(bx, barTop, bx, barTop + barH);
            grad.addColorStop(0, BAR_COLORS[i] + 'ff');
            grad.addColorStop(1, BAR_COLORS[i] + '55');
            ctx.fillStyle = grad;

            const r = Math.min(5, barW / 5, barH / 2);
            ctx.beginPath();
            if (clamped >= 0) {
                // positive bar: rounded top, flat bottom (at zero line)
                ctx.roundRect(bx, barTop, barW, barH, [r, r, 0, 0]);
            } else {
                // negative bar: flat top (at zero line), rounded bottom
                ctx.roundRect(bx, barTop, barW, barH, [0, 0, r, r]);
            }
            ctx.fill();

            // Cap highlight
            ctx.fillStyle = BAR_COLORS[i] + '55';
            if (clamped >= 0) ctx.fillRect(bx + 2, barTop, barW - 4, 2);
            else ctx.fillRect(bx + 2, barTop + barH - 2, barW - 4, 2);

            // Axis label (X / Y / Z)
            ctx.fillStyle = 'rgba(139,148,158,.85)';
            ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(BAR_LABELS[i], bx + barW / 2, PT + ch + 20);
        });
    }

    /* ── rAF render loop ───────────────────────────── */
    let renderCount = 0, fpsTimer = 0, active = false;

    function loop(ts) {
        if (!active) return;
        requestAnimationFrame(loop);
        draw();

        const { x, y, z } = S().data;
        document.getElementById('bar-vn-x').textContent = x;
        document.getElementById('bar-vn-y').textContent = y;
        document.getElementById('bar-vn-z').textContent = z;

        renderCount++;
        if (ts - fpsTimer >= 1000) {
            const el = document.getElementById('bar-fps');
            const pr = document.getElementById('bar-parse-rate');
            if (el) el.textContent = renderCount;
            if (pr) pr.textContent = S().rawLineRate.toLocaleString();
            renderCount = 0; fpsTimer = ts;
        }
    }

    /* ── Init (called once) ────────────────────────── */
    function init() {
        canvas = document.getElementById('bar-canvas');
        ctx = canvas.getContext('2d');

        document.getElementById('bar-range-sel').addEventListener('change', e => {
            range = parseInt(e.target.value, 10);
        });

        new ResizeObserver(() => { }).observe(canvas.parentElement);
    }

    function start() { active = true; requestAnimationFrame(loop); }
    function stop() { active = false; }

    return { init, start, stop };
})();
