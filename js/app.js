/* ================================================================
   app.js  –  Navigation / Page Router / Shared UI
================================================================ */

window.MEMSApp = (() => {
    'use strict';

    const SER = () => window.MEMSSerial;
    const S = () => window.MEMSSerial.state;

    /* ── Pages registry ────────────────────────────── */
    const pages = {
        'bar-chart': { module: () => window.BarChartPage, navId: 'nav-bar-chart' },
        'line-chart': { module: () => window.LineChartPage, navId: 'nav-line-chart' },
        'gyro-chart': { module: () => window.GyroChartPage, navId: 'nav-gyro-chart' },
    };

    let currentPage = null;

    function navigateTo(pageId) {
        if (currentPage === pageId) return;

        // Stop old page rAF
        if (currentPage && pages[currentPage]) {
            const oldMod = pages[currentPage].module();
            if (oldMod && oldMod.stop) oldMod.stop();
        }

        // Hide all pages, show target
        document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
        const pageEl = document.getElementById('page-' + pageId);
        if (pageEl) pageEl.classList.add('active');

        // Update sidebar active state
        document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
        const navEl = document.getElementById(pages[pageId]?.navId);
        if (navEl) navEl.classList.add('active');

        // Start new page rAF
        const newMod = pages[pageId]?.module();
        if (newMod && newMod.start) newMod.start();

        currentPage = pageId;
    }

    /* ── Connection change (called by serial.js) ──── */
    function onConnectionChange(connected, portInfo) {
        const dot = document.getElementById('conn-dot');
        const txt = document.getElementById('conn-text');
        const btnC = document.getElementById('btn-connect');
        const btnD = document.getElementById('btn-disc');
        const badge = document.getElementById('sb-port-badge');
        const name = document.getElementById('sb-port-name');

        if (dot) dot.className = 'dot' + (connected ? ' connected' : '');
        if (txt) txt.textContent = connected ? '已连接' : '未连接';
        if (btnC) btnC.style.display = connected ? 'none' : '';
        if (btnD) btnD.style.display = connected ? '' : 'none';

        if (badge && name) {
            if (connected && portInfo) {
                badge.classList.add('show');
                name.textContent = portInfo.name + (portInfo.brand ? ` (${portInfo.brand})` : '');
            } else {
                badge.classList.remove('show');
                name.textContent = '—';
            }
        }

        // Update frames / errors in status bar
        updateStats();
    }

    /* ── Stats ticker (status bar) ─────────────────── */
    function updateStats() {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('sb-frames', S().totalFrames.toLocaleString());
        set('sb-errors', S().errorFrames.toLocaleString());
    }
    setInterval(updateStats, 800);

    /* ── Init shared controls ──────────────────────── */
    function initControls() {
        const HAS_SERIAL = 'serial' in navigator;

        // Show overlay if no Web Serial
        if (!HAS_SERIAL) document.getElementById('overlay')?.classList.add('show');

        // Connect button
        document.getElementById('btn-connect')?.addEventListener('click', () => {
            if (!HAS_SERIAL) { SER().startDemo(); return; }
            const baud = parseInt(document.getElementById('baud-sel').value, 10);
            SER().connectPicker(baud);
        });

        // Disconnect button
        document.getElementById('btn-disc')?.addEventListener('click', () => {
            if (S().demo) { SER().stopDemo(); return; }
            SER().disconnect();
        });

        // Scan button
        document.getElementById('btn-scan')?.addEventListener('click', () => {
            if (!HAS_SERIAL) { SER().startDemo(); return; }
            SER().scan();
        });

        // Log panel
        document.getElementById('btn-log')?.addEventListener('click', () => {
            document.getElementById('log-panel')?.classList.toggle('open');
        });
        document.getElementById('btn-log-close')?.addEventListener('click', () => {
            document.getElementById('log-panel')?.classList.remove('open');
        });

        // Footer tabs (cosmetic only)
        document.querySelectorAll('.ftab').forEach(t => {
            t.addEventListener('click', () => {
                document.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
            });
        });

        // Nav items
        document.getElementById('nav-bar-chart')?.addEventListener('click', () => navigateTo('bar-chart'));
        document.getElementById('nav-line-chart')?.addEventListener('click', () => navigateTo('line-chart'));
        document.getElementById('nav-gyro-chart')?.addEventListener('click', () => navigateTo('gyro-chart'));
    }

    /* ── Bootstrap ─────────────────────────────────── */
    window.addEventListener('DOMContentLoaded', () => {
        initControls();

        // Init page modules
        window.BarChartPage?.init();
        window.LineChartPage?.init();
        window.GyroChartPage?.init();

        // Default page
        navigateTo('bar-chart');
    });

    return { onConnectionChange, navigateTo };
})();
