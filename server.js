/**
 * Mission Control Demo — server
 *
 * The three things a real telemetry SaaS backend does, in miniature:
 *   1. INGEST  — here, a built-in simulator generates fake drone telemetry
 *                (in production, devices would POST/MQTT their data in)
 *   2. STORE   — an in-memory history buffer per channel
 *                (in production: a time-series DB like InfluxDB/Timescale)
 *   3. SERVE   — REST endpoint for history + WebSocket for live data,
 *                consumed by the Open MCT dashboard
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const HISTORY_MS = 2 * 60 * 60 * 1000; // keep 2 hours of history

// ---------------------------------------------------------------------------
// Telemetry dictionary: one drone, six channels
// ---------------------------------------------------------------------------
const DICTIONARY = {
  name: 'Drone Alpha',
  key: 'drone-1',
  measurements: [
    { key: 'battery.soc',     name: 'Battery Charge',   units: '%',    min: 0,   max: 100 },
    { key: 'battery.voltage', name: 'Battery Voltage',  units: 'V',    min: 9,   max: 13 },
    { key: 'altitude',        name: 'Altitude',         units: 'm',    min: 0,   max: 150 },
    { key: 'speed',           name: 'Ground Speed',     units: 'm/s',  min: 0,   max: 20 },
    { key: 'signal.rssi',     name: 'Signal Strength',  units: 'dBm',  min: -95, max: -30 },
    { key: 'motor.temp',      name: 'Motor Temperature',units: '°C',   min: 15,  max: 90 }
  ]
};

// ---------------------------------------------------------------------------
// STORE: in-memory history, one ring buffer per channel
// ---------------------------------------------------------------------------
const history = {}; // key -> [{timestamp, value}, ...]
DICTIONARY.measurements.forEach((m) => (history[m.key] = []));

function record(key, timestamp, value) {
  const buf = history[key];
  buf.push({ timestamp, value, id: key });
  // drop points older than HISTORY_MS
  const cutoff = timestamp - HISTORY_MS;
  while (buf.length && buf[0].timestamp < cutoff) buf.shift();
}

// ---------------------------------------------------------------------------
// INGEST (simulated): a fake drone flight that never ends
// ---------------------------------------------------------------------------
const state = {
  t: 0,
  soc: 100,
  voltage: 12.6,
  altitude: 0,
  speed: 0,
  rssi: -40,
  motorTemp: 22
};

function stepSimulation() {
  const s = state;
  s.t += 1;

  // battery drains slowly, voltage follows
  s.soc = Math.max(0, s.soc - 0.01 - Math.random() * 0.01);
  if (s.soc < 1) s.soc = 100; // "battery swap" so the demo runs forever
  s.voltage = 9.6 + (s.soc / 100) * 3 + (Math.random() - 0.5) * 0.05;

  // altitude: climb to ~100m, then wander
  const targetAlt = 100 + 20 * Math.sin(s.t / 60);
  s.altitude += (targetAlt - s.altitude) * 0.02 + (Math.random() - 0.5) * 0.8;
  s.altitude = Math.max(0, s.altitude);

  // speed wanders between 0 and 15 m/s
  s.speed = Math.max(0, Math.min(18, s.speed + (Math.random() - 0.5) * 1.2));

  // signal strength loosely tied to altitude + noise
  s.rssi = -40 - s.altitude / 8 + (Math.random() - 0.5) * 4;

  // motor temp rises with speed, cools otherwise
  const targetTemp = 25 + s.speed * 2.5;
  s.motorTemp += (targetTemp - s.motorTemp) * 0.05 + (Math.random() - 0.5) * 0.4;

  const now = Date.now();
  return {
    'battery.soc': round(s.soc, 1),
    'battery.voltage': round(s.voltage, 2),
    'altitude': round(s.altitude, 1),
    'speed': round(s.speed, 2),
    'signal.rssi': round(s.rssi, 1),
    'motor.temp': round(s.motorTemp, 1),
    timestamp: now
  };
}

function round(v, dp) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// SERVE: web app + REST history + WebSocket realtime
// ---------------------------------------------------------------------------
const app = express();

// Open MCT's prebuilt bundle straight out of node_modules
app.use('/openmct', express.static(path.join(__dirname, 'node_modules/openmct/dist')));
app.use('/', express.static(__dirname));

// telemetry dictionary (what channels exist)
app.get('/dictionary.json', (req, res) => res.json(DICTIONARY));

// historical telemetry: /telemetry/battery.soc/history?start=...&end=...
app.get('/telemetry/:key/history', (req, res) => {
  const buf = history[req.params.key];
  if (!buf) return res.status(404).json({ error: 'unknown telemetry point' });
  const start = Number(req.query.start) || 0;
  const end = Number(req.query.end) || Date.now();
  res.json(buf.filter((p) => p.timestamp >= start && p.timestamp <= end));
});

const server = http.createServer(app);

// realtime telemetry over WebSocket
const wss = new WebSocketServer({ server, path: '/realtime' });
const subscriptions = new Map(); // ws -> Set of keys

wss.on('connection', (ws) => {
  subscriptions.set(ws, new Set());
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const subs = subscriptions.get(ws);
      if (msg.type === 'subscribe') subs.add(msg.key);
      if (msg.type === 'unsubscribe') subs.delete(msg.key);
    } catch (e) { /* ignore malformed messages */ }
  });
  ws.on('close', () => subscriptions.delete(ws));
});

// the heartbeat: step the simulator once per second, store + broadcast
setInterval(() => {
  const sample = stepSimulation();
  const ts = sample.timestamp;
  DICTIONARY.measurements.forEach((m) => {
    const point = { id: m.key, timestamp: ts, value: sample[m.key] };
    record(m.key, ts, sample[m.key]);
    for (const [ws, subs] of subscriptions) {
      if (subs.has(m.key) && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(point));
      }
    }
  });
}, 1000);

server.listen(PORT, () => {
  console.log('');
  console.log('  Mission Control Demo is running');
  console.log(`  Open your browser at:  http://localhost:${PORT}`);
  console.log('');
  console.log('  Drone Alpha is flying and sending telemetry once per second.');
});
