/* ================================================================
   gyro-chart.js  –  Gyroscope Time-Series Line Chart Page
   ================================================================
   Displays gyro_x / gyro_y / gyro_z from state.gyroHistory.
   Layout mirrors line-chart.js. rAF loop only when page is active.

   Colors:
     GX  #00bcd4  (cyan)
     GY  #e91e8c  (pink)
     GZ  #f59e0b  (amber)
================================================================ */

window.GyroChartPage = (() => {
    'use strict';

    const S = () => window.MEMSSerial.state;

    let canvas, ctx;
    let range = 32768;   // Y-axis half-range — default wide (raw LSB)
    let windowMs = 30000;   // Time window in ms (30 s default)
    let paused = false;
    let active = false;

    // Freeze snapshot (when paused)
    let frozenHistory = null;

    /* ── niceTicks ─────────────────────────────────────── */
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
        const start = Math.ceil(-halfRange / step) * step;
        for (let v = start; v <= halfRange + step * 0.001; v += step) {
            const r = Math.round(v / step) * step;
            if (r >= -halfRange && r <= halfRange) ticks.push(r);
        }
        return ticks;
    }

    /* ── value → pixel Y ──────────────────────────────── */
    function valToY(v, midY, ch) {
        return midY - (v / range) * (ch / 2);
    }

    /* ── Format Y label ───────────────────────────────── */
    function fmtY(v) {
        const abs = Math.abs(v);
        if (abs >= 1e7) return (v / 1e6).toFixed(0) + 'M';
        if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (abs >= 10000) return (v / 1000).toFixed(0) + 'k';
        if (abs >= 1000) return (v / 1000).toFixed(1) + 'k';
        return String(v);
    }

    /* ── Format ms → MM:SS ────────────────────────────── */
    function fmtTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const s = totalSec % 60;
        const m = Math.floor(totalSec / 60) % 60;
        const hh = Math.floor(totalSec / 3600);
        const pad = n => String(n).padStart(2, '0');
        return hh > 0 ? `${pad(hh)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    const COLORS = { gx: '#00bcd4', gy: '#e91e8c', gz: '#f59e0b' };

    /* ── Canvas resize ─────────────────────────────────── */
    function resizeCanvas() {
        const wrap = canvas.parentElement;
        const dpr = devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        return { w, h };
    }

    /* ── Draw one polyline ─────────────────────────────── */
    function drawLine(points, colorHex, tMin, tMax, PL, PT, cw, ch) {
        if (points.length < 2) return;
        const tRange = tMax - tMin;
        const midY = PT + ch / 2;

        ctx.beginPath();
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);

        let started = false;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const px = PL + ((p.t - tMin) / tRange) * cw;
            const clamped = Math.max(-range, Math.min(range, p.v));
            const py = valToY(clamped, midY, ch);
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    /* ── Main draw ─────────────────────────────────────── */
    function draw() {
        const { w, h } = resizeCanvas();
        ctx.clearRect(0, 0, w, h);

        const PL = 62, PR = 64, PT = 18, PB = 34;
        const cw = w - PL - PR;
        const ch = h - PT - PB;
        const midY = PT + ch / 2;

        // ── Background ─────────────────────────────────────
        ctx.fillStyle = 'rgba(13,17,23,1)';
        ctx.fillRect(PL, PT, cw, ch);

        // ── Horizontal grid + Y labels ──────────────────────
        const ticks = niceTicks(range, 8);
        ctx.font = '9.5px JetBrains Mono, monospace';
        ctx.setLineDash([3, 5]);
        ticks.forEach(v => {
            const py = valToY(v, midY, ch);
            if (py < PT - 2 || py > PT + ch + 2) return;

            ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,.20)' : 'rgba(255,255,255,.05)';
            ctx.lineWidth = v === 0 ? 1.2 : 1;
            ctx.beginPath(); ctx.moveTo(PL, py); ctx.lineTo(PL + cw, py); ctx.stroke();

            ctx.fillStyle = v === 0 ? 'rgba(200,200,200,.85)' : 'rgba(139,148,158,.65)';
            ctx.textAlign = 'right';
            ctx.fillText(fmtY(v), PL - 5, py + 3.5);

            ctx.textAlign = 'left';
            ctx.fillText(fmtY(v), PL + cw + 5, py + 3.5);
        });
        ctx.setLineDash([]);

        // ── Y-axis label (rotated "Gyroscope") ─────────────
        ctx.save();
        ctx.translate(10, PT + ch / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(139,148,158,.55)';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Gyroscope', 0, 0);
        ctx.restore();

        // ── Border ─────────────────────────────────────────
        ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
        ctx.strokeRect(PL, PT, cw, ch);

        // ── Determine history ───────────────────────────────
        const hist = paused && frozenHistory ? frozenHistory : S().gyroHistory;

        let tMax, tMin;
        if (hist.length === 0) {
            tMax = performance.now();
            tMin = tMax - windowMs;
        } else {
            tMax = hist[hist.length - 1].t;
            tMin = tMax - windowMs;
        }

        // ── Filter visible ──────────────────────────────────
        const visible = hist.filter(p => p.t >= tMin);

        // ── Time axis (X) ───────────────────────────────────
        const tickCount = Math.min(Math.floor(cw / 80), 10);
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        ctx.fillStyle = 'rgba(139,148,158,.6)';
        ctx.font = '9.5px JetBrains Mono, monospace'; ctx.textAlign = 'center';
        for (let i = 0; i <= tickCount; i++) {
            const frac = i / tickCount;
            const tx = PL + frac * cw;
            const tVal = tMin + frac * windowMs;
            ctx.beginPath(); ctx.moveTo(tx, PT); ctx.lineTo(tx, PT + ch); ctx.stroke();
            const relMs = tVal - (hist.length > 0 ? hist[0].t : tMin);
            ctx.fillText(fmtTime(Math.max(0, relMs)), tx, PT + ch + 16);
        }
        ctx.setLineDash([]);

        // ── Elapsed label ───────────────────────────────────
        if (hist.length > 0) {
            const elapsed = hist[hist.length - 1].t - hist[0].t;
            ctx.fillStyle = 'rgba(139,148,158,.5)';
            ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
            ctx.fillText(fmtTime(elapsed), PL + cw + PR - 2, PT + ch + 16);
        }

        // ── Draw 3 gyro lines ────────────────────────────────
        if (visible.length >= 2) {
            ['gx', 'gy', 'gz'].forEach(axis => {
                const pts = visible.map(p => ({ t: p.t, v: p[axis] }));
                drawLine(pts, COLORS[axis], tMin, tMax, PL, PT, cw, ch);
            });
        }

        // ── Right-edge cursor ───────────────────────────────
        if (visible.length > 0 && !paused) {
            ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(PL + cw, PT); ctx.lineTo(PL + cw, PT + ch); ctx.stroke();
            ctx.setLineDash([]);
        }

        // ── Paused overlay ──────────────────────────────────
        if (paused) {
            ctx.fillStyle = 'rgba(251,191,36,.08)';
            ctx.fillRect(PL, PT, cw, ch);
            ctx.fillStyle = 'rgba(251,191,36,.5)';
            ctx.font = '13px Inter, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('⏸ 已暂停', PL + cw / 2, PT + 28);
        }
    }

    /* ── rAF loop ──────────────────────────────────────── */
    let renderCount = 0, fpsTimer = 0;

    function loop(ts) {
        if (!active) return;
        requestAnimationFrame(loop);
        draw();

        // Legend values
        const { gx, gy, gz } = S().gyro;
        const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setEl('gc-val-gx', gx);
        setEl('gc-val-gy', gy);
        setEl('gc-val-gz', gz);

        // Elapsed
        const hist = S().gyroHistory;
        if (hist.length > 1) {
            const elapsedS = (hist[hist.length - 1].t - hist[0].t) / 1000;
            setEl('gc-val-t', elapsedS.toFixed(3));
        }

        // FPS
        renderCount++;
        if (ts - fpsTimer >= 1000) {
            setEl('gc-fps', renderCount);
            setEl('gc-parse-rate', S().rawLineRate.toLocaleString());
            renderCount = 0; fpsTimer = ts;
        }
    }

    /* ── Init ──────────────────────────────────────────── */
    function init() {
        canvas = document.getElementById('gc-canvas');
        ctx = canvas.getContext('2d');

        // Y range selector
        document.getElementById('gc-range-sel').addEventListener('change', e => {
            range = parseInt(e.target.value, 10);
        });

        // Time window selector
        document.getElementById('gc-window-sel').addEventListener('change', e => {
            windowMs = parseInt(e.target.value, 10);
        });

        // Clear
        document.getElementById('gc-btn-clear').addEventListener('click', () => {
            S().gyroHistory.length = 0;
        });

        // Pause / Resume
        const pauseBtn = document.getElementById('gc-btn-pause');
        pauseBtn.addEventListener('click', () => {
            paused = !paused;
            if (paused) {
                frozenHistory = [...S().gyroHistory];
                pauseBtn.textContent = '▶ 继续';
                pauseBtn.classList.add('paused');
            } else {
                frozenHistory = null;
                pauseBtn.textContent = '⏸ 暂停';
                pauseBtn.classList.remove('paused');
            }
        });

        new ResizeObserver(() => { }).observe(canvas.parentElement);
    }

    function start() { active = true; paused = false; requestAnimationFrame(loop); }
    function stop() { active = false; }

    return { init, start, stop };
})();
