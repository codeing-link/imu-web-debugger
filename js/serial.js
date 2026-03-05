/* ================================================================
   serial.js  –  Web Serial API + Shared State + History Buffer
   ================================================================
   Exposes global: window.MEMSSerial

   Data format (6-axis):
     printf("%6d, %6d, %6d , %6d, %6d, %6d\r\n",
            gyro_x, gyro_y, gyro_z, acc_x, acc_y, acc_z)
   Example:  "   120,   -30,    15 ,   103,   -78,   980\r\n"

   state.gyro  = { gx, gy, gz }  — 陀螺仪原始数据（留给新页面）
   state.data  = { x, y, z }     — 加速度计数据（acc_x/y/z），供现有图表使用
================================================================ */

window.MEMSSerial = (() => {
  'use strict';

  /* ── USB VID/PID → friendly name map ──────────── */
  const VID_MAP = {
    0x1A86: { brand: 'WCH (沁恒)', chips: { 0x7523: 'CH340', 0x5523: 'CH341', 0x7522: 'CH340K', 0x55D4: 'CH9102' } },
    0x10C4: { brand: 'Silicon Labs', chips: { 0xEA60: 'CP2102', 0xEA63: 'CP2105', 0xEA70: 'CP2106', 0xEA71: 'CP2108' } },
    0x0403: { brand: 'FTDI', chips: { 0x6001: 'FT232R', 0x6010: 'FT2232', 0x6011: 'FT4232', 0x6014: 'FT232H', 0x6015: 'FT-X' } },
    0x067B: { brand: 'Prolific', chips: { 0x2303: 'PL2303', 0x23A3: 'PL2303HXD' } },
    0x2341: { brand: 'Arduino', chips: { 0x0001: 'Uno(8U2)', 0x0010: 'Mega2560', 0x8036: 'Leonardo', 0x0042: 'Mega2560R3' } },
    0x0D28: { brand: 'ARM/mbed', chips: { 0x0204: 'DAPLink' } },
  };

  function getDeviceInfo(vid, pid) {
    if (!vid) return { name: '串口设备', brand: '—', chip: '—' };
    const e = VID_MAP[vid];
    if (!e) return { name: `USB Serial`, brand: `VID:${h(vid)}`, chip: `PID:${h(pid ?? 0)}` };
    const chip = e.chips[pid] || `PID:${h(pid ?? 0)}`;
    return { name: chip, brand: e.brand, chip };
  }

  function h(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }

  /* ── Shared State ──────────────────────────────── */
  const MAX_HISTORY = 36000; // ~6min @ 100Hz

  const state = {
    data: { x: 0, y: 0, z: 0 },         // 加速度计 (acc_x/y/z) — 供现有图表
    gyro: { gx: 0, gy: 0, gz: 0 },      // 陀螺仪   (gyro_x/y/z) — 留给新页面
    connected: false,
    demo: false,
    port: null,
    reader: null,
    totalFrames: 0,
    errorFrames: 0,
    rawLineRate: 0,
    _linesBucket: 0,
    knownPorts: [],
    currentPortInfo: null,

    // ── Acc history ring buffer (for acc line chart) ──
    // Each entry: { t: DOMHighResTimeStamp (ms), x, y, z }
    history: [],
    pushHistory(x, y, z) {
      this.history.push({ t: performance.now(), x, y, z });
      if (this.history.length > MAX_HISTORY) this.history.shift();
    },

    // ── Gyro history ring buffer (for gyro chart page) ──
    // Each entry: { t: DOMHighResTimeStamp (ms), gx, gy, gz }
    gyroHistory: [],
    pushGyroHistory(gx, gy, gz) {
      this.gyroHistory.push({ t: performance.now(), gx, gy, gz });
      if (this.gyroHistory.length > MAX_HISTORY) this.gyroHistory.shift();
    },

    // ── Event callbacks (set by pages) ──
    onData: null,   // called after each successful parse: onData(ax, ay, az)
    onFrame: null,   // called on each 6-axis frame: onFrame(gx, gy, gz, ax, ay, az)
  };

  /* ── 数据清洗与滤波流水线 (Sensor Data Pipeline) ── */
  class SensorFilter {
    constructor() {
      this.lastRaw = 0;       // 用于 Spike 检测
      this.lastOut = 0;       // 用于低通滤波
      this.initialized = false;

      // 滤波参数
      this.maxDelta = 25000;  // 尖峰阈值：极短时间内跳变 >25000（如瞬间跳变到极值 -32768）视为底层通信误码
      this.clampMax = 32767;  // 限幅上限 (16位有符号整数最大值)
      this.clampMin = -32768; // 限幅下限
      this.alpha = 0.85;      // 一阶低通系数 (0~1)：0.85 表示 85% 当前新数据 + 15% 历史平滑，极轻度滤波保留动态响应
    }

    process(raw) {
      // 1. 异常尖峰值剔除 (Spike Filter)
      if (this.initialized) {
        if (Math.abs(raw - this.lastRaw) > this.maxDelta) {
          raw = this.lastRaw; // 出现离谱跳变，抛弃本次坏点，沿用上一帧正常值
        }
      }
      this.lastRaw = raw;

      // 2. 限幅滤波 (Clamp)
      if (raw > this.clampMax) raw = this.clampMax;
      if (raw < this.clampMin) raw = this.clampMin;

      // 3. 一阶低通滤波 (LPF)
      let out;
      if (!this.initialized) {
        out = raw;
        this.initialized = true;
      } else {
        out = this.alpha * raw + (1 - this.alpha) * this.lastOut;
      }
      this.lastOut = out;

      return Math.round(out);
    }
  }

  const filters = {
    gx: new SensorFilter(), gy: new SensorFilter(), gz: new SensorFilter(),
    ax: new SensorFilter(), ay: new SensorFilter(), az: new SensorFilter()
  };

  /* ── Parse one line ────────────────────────────── */
  // 支持 6轴格式: gyro_x, gyro_y, gyro_z, acc_x, acc_y, acc_z
  // 也兼容旧 3轴格式: x, y, z（自动判断列数）
  function parseLine(raw) {
    const line = raw.replace(/\r/g, '').trim();
    if (!line) return false;
    const parts = line.split(',');

    if (parts.length >= 6) {
      // ── 6轴模式 ──────────────────────────────────────
      let gx = parseInt(parts[0].trim(), 10);
      let gy = parseInt(parts[1].trim(), 10);
      let gz = parseInt(parts[2].trim(), 10);
      let ax = parseInt(parts[3].trim(), 10);
      let ay = parseInt(parts[4].trim(), 10);
      let az = parseInt(parts[5].trim(), 10);
      if (isNaN(gx) || isNaN(gy) || isNaN(gz) ||
        isNaN(ax) || isNaN(ay) || isNaN(az)) return false;

      // 三重滤波处理 (Spike -> Clamp -> LPF)
      gx = filters.gx.process(gx);
      gy = filters.gy.process(gy);
      gz = filters.gz.process(gz);
      ax = filters.ax.process(ax);
      ay = filters.ay.process(ay);
      az = filters.az.process(az);

      // 陀螺仪数据 → state.gyro + gyroHistory
      state.gyro.gx = gx; state.gyro.gy = gy; state.gyro.gz = gz;
      state.pushGyroHistory(gx, gy, gz);
      // 加速度计数据 → state.data + history（兼容现有图表）
      state.data.x = ax; state.data.y = ay; state.data.z = az;
      state.pushHistory(ax, ay, az);

      state.totalFrames++;
      state._linesBucket++;
      if (state.onFrame) state.onFrame(gx, gy, gz, ax, ay, az);
      if (state.onData) state.onData(ax, ay, az);
      return true;

    } else if (parts.length >= 3) {
      // ── 兼容旧 3轴模式 ───────────────────────────────
      let x = parseInt(parts[0].trim(), 10);
      let y = parseInt(parts[1].trim(), 10);
      let z = parseInt(parts[2].trim(), 10);
      if (isNaN(x) || isNaN(y) || isNaN(z)) return false;

      x = filters.ax.process(x);
      y = filters.ay.process(y);
      z = filters.az.process(z);

      state.data.x = x; state.data.y = y; state.data.z = z;
      state.pushHistory(x, y, z);

      state.totalFrames++;
      state._linesBucket++;
      if (state.onData) state.onData(x, y, z);
      return true;

    } else {
      return false;
    }
  }

  /* ── Batched log flush (every 200ms) ───────────── */
  const logBuffer = [];
  let logCount = 0;
  const LOG_MAX = 600;

  function queueLog(text) {
    logBuffer.push(text);
    if (logBuffer.length > 150) logBuffer.shift();
  }

  setInterval(() => {
    if (!logBuffer.length) return;
    const lines = logBuffer.splice(0);
    const logArea = document.getElementById('log-out');
    const logRate = document.getElementById('log-rate');
    if (!logArea) return;
    if (document.getElementById('log-panel').classList.contains('open')) {
      lines.forEach(t => {
        const d = document.createElement('div');
        d.textContent = `[${new Date().toISOString().slice(11, 23)}] ${t}`;
        logArea.appendChild(d);
        logCount++;
      });
      while (logCount > LOG_MAX) { logArea.removeChild(logArea.firstChild); logCount--; }
      logArea.scrollTop = logArea.scrollHeight;
    }
    if (logRate) logRate.textContent = (lines.length * 5).toLocaleString() + '/s est.';
  }, 200);

  /* ── Lines/s meter ────────────────────────────── */
  setInterval(() => { state.rawLineRate = state._linesBucket; state._linesBucket = 0; }, 1000);

  /* ── Serial read loop ─────────────────────────── */
  async function runReadLoop(port) {
    const decoder = new TextDecoderStream();
    const pipeP = port.readable.pipeTo(decoder.writable).catch(() => { });
    const reader = decoder.readable.getReader();
    state.reader = reader;

    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!parseLine(line)) {
            state.errorFrames++;
            if (state.errorFrames % 80 === 0) queueLog('⚠ 解析失败: ' + line.trim().slice(0, 40));
          } else {
            if (state.totalFrames % 300 === 0) queueLog(line.trim().slice(0, 60));
          }
        }
        if (buf.length > 4096) { buf = ''; state.errorFrames++; }
      }
    } catch (e) {
      if (e.name !== 'AbortError') queueLog('❌ 读取错误: ' + e.message);
    } finally {
      reader.releaseLock();
      await pipeP;
    }
  }

  /* ── Connect to a SerialPort object ───────────── */
  async function connectToPort(port, baud) {
    try {
      await port.open({ baudRate: baud, bufferSize: 65536 });
    } catch (e) {
      if (e.name !== 'AbortError') queueLog('❌ 打开串口失败: ' + e.message);
      return false;
    }

    state.port = port;
    const info = port.getInfo();
    const vid = info.usbVendorId, pid = info.usbProductId;
    const dInfo = getDeviceInfo(vid, pid);
    state.currentPortInfo = { ...dInfo, vid, pid };

    setConnected(true, state.currentPortInfo);
    queueLog(`✅ 已连接  ${dInfo.name}  (${dInfo.brand})  波特率 ${baud}`);
    if (vid) queueLog(`   VID:${h(vid)}  PID:${h(pid)}`);
    queueLog(`📐 格式: printf("%6d, %6d, %6d , %6d, %6d, %6d\\r\\n", gyro_x, gyro_y, gyro_z, acc_x, acc_y, acc_z)`);

    await runReadLoop(port);

    try { await port.close(); } catch (_) { }
    state.port = null; state.reader = null;
    setConnected(false, null);
    queueLog('🔌 串口已断开');
    renderPortList(state.knownPorts, null);
    return true;
  }

  /* ── Open browser picker then connect ─────────── */
  async function connectPicker(baud) {
    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      if (e.name !== 'NotFoundError' && e.name !== 'AbortError')
        queueLog('❌ 选择串口失败: ' + e.message);
      return;
    }
    if (!state.knownPorts.includes(port)) state.knownPorts.push(port);
    renderPortList(state.knownPorts, null);
    await connectToPort(port, baud);
  }

  /* ── Disconnect ───────────────────────────────── */
  async function disconnect() {
    if (state.reader) await state.reader.cancel().catch(() => { });
  }

  /* ── Scan (getPorts) ──────────────────────────── */
  async function scan() {
    if (!('serial' in navigator)) return;
    try {
      state.knownPorts = await navigator.serial.getPorts();
    } catch (e) { queueLog('⚠ 扫描失败: ' + e.message); return; }
    renderPortList(state.knownPorts, state.port);
  }

  /* ── Set connected state (calls UI updater) ────── */
  function setConnected(v, portInfo) {
    state.connected = v;
    // Notify UI
    if (window.MEMSApp) window.MEMSApp.onConnectionChange(v, portInfo);
  }

  /* ── Port card rendering ──────────────────────── */
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderPortList(ports, activePort) {
    const portPanel = document.getElementById('port-panel');
    const portList = document.getElementById('port-list');
    const portCount = document.getElementById('port-count');
    if (!portPanel || !portList) return;

    portPanel.classList.add('open');
    portList.innerHTML = '';
    portCount.textContent = ports.length;

    if (!ports.length) {
      const empty = document.createElement('div');
      empty.className = 'port-empty';
      empty.innerHTML = `<span class="pe-icon">🔌</span>
        <p>未发现已授权设备<br/>点击「连接串口」在弹窗中选择授权，再「扫描串口」即可显示</p>`;
      portList.appendChild(empty);
      return;
    }

    ports.forEach(port => {
      const info = port.getInfo();
      const vid = info.usbVendorId, pid = info.usbProductId;
      const dInfo = getDeviceInfo(vid, pid);
      const isActive = (port === activePort);

      const card = document.createElement('div');
      card.className = 'port-card' + (isActive ? ' active-port' : '');
      card.title = vid ? `VID:${h(vid)}  PID:${h(pid)}` : '系统 / 虚拟串口';
      card.innerHTML = `
        <div class="pc-row1">
          <div class="pc-icon ${vid ? 'usb' : 'sys'}">${vid ? '🔌' : '📟'}</div>
          <div>
            <div class="pc-name">${escHtml(dInfo.name)}</div>
            <div class="pc-chip">${escHtml(dInfo.brand)}</div>
          </div>
        </div>
        <div class="pc-vid">${vid ? `VID:${h(vid)}  PID:${h(pid)}` : '系统串口'}</div>
        <div class="pc-status ${isActive ? 'connected' : 'idle'}">${isActive ? '已连接' : '点击连接'}</div>`;

      card.addEventListener('click', () => {
        if (state.connected && !isActive) { queueLog('⚠ 请先断开'); return; }
        if (!state.connected) {
          const baud = parseInt(document.getElementById('baud-sel').value, 10);
          if (!state.knownPorts.includes(port)) state.knownPorts.push(port);
          connectToPort(port, baud).then(() => renderPortList(state.knownPorts, null));
        }
      });
      portList.appendChild(card);
    });
  }

  /* ── Demo mode ────────────────────────────────── */
  let demoTimer = null;

  function startDemo() {
    if (state.demo) return;
    state.demo = true;
    setConnected(true, { name: 'Demo（正弦波）', brand: '' });
    queueLog('▶ 演示模式已启动');
    const banner = document.getElementById('demo-banner');
    if (banner) banner.classList.add('show');

    let t = 0;
    demoTimer = setInterval(() => {
      t += 0.04;
      const x = Math.round(Math.sin(t * 1.1) * 1500);
      const y = Math.round(Math.cos(t * 0.85) * 800);
      const z = Math.round(980 + Math.sin(t * 0.3) * 150);
      state.data.x = x; state.data.y = y; state.data.z = z;
      state.pushHistory(x, y, z);
      state.totalFrames++;
      state._linesBucket++;
      if (state.onData) state.onData(x, y, z);
    }, 10);
  }

  function stopDemo() {
    if (!state.demo) return;
    clearInterval(demoTimer); state.demo = false;
    const banner = document.getElementById('demo-banner');
    if (banner) banner.classList.remove('show');
    setConnected(false, null);
    queueLog('⏹ 演示模式已停止');
  }

  /* ── Auto-scan on load ────────────────────────── */
  window.addEventListener('load', () => {
    if ('serial' in navigator) {
      scan().then(() => {
        if (state.knownPorts.length)
          queueLog(`✅ 检测到 ${state.knownPorts.length} 个已授权串口`);
        else
          queueLog('💡 未发现已授权串口，点击「连接串口」选择设备。');
      });
      navigator.serial.addEventListener('connect', () => scan());
      navigator.serial.addEventListener('disconnect', () => scan());
    }
    queueLog('💡 MEMS Dashboard 已就绪');
    queueLog('💡 格式(6轴): printf("%6d, %6d, %6d , %6d, %6d, %6d\\r\\n", gyro_x, gyro_y, gyro_z, acc_x, acc_y, acc_z)');
    if (!('serial' in navigator)) queueLog('⚠ 不支持 Web Serial API，将使用演示模式');
  });

  /* ── Public API ───────────────────────────────── */
  return {
    state,
    connectPicker,
    connectToPort,
    disconnect,
    scan,
    startDemo,
    stopDemo,
    queueLog,
    getDeviceInfo,
    renderPortList,
    hex: h,
  };
})();
