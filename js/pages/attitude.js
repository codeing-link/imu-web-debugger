/* ================================================================
   attitude.js  –  3D Attitude Visualization + Madgwick AHRS
   ================================================================
   Algorithm reference: Madgwick (2010, 2011)
   Fusion library:      github.com/xioTechnologies/Fusion

   Data flow:
     serial.js → onFrame(gx,gy,gz,ax,ay,az) [raw LSB]
       → scale by gyroSens / accSens
       → MadgwickAHRS.update(dt)
       → quaternion → rotation matrix
       → Canvas 2D perspective-projection of 3-D box
================================================================ */

window.AttitudePage = (() => {
    'use strict';

    const DEG = Math.PI / 180;
    const S = () => window.MEMSSerial.state;

    /* ══════════════════════════════════════════════════════
       Madgwick AHRS  (no magnetometer variant)
       Ported directly from:
         Madgwick S.O.H., "An efficient orientation filter
         for inertial and inertial/magnetic sensor arrays", 2010
    ══════════════════════════════════════════════════════ */
    class MadgwickAHRS {
        constructor() {
            this.q = [1, 0, 0, 0];  // quaternion [w, x, y, z]
            this.beta = 0.1;           // filter gain
        }

        reset() { this.q = [1, 0, 0, 0]; }

        /**
         * Init quaternion from gravity vector only (no gyro).
         * Immediately gives correct pitch & roll; yaw = 0.
         * @param {number} ax/ay/az  accelerometer in g (raw or scaled, sign matters)
         */
        initFromGravity(ax, ay, az) {
            const n = Math.sqrt(ax * ax + ay * ay + az * az);
            if (n < 1e-6) { this.reset(); return; }
            const gx = ax / n, gy = ay / n, gz = az / n;

            // Edge case: sensor completely upside-down (gz ≈ -1)
            if (gz < -0.9999) { this.q = [0, 1, 0, 0]; return; }

            // We want q such that R^T(q) * [0,0,1] = [gx,gy,gz]
            // i.e., R(q) rotates g → [0,0,1], rotation axis = cross(g,[0,0,1]) = [gy,-gx,0]
            // Half-angle: w = sqrt((1+gz)/2), [x,y,z] = (1/sqrt(2*(1+gz))) * [gy,-gx,0]
            const w = Math.sqrt((1 + gz) / 2);
            const f = 1 / (2 * w);           // = 1/sqrt(2*(1+gz))
            this.q = [w, gy * f, -gx * f, 0];  // 注意: x=+gy, y=-gx（修正符号）
        }

        /** Update with gyro (rad/s) + accel (g), dt in seconds */
        update(gx, gy, gz, ax, ay, az, dt) {
            const b = this.beta;
            let [q0, q1, q2, q3] = this.q;

            // Rate of change from gyroscope
            let qDot0 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
            let qDot1 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
            let qDot2 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
            let qDot3 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

            // Accelerometer correction (gradient-descent)
            const aN = Math.sqrt(ax * ax + ay * ay + az * az);
            if (aN > 0) {
                ax /= aN; ay /= aN; az /= aN;

                const _2q0 = 2 * q0, _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3;
                const _4q0 = 4 * q0, _4q1 = 4 * q1, _4q2 = 4 * q2;
                const _8q1 = 8 * q1, _8q2 = 8 * q2;
                const q0q0 = q0 * q0, q1q1 = q1 * q1, q2q2 = q2 * q2, q3q3 = q3 * q3;

                let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
                let s1 = _4q1 * q3q3 - _2q3 * ax + 4 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
                let s2 = 4 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
                let s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;

                const sN = Math.sqrt(s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3);
                if (sN > 0) {
                    s0 /= sN; s1 /= sN; s2 /= sN; s3 /= sN;
                    qDot0 -= b * s0; qDot1 -= b * s1; qDot2 -= b * s2; qDot3 -= b * s3;
                }
            }

            q0 += qDot0 * dt; q1 += qDot1 * dt; q2 += qDot2 * dt; q3 += qDot3 * dt;
            const qN = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
            this.q = [q0 / qN, q1 / qN, q2 / qN, q3 / qN];
        }

        /** Rotation matrix: sensor frame → world frame (3×3 array) */
        getRot() {
            const [w, x, y, z] = this.q;
            return [
                [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
            ];
        }

        /** Euler angles in degrees (ZYX convention: yaw-pitch-roll) */
        getEuler() {
            const [w, x, y, z] = this.q;
            const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) / DEG;
            const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) / DEG;
            const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) / DEG;
            return { roll, pitch, yaw };
        }
    }

    /* ══════════════════════════════════════════════════════
       Module state
    ══════════════════════════════════════════════════════ */
    let canvas, ctx, active = false;
    const ahrs = new MadgwickAHRS();
    let lastTs = null;      // for dt computation
    let demoT = 0;         // demo animation phase

    // Sensor sensitivity (default: MPU-6050 ±2000dps / ±2g)
    let gyroSens = 1 / 16.4 * DEG;   // LSB → rad/s
    let accSens = 1 / 16384;        // LSB → g

    // 最近一帧加速度计原始値（用于重置时立即副履姿态）
    let lastAcc = { ax: 0, ay: 0, az: 1 };  // 默认水平

    // ── Zero-offset reference quaternion (按下校准时快照) ──
    let qRef = [1, 0, 0, 0];  // identity = 无偏移

    /* ── Quaternion helpers ────────────────────────── */
    // 共轪（单位四元数的逆）
    function quatConj([w, x, y, z]) { return [w, -x, -y, -z]; }

    // 四元数乘法 p × q
    function quatMul([w1, x1, y1, z1], [w2, x2, y2, z2]) {
        return [
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        ];
    }

    // 四元数 → 3×3 旋转矩阵
    function quatToRot([w, x, y, z]) {
        return [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
        ];
    }

    // 四元数 → 欧拉角 (度)
    function quatGetEuler([w, x, y, z]) {
        const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) / DEG;
        const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) / DEG;
        const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) / DEG;
        return { roll, pitch, yaw };
    }

    // 获取相对四元数 conj(qRef) × q_current
    function getRelQuat() { return quatMul(quatConj(qRef), ahrs.q); }

    /* ══════════════════════════════════════════════════════
       3-D box geometry
       W × H × D = 1.5 × 0.9 × 0.12  (PCB-like proportions)
       Vertex layout:
         0-3 = back face (−Z), 4-7 = front face (+Z)
    ══════════════════════════════════════════════════════ */
    const W = 1.5, H = 0.9, D = 0.12;
    const VERTS = [
        [-W, -H, -D], [W, -H, -D], [W, H, -D], [-W, H, -D],
        [-W, -H, D], [W, -H, D], [W, H, D], [-W, H, D],
    ];
    // Faces: vi=vertex indices, n=local normal, color=rgb base (PCB green palette)
    const FACES = [
        { vi: [7, 6, 5, 4], n: [0, 0, 1], rgb: [28, 110, 55], top: true },  // +Z  (component side)
        { vi: [0, 1, 2, 3], n: [0, 0, -1], rgb: [12, 55, 28], top: false },  // -Z  (solder side)
        { vi: [5, 1, 2, 6], n: [1, 0, 0], rgb: [20, 80, 40], top: false },  // +X
        { vi: [4, 0, 3, 7], n: [-1, 0, 0], rgb: [20, 80, 40], top: false },  // -X
        { vi: [6, 2, 3, 7], n: [0, 1, 0], rgb: [22, 90, 45], top: false },  // +Y
        { vi: [4, 5, 1, 0], n: [0, -1, 0], rgb: [22, 90, 45], top: false },  // -Y
    ];

    /* ══════════════════════════════════════════════════════
       Camera & projection
    ══════════════════════════════════════════════════════ */
    const CAM_YAW = 28 * DEG;
    const CAM_PITCH = -22 * DEG;
    const FOV = 4.5;           // perspective distance

    // Precompute camera rotation matrix (fixed)
    function buildCamMat() {
        const cy = Math.cos(CAM_YAW), sy = Math.sin(CAM_YAW);
        const cp = Math.cos(CAM_PITCH), sp = Math.sin(CAM_PITCH);
        const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
        const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
        return mulMM(Rx, Ry);
    }
    const CAM = buildCamMat();

    /* ── Matrix / vector helpers ─────────────────────── */
    function mulMM(A, B) {
        const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i][j] += A[i][k] * B[k][j];
        return R;
    }
    function mulMV(R, v) {
        return [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
        R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
        R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
    }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

    // Perspective projection (view space → screen)
    function project(v, cx, cy, scale) {
        const w = FOV / Math.max(0.5, FOV + v[2]);
        return [cx + v[0] * w * scale, cy - v[1] * w * scale];
    }

    /* ── Lighting: single directional light in world space ─ */
    const LIGHT = (() => {
        const L = [0.5, 0.9, 0.7];
        const n = Math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2]);
        return [L[0] / n, L[1] / n, L[2] / n];
    })();

    function shadeColor(baseRGB, worldNormal) {
        const diff = Math.max(0, dot(worldNormal, LIGHT));
        const k = 0.25 + 0.75 * diff;
        return `rgb(${Math.round(baseRGB[0] * k)},${Math.round(baseRGB[1] * k)},${Math.round(baseRGB[2] * k)})`;
    }

    /* ── Canvas resize ───────────────────────────────── */
    function resizeCanvas() {
        const wrap = canvas.parentElement;
        const dpr = devicePixelRatio || 1;
        const w = wrap.clientWidth, h = wrap.clientHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        return { w, h };
    }

    /* ── Draw a world-space axis arrow ───────────────── */
    function drawArrow(origin3, dir3, totalR, cx, cy, scale, color, label) {
        const tip3 = [origin3[0] + dir3[0] * 0.6, origin3[1] + dir3[1] * 0.6, origin3[2] + dir3[2] * 0.6];
        const po = project(mulMV(totalR, origin3), cx, cy, scale);
        const pt = project(mulMV(totalR, tip3), cx, cy, scale);
        const dx = pt[0] - po[0], dy = pt[1] - po[1], ln = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / ln, uy = dy / ln, hs = 9;
        ctx.beginPath(); ctx.moveTo(po[0], po[1]); ctx.lineTo(pt[0], pt[1]);
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1]);
        ctx.lineTo(pt[0] - ux * hs + uy * hs * 0.4, pt[1] - uy * hs - ux * hs * 0.4);
        ctx.lineTo(pt[0] - ux * hs - uy * hs * 0.4, pt[1] - uy * hs + ux * hs * 0.4);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
        ctx.font = 'bold 11px Inter,sans-serif';
        ctx.fillStyle = color; ctx.textAlign = 'center';
        ctx.fillText(label, pt[0] + ux * 10, pt[1] + uy * 10 + 4);
    }

    /* ── Draw chip decoration on top face ────────────── */
    function drawTopDecoration(topVerts2d) {
        // Compute face center and basis vectors from projected vertices
        const cx4 = topVerts2d.reduce((s, p) => s + p[0], 0) / 4;
        const cy4 = topVerts2d.reduce((s, p) => s + p[1], 0) / 4;

        // Chip square (inner)
        const s = 0.35;
        const corners = [
            [0 - s, 0 - s], [0 + s, 0 - s], [0 + s, 0 + s], [0 - s, 0 + s]
        ];

        // Map corners to screen using bilinear from face verts
        // Simple: use face center ± offset in face-space axes
        const ex = [(topVerts2d[1][0] - topVerts2d[0][0]) * 0.2, (topVerts2d[1][1] - topVerts2d[0][1]) * 0.2];
        const ey = [(topVerts2d[3][0] - topVerts2d[0][0]) * 0.2, (topVerts2d[3][1] - topVerts2d[0][1]) * 0.2];

        const pts = corners.map(([u, v]) => [cx4 + u * ex[0] + v * ey[0], cy4 + u * ex[1] + v * ey[1]]);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(8,20,12,0.9)';
        ctx.strokeStyle = 'rgba(100,200,130,0.5)';
        ctx.lineWidth = 1;
        ctx.fill(); ctx.stroke();

        // Chip label
        ctx.fillStyle = 'rgba(120,220,150,0.7)';
        ctx.font = 'bold 7px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('IMU', cx4, cy4 + 3);

        // Dot marker (pin 1)
        const dot = pts[0];
        ctx.beginPath();
        ctx.arc(dot[0] + 2, dot[1] + 2, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100,220,140,0.8)'; ctx.fill();
    }

    /* ══════════════════════════════════════════════════════
       Main draw
    ══════════════════════════════════════════════════════ */
    function draw() {
        const { w, h } = resizeCanvas();
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, w, h);

        // Subtle grid
        ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

        const cx = w / 2, cy = h / 2 + 10;
        const scale = Math.min(w, h) * 0.21;

        // ── 计算相对姿态： conj(qRef) × q_current ────────────
        const qRel = getRelQuat();
        const sensorR = quatToRot(qRel);   // 相对旋转矩阵
        const totalR = mulMM(CAM, sensorR);

        // ── Transform vertices into view space ───────────────
        const tv = VERTS.map(v => mulMV(totalR, v));
        const pv = tv.map(v => project(v, cx, cy, scale));

        // ── Compute face info ─────────────────────────────────
        const faceData = FACES.map(f => {
            const worldN = mulMV(sensorR, f.n);   // normal in world frame
            const viewN = mulMV(CAM, worldN);    // normal in view frame
            const avgZ = f.vi.reduce((s, i) => s + tv[i][2], 0) / 4;
            return { ...f, worldN, viewN, avgZ };
        });

        // Back-face cull (viewN.z < 0 = facing cam) + depth sort
        const visible = faceData.filter(f => f.viewN[2] < 0).sort((a, b) => b.avgZ - a.avgZ);

        // ── Ground shadow ellipse for depth cue ───────────────
        const shadowY = cy + H * scale * 0.55;
        const grd = ctx.createRadialGradient(cx, shadowY, 5, cx, shadowY, scale * 0.8);
        grd.addColorStop(0, 'rgba(0,200,80,0.06)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.ellipse(cx, shadowY, scale * 0.8, scale * 0.15, 0, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();

        // ── Draw faces ────────────────────────────────────────
        let topFaceVerts2d = null;
        visible.forEach(f => {
            const pts = f.vi.map(i => pv[i]);
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fillStyle = shadeColor(f.rgb, f.worldN);
            ctx.fill();
            ctx.strokeStyle = 'rgba(100,220,130,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
            if (f.top) topFaceVerts2d = pts;
        });

        // ── Top face chip decoration ──────────────────────────
        if (topFaceVerts2d) drawTopDecoration(topFaceVerts2d);

        // ── Axis arrows (world-frame X/Y/Z from box center) ───
        const O = [0, 0, 0];
        drawArrow(O, [1, 0, 0], totalR, cx, cy, scale, '#ef4444', 'X');
        drawArrow(O, [0, 1, 0], totalR, cx, cy, scale, '#22c55e', 'Y');
        drawArrow(O, [0, 0, 1], totalR, cx, cy, scale, '#3b82f6', 'Z');

        // ── Corner label "Sensor Frame" ───────────────────────
        ctx.fillStyle = 'rgba(139,148,158,0.4)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Madgwick AHRS  |  acc+gyro fusion', 12, h - 10);
    }

    /* ══════════════════════════════════════════════════════
       rAF render loop
    ══════════════════════════════════════════════════════ */
    let renderCount = 0, fpsTimer = 0;

    function loop(ts) {
        if (!active) return;
        requestAnimationFrame(loop);

        // Demo mode: animate box with sine-wave rotation if not connected
        if (S().demo || !S().connected) {
            demoT += 0.008;
            const gx = Math.sin(demoT * 0.7) * 0.5;
            const gy = Math.cos(demoT * 0.5) * 0.3;
            const gz = Math.sin(demoT * 0.3) * 0.2;
            const ax = Math.sin(demoT * 0.4) * 0.3;
            const ay = Math.cos(demoT * 0.6) * 0.2;
            const az = Math.sqrt(Math.max(0, 1 - (ax * ax + ay * ay)));
            ahrs.update(gx, gy, gz, ax, ay, az, 1 / 60);
        }

        draw();

        // Update Euler display (使用相对姿态)
        const qRel = getRelQuat();
        const { roll, pitch, yaw } = quatGetEuler(qRel);
        const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setEl('at-val-roll', roll.toFixed(1) + '°');
        setEl('at-val-pitch', pitch.toFixed(1) + '°');
        setEl('at-val-yaw', yaw.toFixed(1) + '°');

        // 四元数显示（显示相对四元数）
        const [qw, qx, qy, qz] = qRel;
        setEl('at-q-w', qw.toFixed(4)); setEl('at-q-x', qx.toFixed(4));
        setEl('at-q-y', qy.toFixed(4)); setEl('at-q-z', qz.toFixed(4));

        // FPS
        renderCount++;
        if (ts - fpsTimer >= 1000) {
            setEl('at-fps', renderCount);
            renderCount = 0; fpsTimer = ts;
        }
    }

    /* ══════════════════════════════════════════════════════
       Serial frame callback
    ══════════════════════════════════════════════════════ */
    function onSerialFrame(gx_lsb, gy_lsb, gz_lsb, ax_lsb, ay_lsb, az_lsb) {
        const now = performance.now();
        let dt = lastTs ? (now - lastTs) / 1000 : 0.01;
        dt = Math.max(0.001, Math.min(0.5, dt));
        lastTs = now;
        // 记录最新加速度计套层推算时用
        lastAcc.ax = ax_lsb; lastAcc.ay = ay_lsb; lastAcc.az = az_lsb;
        ahrs.update(
            gx_lsb * gyroSens, gy_lsb * gyroSens, gz_lsb * gyroSens,
            ax_lsb * accSens, ay_lsb * accSens, az_lsb * accSens,
            dt
        );
    }

    /* ══════════════════════════════════════════════════════
       Init
    ══════════════════════════════════════════════════════ */
    function init() {
        canvas = document.getElementById('at-canvas');
        ctx = canvas.getContext('2d');

        // Gyro sensitivity selector
        document.getElementById('at-gyro-sel').addEventListener('change', e => {
            const dps = parseFloat(e.target.value);
            // LSB sensitivity (LSB/°/s) for 16-bit output = 32768 / dps
            gyroSens = (dps / 32768) * DEG;
        });

        // Acc sensitivity selector
        document.getElementById('at-acc-sel').addEventListener('change', e => {
            const g = parseFloat(e.target.value);
            accSens = g / 32768;
        });

        // Beta slider
        const betaInput = document.getElementById('at-beta-input');
        const betaLabel = document.getElementById('at-beta-label');
        betaInput.addEventListener('input', () => {
            ahrs.beta = parseFloat(betaInput.value);
            betaLabel.textContent = ahrs.beta.toFixed(3);
        });

        // Reset button — 从当前重力方向推算初始姿态
        document.getElementById('at-btn-reset').addEventListener('click', () => {
            // 利用最近一帧加速度计数据设定初始四元数
            ahrs.initFromGravity(
                lastAcc.ax * accSens,
                lastAcc.ay * accSens,
                lastAcc.az * accSens
            );
            qRef = [1, 0, 0, 0];  // 以此姿态为新零点
            lastTs = null;
            demoT = 0;
            window.MEMSSerial.queueLog('🔄 姿态已重置（已从当前加速度计估计初始姿态）');
        });

        // ▶ NEW: 校准零点按鈕 — 记录当前四元数为参考
        document.getElementById('at-btn-calib').addEventListener('click', () => {
            qRef = [...ahrs.q];  // 快照当前姿态
            window.MEMSSerial.queueLog('✅ 零点已校准 — 当前姿态设为基准');
        });

        new ResizeObserver(() => { }).observe(canvas.parentElement);
    }

    function start() {
        active = true;
        S().onFrame = onSerialFrame;
        requestAnimationFrame(loop);
    }

    function stop() {
        active = false;
        if (S().onFrame === onSerialFrame) S().onFrame = null;
    }

    return { init, start, stop };
})();
