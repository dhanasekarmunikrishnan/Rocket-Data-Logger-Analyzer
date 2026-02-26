/**
 * SpaceX CRS-16 Telemetry Data Downloader & Converter
 * Downloads real telemetry from github.com/shahar603/Telemetry-Data
 * Converts JSON to CSV with derived parameters
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const BASE_URL = 'https://raw.githubusercontent.com/shahar603/Telemetry-Data/master/SpaceX%20CRS-16/JSON/';

const FILES = {
  analysed: 'analysed.json',
  raw: 'CRS-16.json',
  stage2: 'stage2%20raw.json',
  events: 'events.json',
  stages: 'stages.json',
};

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[*] Downloading SpaceX CRS-16 telemetry from GitHub...\n');

  // Download all files
  const analysed = await download(BASE_URL + FILES.analysed);
  console.log(`    analysed.json     : ${analysed.time.length} samples, keys: ${Object.keys(analysed).join(', ')}`);

  const raw = await download(BASE_URL + FILES.raw);
  console.log(`    CRS-16.json       : ${raw.time.length} samples (raw 30Hz)`);

  const stage2 = await download(BASE_URL + FILES.stage2);
  console.log(`    stage2 raw.json   : ${stage2.time.length} samples`);

  const events = await download(BASE_URL + FILES.events);
  console.log(`    events.json       : ${Object.keys(events).length} event markers`);

  // Save events as JSON for the app
  fs.writeFileSync(path.join(OUTPUT_DIR, 'events.json'), JSON.stringify(events, null, 2));

  // --- Build the main CSV from analysed.json (richest dataset at 1Hz) ---
  const n = analysed.time.length;
  const rows = [];

  for (let i = 0; i < n; i++) {
    const t = analysed.time[i];
    const vel = analysed.velocity[i];
    const alt = analysed.altitude[i];
    const vy = analysed.velocity_y[i];
    const vx = analysed.velocity_x[i];
    const acc = analysed.acceleration[i];
    const dr = analysed.downrange_distance[i];
    const ang = analysed.angle[i];
    const q = analysed.q[i];

    // Derived: rate of change of acceleration (jerk)
    let jerk = 0;
    if (i > 0) {
      const dt = analysed.time[i] - analysed.time[i - 1];
      if (dt > 0) jerk = (acc - analysed.acceleration[i - 1]) / dt;
    }

    // Derived: altitude rate (vertical velocity in km/s)
    let alt_rate = 0;
    if (i > 0) {
      const dt = analysed.time[i] - analysed.time[i - 1];
      if (dt > 0) alt_rate = (alt - analysed.altitude[i - 1]) / dt;
    }

    // Derived: velocity magnitude rate
    let vel_rate = 0;
    if (i > 0) {
      const dt = analysed.time[i] - analysed.time[i - 1];
      if (dt > 0) vel_rate = (vel - analysed.velocity[i - 1]) / dt;
    }

    // Derived: angle rate of change (deg/s)
    let angle_rate = 0;
    if (i > 0) {
      const dt = analysed.time[i] - analysed.time[i - 1];
      if (dt > 0) angle_rate = (ang - analysed.angle[i - 1]) / dt;
    }

    // Derived: Mach number (approximate, sea level speed of sound ~343 m/s)
    const mach = vel / 343;

    // Determine flight phase
    let phase = 'POWERED_ASCENT';
    if (t < 2) phase = 'LIFTOFF';
    else if (t >= events.throttle_down_start && t <= events.throttle_down_end) phase = 'THROTTLE_DOWN';
    else if (t > events.throttle_down_end && t < events.meco) phase = 'POWERED_ASCENT';
    else if (Math.abs(t - events.meco) <= 1) phase = 'MECO';
    else if (t > events.meco && t < events.ses1) phase = 'COAST';
    else if (t >= events.ses1) phase = 'STAGE2_BURN';

    rows.push({
      mission_time_s: parseFloat(t.toFixed(3)),
      velocity_ms: parseFloat(vel.toFixed(3)),
      altitude_km: parseFloat(alt.toFixed(3)),
      velocity_y_ms: parseFloat(vy.toFixed(3)),
      velocity_x_ms: parseFloat(vx.toFixed(3)),
      acceleration_ms2: parseFloat(acc.toFixed(3)),
      downrange_distance_km: parseFloat(dr.toFixed(3)),
      angle_deg: parseFloat(ang.toFixed(3)),
      dynamic_pressure_pa: parseFloat(q.toFixed(3)),
      jerk_ms3: parseFloat(jerk.toFixed(4)),
      altitude_rate_kms: parseFloat(alt_rate.toFixed(4)),
      velocity_rate_ms2: parseFloat(vel_rate.toFixed(4)),
      angle_rate_degs: parseFloat(angle_rate.toFixed(4)),
      mach_number: parseFloat(mach.toFixed(4)),
      flight_phase: phase,
    });
  }

  // Write CSV
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  for (const r of rows) {
    csvLines.push(headers.map(h => r[h]).join(','));
  }

  const csvPath = path.join(OUTPUT_DIR, 'spacex_crs16_telemetry.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));

  console.log(`\n[+] Generated CSV: ${csvPath}`);
  console.log(`    ${rows.length} rows, ${headers.length} columns`);
  console.log(`    Columns: ${headers.join(', ')}`);
  console.log(`    Time range: ${rows[0].mission_time_s}s to ${rows[rows.length - 1].mission_time_s}s`);
  console.log(`\n    Flight Events:`);
  console.log(`    Throttle Down   : T+${events.throttle_down_start}s - T+${events.throttle_down_end}s`);
  console.log(`    Max Q           : T+${events.maxq}s`);
  console.log(`    MECO            : T+${events.meco}s`);
  console.log(`    SES-1           : T+${events.ses1}s`);

  // Also save the raw 30Hz data as a separate CSV for detailed analysis
  const rawCsvLines = ['mission_time_s,velocity_ms,altitude_km'];
  for (let i = 0; i < raw.time.length; i++) {
    rawCsvLines.push(`${raw.time[i]},${raw.velocity[i]},${raw.altitude[i]}`);
  }
  const rawCsvPath = path.join(OUTPUT_DIR, 'spacex_crs16_raw_30hz.csv');
  fs.writeFileSync(rawCsvPath, rawCsvLines.join('\n'));
  console.log(`\n[+] Generated raw 30Hz CSV: ${rawCsvPath}`);
  console.log(`    ${raw.time.length} rows`);
}

main().catch(err => {
  console.error('[!] Error:', err.message);
  process.exit(1);
});
