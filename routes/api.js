/**
 * API Routes  -  SpaceX CRS-16 telemetry
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const CSVParser = require('../services/csvParser');
const { AnomalyDetector, REDLINE_LIMITS, MISSION_EVENTS } = require('../services/anomalyDetector');

/* Vercel only allows writes to /tmp; fallback to data/uploads locally */
const uploadDest = process.env.VERCEL
  ? '/tmp/uploads'
  : path.join(__dirname, '..', 'data', 'uploads');

const upload = multer({
  dest: uploadDest,
  fileFilter: (_, file, cb) => cb(null, file.originalname.endsWith('.csv') || file.mimetype === 'text/csv'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

let currentData = null;
let currentAnomalies = null;
let currentStats = null;
let currentSummary = null;
let currentFilename = null;

async function loadDefaultData() {
  const fs = require('fs');
  const defaultPath = path.join(__dirname, '..', 'data', 'spacex_crs16_telemetry.csv');
  if (fs.existsSync(defaultPath)) {
    currentData = await CSVParser.parseFile(defaultPath);
    currentFilename = 'spacex_crs16_telemetry.csv';
    runDetection();
    console.log(`  [data] Loaded default dataset: ${currentData.length} records`);
  }
}

function runDetection() {
  if (!currentData) return;
  const det = new AnomalyDetector(currentData);
  det.detectAll();
  currentAnomalies = det.anomalies;
  currentSummary = det.getSummary();
  const cols = CSVParser.getNumericColumns(currentData);
  currentStats = {};
  for (const c of cols) currentStats[c] = CSVParser.getStats(currentData, c);
}

loadDefaultData();

router.get('/status', (_, res) => {
  res.json({
    loaded: !!currentData,
    currentFile: currentFilename,
    filename: currentFilename,
    records: currentData?.length || 0,
    anomalies: currentAnomalies?.length || 0,
    events: currentSummary?.totalEvents || 0,
  });
});

router.post('/upload', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    currentData = await CSVParser.parseFile(req.file.path);
    currentFilename = req.file.originalname;
    runDetection();
    res.json({ success: true, filename: currentFilename, records: currentData.length, columns: Object.keys(currentData[0]), anomalies: currentAnomalies.length, events: currentSummary.totalEvents });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/telemetry', (req, res) => {
  if (!currentData) return res.status(404).json({ error: 'No data loaded' });
  const max = parseInt(req.query.maxPoints) || 1000;
  const params = req.query.params?.split(',') || null;
  const st = parseFloat(req.query.startTime) || null;
  const et = parseFloat(req.query.endTime) || null;

  let d = currentData;
  if (st !== null || et !== null) d = d.filter(r => (st === null || r.mission_time_s >= st) && (et === null || r.mission_time_s <= et));
  d = CSVParser.downsample(d, max);
  if (params) {
    d = d.map(r => {
      const row = { mission_time_s: r.mission_time_s, flight_phase: r.flight_phase };
      for (const p of params) if (r[p] !== undefined) row[p] = r[p];
      return row;
    });
  }
  res.json(d);
});

router.get('/telemetry/columns', (_, res) => {
  if (!currentData) return res.status(404).json({ error: 'No data loaded' });
  res.json(Object.keys(currentData[0]).map(col => ({
    name: col,
    label: REDLINE_LIMITS[col]?.label || col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    unit: REDLINE_LIMITS[col]?.unit || '',
    isNumeric: typeof currentData[0][col] === 'number',
    hasRedline: !!REDLINE_LIMITS[col],
  })));
});

router.get('/stats', (_, res) => { if (!currentStats) return res.status(404).json({ error: 'No data' }); res.json(currentStats); });
router.get('/anomalies', (req, res) => {
  if (!currentAnomalies) return res.status(404).json({ error: 'No data' });
  let f = currentAnomalies;
  if (req.query.severity) f = f.filter(a => a.severity === req.query.severity);
  if (req.query.type) f = f.filter(a => a.type === req.query.type);
  if (req.query.param) f = f.filter(a => a.parameter === req.query.param);
  res.json(f);
});
router.get('/anomalies/summary', (_, res) => { if (!currentSummary) return res.status(404).json({ error: 'No data' }); res.json(currentSummary); });
router.get('/anomalies/events', (_, res) => { if (!currentSummary) return res.status(404).json({ error: 'No data' }); res.json(currentSummary.events); });
router.get('/redlines', (_, res) => res.json(REDLINE_LIMITS));
router.get('/mission-events', (_, res) => res.json(MISSION_EVENTS));

router.getDataContext = () => ({ stats: currentStats, summary: currentSummary, data: currentData });

module.exports = router;
