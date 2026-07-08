/**
 * Mission Control Demo — server
 *
 * The three things a real telemetry SaaS backend does, in miniature:
 *   1. INGEST  — a built-in simulator generates telemetry for a small fleet
 *                (in production, customer devices would POST/MQTT their data in)
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
// The fleet: three vehicles, each with its own telemetry channels
// ---------------------------------------------------------------------------
const CHANNELS = {
  drone: [
    { key: 'battery.soc',     name: 'Battery Charge',    units: '%',   min: 0,   max: 100 },
    { key: 'battery.voltage', name: 'Battery Voltage',   units: 'V',   min: 9,   max: 13 },
    { key: 'altitude',        name: 'Altitude',          units: 'm',   min: 0,   max: 150 },
    { key: 'speed',           name: 'Ground Speed',      units: 'm/s', min: 0,   max: 20 },
    { key: 'heading',         name: 'Heading',           units: '°',   min: 0,   max: 360 },
    { key: 'signal.rssi',     name: 'Signal Strength',   units: 'dBm', min: -95, max: -30 },
    { key: 'motor.temp',      name: 'Motor Temperature', units: '°C',  min: 15,  max: 90 },
    { key: 'vibration',       name: 'Vibration',         units: 'g',   min: 0,   max: 3 },
    { key: 'gps.satellites',  name: 'GPS Satellites',    units: '',    min: 0,   max: 24 }
  ],
  rover: [
    { key: 'battery.soc',     name: 'Battery Charge',    units: '%',   min: 0,   max: 100 },
    { key: 'battery.current', name: 'Battery Current',   units: 'A',   min: 0,   max: 40 },
    { key: 'speed',           name: 'Ground Speed',      units: 'm/s', min: 0,   max: 4 },
    { key: 'heading',         name: 'Heading',           units: '°',   min: 0,   max: 360 },
    { key: 'signal.rssi',     name: 'Signal Strength',   units: 'dBm', min: -95, max: -30 },
    { key: 'motor.temp',      name: 'Drive Temperature', units: '°C',  min: 15,  max: 80 },
    { key: 'chassis.tilt',    name: 'Chassis Tilt',      units: '°',   min: 0,   max: 45 },
    { key: 'internal.temp',   name: 'Internal Temp',     units: '°C',  min: 10,  max: 60 }
  ]
};

const VEHICLES = [
  { key: 'alpha',   name: 'Recon Drone ALPHA',    kind: 'drone', phase: 0 },
  { key: 'bravo',   name: 'Recon Drone BRAVO',    kind: 'drone', phase: 120 },
  { key: 'charlie', name: 'Surface Rover CHARLIE', kind: 'rover', phase: 0 }
];

const DICTIONARY = {
  name: 'Luna Station Fleet',
  key: 'fleet',
  vehicles: VEHICLES.map((v) => ({
    key: v.key,
    name: v.name,
    kind: v.kind,
    measurements: CHANNELS[v.kind].map((c) => ({
      ...c,
      key: v.key + '.' + c.key // globally unique, e.g. "alpha.battery.soc"
    }))
  }))
};

// ---------------------------------------------------------------------------
// STORE: in-memory history, one ring buffer per channel
// ---------------------------------------------------------------------------
const history = {};
DICTIONARY.vehicles.forEach((v) =>
  v.measurements.forEach((m) => (history[m.key] = []))
);

function record(key, timestamp, value) {
  const buf = history[key];
  buf.push({ timestamp, value, id: key });
  const cutoff = timestamp - HISTORY_MS;
  while (buf.length && buf[0].timestamp < cutoff) buf.shift();
}

// ---------------------------------------------------------------------------
// INGEST (simulated): flight/drive profiles that never end
// ---------------------------------------------------------------------------
function makeState(v) {
  return {
    t: v.phase, soc: 100 - v.phase / 10, voltage: 12.6, altitude: 0,
    speed: 0, heading: Math.random() * 360, rssi: -40, motorTemp: 22,
    vibration: 0.2, sats: 12, current: 5, tilt: 2, internalTemp: 25
  };
}
const states = new Map(VEHICLES.map((v) => [v.key, makeState(v)]));

function stepVehicle(v) {
  const s = states.get(v.key);
  s.t += 1;

  s.soc = Math.max(0, s.soc - 0.008 - Math.random() * 0.008);
  if (s.soc < 1) s.soc = 100; // "battery swap" so the demo runs forever
  s.voltage = 9.6 + (s.soc / 100) * 3 + (Math.random() - 0.5) * 0.05;
  s.heading = (s.heading + (Math.random() - 0.45) * 6 + 360) % 360;
  s.rssi = -40 - (v.kind === 'drone' ? s.altitude / 8 : s.t % 30) + (Math.random() - 0.5) * 4;

  if (v.kind === 'drone') {
    const targetAlt = 100 + 25 * Math.sin((s.t + v.phase) / 60);
    s.altitude = Math.max(0, s.altitude + (targetAlt - s.altitude) * 0.02 + (Math.random() - 0.5) * 0.8);
    s.speed = Math.max(0, Math.min(18, s.speed + (Math.random() - 0.5) * 1.2));
    s.vibration = Math.max(0.05, Math.min(3, 0.2 + s.speed / 10 + (Math.random() - 0.5) * 0.2));
    s.sats = Math.max(6, Math.min(20, s.sats + Math.round((Math.random() - 0.5) * 2)));
    const targetTemp = 25 + s.speed * 2.5;
    s.motorTemp += (targetTemp - s.motorTemp) * 0.05 + (Math.random() - 0.5) * 0.4;
    return {
      [v.key + '.battery.soc']: round(s.soc, 1),
      [v.key + '.battery.voltage']: round(s.voltage, 2),
      [v.key + '.altitude']: round(s.altitude, 1),
      [v.key + '.speed']: round(s.speed, 2),
      [v.key + '.heading']: round(s.heading, 0),
      [v.key + '.signal.rssi']: round(s.rssi, 1),
      [v.key + '.motor.temp']: round(s.motorTemp, 1),
      [v.key + '.vibration']: round(s.vibration, 2),
      [v.key + '.gps.satellites']: s.sats
    };
  }

  // rover
  s.speed = Math.max(0, Math.min(3.5, s.speed + (Math.random() - 0.5) * 0.4));
  s.current = Math.max(2, Math.min(38, 5 + s.speed * 8 + (Math.random() - 0.5) * 2));
  s.tilt = Math.max(0, Math.min(40, s.tilt + (Math.random() - 0.5) * 2));
  const targetTemp = 25 + s.speed * 10;
  s.motorTemp += (targetTemp - s.motorTemp) * 0.05 + (Math.random() - 0.5) * 0.4;
  s.internalTemp += ((28 + s.current / 4) - s.internalTemp) * 0.03 + (Math.random() - 0.5) * 0.2;
  return {
    [v.key + '.battery.soc']: round(s.soc, 1),
    [v.key + '.battery.current']: round(s.current, 1),
    [v.key + '.speed']: round(s.speed, 2),
    [v.key + '.heading']: round(s.heading, 0),
    [v.key + '.signal.rssi']: round(s.rssi, 1),
    [v.key + '.motor.temp']: round(s.motorTemp, 1),
    [v.key + '.chassis.tilt']: round(s.tilt, 1),
    [v.key + '.internal.temp']: round(s.internalTemp, 1)
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

app.use('/openmct', express.static(path.join(__dirname, 'node_modules/openmct/dist')));
app.use('/', express.static(__dirname));

app.get('/dictionary.json', (req, res) => res.json(DICTIONARY));

app.get('/telemetry/:key/history', (req, res) => {
  const buf = history[req.params.key];
  if (!buf) return res.status(404).json({ error: 'unknown telemetry point' });
  const start = Number(req.query.start) || 0;
  const end = Number(req.query.end) || Date.now();
  res.json(buf.filter((p) => p.timestamp >= start && p.timestamp <= end));
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/realtime' });
const subscriptions = new Map();

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

setInterval(() => {
  const ts = Date.now();
  for (const v of VEHICLES) {
    const sample = stepVehicle(v);
    for (const [key, value] of Object.entries(sample)) {
      record(key, ts, value);
      const point = { id: key, timestamp: ts, value };
      for (const [ws, subs] of subscriptions) {
        if (subs.has(key) && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(point));
        }
      }
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log('');
  console.log('  Mission Control Demo is running');
  console.log(`  Open your browser at:  http://localhost:${PORT}`);
  console.log('');
  console.log('  Fleet is live: Drone Alpha, Drone Bravo, Rover Charlie.');
});
