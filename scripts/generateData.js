/**
 * Rocket Telemetry Data Generator
 * Generates realistic rocket engine test data with embedded anomalies
 * Based on typical liquid rocket engine parameters (RP-1/LOX engines similar to Merlin/RS-25)
 * Inspired by NASA & SpaceX publicly available test data patterns
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'rocket_telemetry.csv');
const TOTAL_DURATION_SEC = 600; // 10-minute test fire
const SAMPLE_RATE_HZ = 10; // 10 samples per second
const TOTAL_SAMPLES = TOTAL_DURATION_SEC * SAMPLE_RATE_HZ;

// Nominal parameters (based on typical medium-thrust LOX/RP-1 engine)
const NOMINAL = {
  chamber_pressure_psi: { mean: 1420, std: 8, min: 1350, max: 1500 },
  oxidizer_inlet_pressure_psi: { mean: 1650, std: 10, min: 1580, max: 1720 },
  fuel_inlet_pressure_psi: { mean: 1520, std: 9, min: 1450, max: 1590 },
  combustion_temp_F: { mean: 5800, std: 30, min: 5600, max: 6100 },
  nozzle_exit_temp_F: { mean: 2800, std: 25, min: 2650, max: 2950 },
  thrust_lbf: { mean: 190000, std: 500, min: 185000, max: 195000 },
  oxidizer_flow_rate_gps: { mean: 560, std: 3, min: 545, max: 575 },
  fuel_flow_rate_gps: { mean: 240, std: 2, min: 232, max: 248 },
  turbopump_rpm: { mean: 36000, std: 100, min: 35000, max: 37000 },
  vibration_g: { mean: 2.5, std: 0.3, min: 1.5, max: 4.0 },
  coolant_inlet_temp_F: { mean: 72, std: 2, min: 65, max: 85 },
  coolant_outlet_temp_F: { mean: 350, std: 8, min: 320, max: 390 },
  injector_pressure_drop_psi: { mean: 280, std: 5, min: 260, max: 300 },
  nozzle_exit_pressure_psi: { mean: 14.7, std: 0.5, min: 12, max: 17 },
  o_f_ratio: { mean: 2.33, std: 0.02, min: 2.2, max: 2.5 },
};

// Anomaly definitions - these will be injected into the data
const ANOMALIES = [
  {
    id: 'A1',
    name: 'Chamber Pressure Spike',
    description: 'Sudden combustion instability causing chamber pressure excursion',
    startSample: 850,
    duration: 40,
    params: { chamber_pressure_psi: { offset: 180, spike: true } },
  },
  {
    id: 'A2',
    name: 'Oxidizer Inlet Pressure Drop',
    description: 'Cavitation in oxidizer feed line causing pressure oscillation',
    startSample: 1500,
    duration: 80,
    params: { oxidizer_inlet_pressure_psi: { offset: -120, oscillation: true, freq: 5 } },
  },
  {
    id: 'A3',
    name: 'Combustion Temperature Exceedance',
    description: 'O/F ratio drift causing combustion temperature to exceed redline',
    startSample: 2200,
    duration: 120,
    params: {
      combustion_temp_F: { offset: 350, ramp: true },
      o_f_ratio: { offset: 0.2, ramp: true },
    },
  },
  {
    id: 'A4',
    name: 'Turbopump Vibration Anomaly',
    description: 'Bearing degradation causing excessive turbopump vibration and RPM fluctuation',
    startSample: 2900,
    duration: 100,
    params: {
      vibration_g: { offset: 5.5, spike: true },
      turbopump_rpm: { offset: -800, oscillation: true, freq: 8 },
    },
  },
  {
    id: 'A5',
    name: 'Coolant System Thermal Runaway',
    description: 'Partial blockage in regenerative cooling channels causing localized hotspot',
    startSample: 3600,
    duration: 150,
    params: {
      coolant_outlet_temp_F: { offset: 120, ramp: true },
      nozzle_exit_temp_F: { offset: 250, ramp: true },
    },
  },
  {
    id: 'A6',
    name: 'Fuel Pressure Oscillation',
    description: 'POGO-like instability in fuel feed system',
    startSample: 4200,
    duration: 60,
    params: {
      fuel_inlet_pressure_psi: { offset: 0, oscillation: true, freq: 12, amplitude: 100 },
      thrust_lbf: { offset: 0, oscillation: true, freq: 12, amplitude: 8000 },
    },
  },
  {
    id: 'A7',
    name: 'Injector Face Erosion',
    description: 'Progressive injector erosion causing pressure drop decrease and combustion efficiency loss',
    startSample: 4800,
    duration: 200,
    params: {
      injector_pressure_drop_psi: { offset: -60, ramp: true },
      combustion_temp_F: { offset: -200, ramp: true },
      thrust_lbf: { offset: -5000, ramp: true },
    },
  },
  {
    id: 'A8',
    name: 'Chamber Pressure Rapid Transient',
    description: 'Hard start / combustion instability event with rapid pressure oscillations',
    startSample: 5400,
    duration: 30,
    params: {
      chamber_pressure_psi: { offset: 0, oscillation: true, freq: 20, amplitude: 200 },
      vibration_g: { offset: 8, spike: true },
    },
  },
];

function gaussianRandom(mean, std) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateSample(index, totalSamples) {
  const t = index / SAMPLE_RATE_HZ;
  const timestamp = new Date(2026, 1, 15, 10, 0, 0);
  timestamp.setMilliseconds(timestamp.getMilliseconds() + (t * 1000));

  // Startup ramp (first 5 seconds) and shutdown ramp (last 5 seconds)
  let rampFactor = 1.0;
  if (index < 50) rampFactor = index / 50;
  else if (index > totalSamples - 50) rampFactor = (totalSamples - index) / 50;

  const sample = {};

  // Generate nominal values with slight drift and noise
  const drift = Math.sin(2 * Math.PI * t / 300) * 0.01; // slow system drift

  for (const [param, config] of Object.entries(NOMINAL)) {
    let value = gaussianRandom(config.mean, config.std);
    value *= (1 + drift);
    value *= rampFactor;
    sample[param] = value;
  }

  // Apply anomalies
  for (const anomaly of ANOMALIES) {
    if (index >= anomaly.startSample && index < anomaly.startSample + anomaly.duration) {
      const progress = (index - anomaly.startSample) / anomaly.duration;
      const localT = (index - anomaly.startSample) / SAMPLE_RATE_HZ;

      for (const [param, effect] of Object.entries(anomaly.params)) {
        if (effect.spike) {
          // Sharp spike with exponential decay
          const envelope = Math.exp(-3 * progress) * (1 + 0.5 * Math.sin(20 * Math.PI * progress));
          sample[param] += effect.offset * envelope;
        }
        if (effect.ramp) {
          // Gradual ramp up
          sample[param] += effect.offset * progress;
        }
        if (effect.oscillation) {
          const amp = effect.amplitude || Math.abs(effect.offset) || 50;
          sample[param] += amp * Math.sin(2 * Math.PI * effect.freq * localT) * (1 - 0.3 * progress);
          if (effect.offset) sample[param] += effect.offset * progress;
        }
      }
    }
  }

  // Ensure O/F ratio is calculated from flow rates
  if (sample.oxidizer_flow_rate_gps > 0 && sample.fuel_flow_rate_gps > 0) {
    sample.o_f_ratio_actual = sample.oxidizer_flow_rate_gps / sample.fuel_flow_rate_gps;
  }

  return {
    timestamp: timestamp.toISOString(),
    mission_time_s: parseFloat(t.toFixed(2)),
    ...Object.fromEntries(
      Object.entries(sample).map(([k, v]) => [k, parseFloat(v.toFixed(4))])
    ),
    test_phase: index < 50 ? 'STARTUP' : index > totalSamples - 50 ? 'SHUTDOWN' : 'MAINSTAGE',
  };
}

function generate() {
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const samples = [];
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    samples.push(generateSample(i, TOTAL_SAMPLES));
  }

  const headers = Object.keys(samples[0]);
  const csvLines = [headers.join(',')];
  for (const s of samples) {
    csvLines.push(headers.map(h => s[h]).join(','));
  }

  fs.writeFileSync(OUTPUT_PATH, csvLines.join('\n'));
  console.log(`✅ Generated ${TOTAL_SAMPLES} samples -> ${OUTPUT_PATH}`);
  console.log(`📊 Data spans ${TOTAL_DURATION_SEC}s at ${SAMPLE_RATE_HZ}Hz`);
  console.log(`⚠️  Embedded ${ANOMALIES.length} anomaly events`);
  console.log('\nAnomaly Summary:');
  ANOMALIES.forEach(a => {
    const startTime = (a.startSample / SAMPLE_RATE_HZ).toFixed(1);
    const endTime = ((a.startSample + a.duration) / SAMPLE_RATE_HZ).toFixed(1);
    console.log(`  [${a.id}] ${a.name} @ T+${startTime}s - T+${endTime}s`);
  });
}

generate();
