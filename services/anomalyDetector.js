/**
 * Anomaly Detection Engine  (SpaceX CRS-16 edition)
 * Detects abnormalities in launch telemetry:
 *   - Z-score outliers
 *   - Rate-of-change spikes
 *   - Threshold / redline violations
 *   - Sustained window deviations
 */

const REDLINE_LIMITS = {
  velocity_ms:           { min: -50,   max: 8200,  unit: 'm/s',   label: 'Velocity' },
  altitude_km:           { min: -1,    max: 250,   unit: 'km',    label: 'Altitude' },
  velocity_y_ms:         { min: -200,  max: 2000,  unit: 'm/s',   label: 'Vertical Velocity' },
  velocity_x_ms:         { min: -50,   max: 8200,  unit: 'm/s',   label: 'Horizontal Velocity' },
  acceleration_ms2:      { min: 0,     max: 40,    unit: 'm/s2',  label: 'Acceleration' },
  downrange_distance_km: { min: -1,    max: 1500,  unit: 'km',    label: 'Downrange Distance' },
  angle_deg:             { min: -5,    max: 92,    unit: 'deg',   label: 'Flight Angle' },
  dynamic_pressure_pa:   { min: 0,     max: 35000, unit: 'Pa',    label: 'Dynamic Pressure (Q)' },
  jerk_ms3:              { min: -25,   max: 25,    unit: 'm/s3',  label: 'Jerk' },
  altitude_rate_kms:     { min: -0.5,  max: 2.5,   unit: 'km/s',  label: 'Altitude Rate' },
  velocity_rate_ms2:     { min: -30,   max: 45,    unit: 'm/s2',  label: 'Velocity Rate' },
  angle_rate_degs:       { min: -5,    max: 1,     unit: 'deg/s', label: 'Angle Rate' },
  mach_number:           { min: 0,     max: 25,    unit: '',      label: 'Mach Number' },
};

const MISSION_EVENTS = {
  maxq:                 54,
  throttle_down_start:  48,
  throttle_down_end:    68,
  meco:                 145,
  ses1:                 156,
};

class AnomalyDetector {
  constructor(data) {
    this.data = data;
    this.anomalies = [];
    this.stats = {};
  }

  detectAll() {
    this.anomalies = [];
    const working = this.data.filter(d =>
      typeof d.mission_time_s === 'number' && d.mission_time_s >= 0
    );
    if (working.length === 0) return this.anomalies;

    this._computeStats(working);
    this._detectZScoreAnomalies(working);
    this._detectRateOfChange(working);
    this._detectRedlineViolations(working);
    this._detectSustainedDeviations(working);
    this._clusterAnomalies();

    return this.anomalies;
  }

  _computeStats(data) {
    for (const param of Object.keys(REDLINE_LIMITS)) {
      const values = data.map(d => d[param]).filter(v => typeof v === 'number' && !isNaN(v));
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      const mean = sum / values.length;
      const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
      this.stats[param] = { mean, std: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) };
    }
  }

  _detectZScoreAnomalies(data) {
    const Z = 3.0;
    for (const [param, s] of Object.entries(this.stats)) {
      if (s.std === 0) continue;
      const lim = REDLINE_LIMITS[param];
      for (let i = 0; i < data.length; i++) {
        const v = data[i][param];
        if (typeof v !== 'number') continue;
        const z = Math.abs((v - s.mean) / s.std);
        if (z > Z) {
          this.anomalies.push({
            type: 'Z-Score Outlier',
            severity: z > 5 ? 'CRITICAL' : z > 4 ? 'WARNING' : 'CAUTION',
            parameter: param,
            paramLabel: lim?.label || param,
            value: +v.toFixed(2),
            expected: +s.mean.toFixed(2),
            zScore: +z.toFixed(2),
            unit: lim?.unit || '',
            missionTime: data[i].mission_time_s,
            index: i,
            description: `${lim?.label || param} z-score ${z.toFixed(1)} (value ${v.toFixed(1)} ${lim?.unit || ''}, nominal ${s.mean.toFixed(1)} ${lim?.unit || ''})`,
          });
        }
      }
    }
  }

  _detectRateOfChange(data) {
    const MULT = 5;
    for (const [param, s] of Object.entries(this.stats)) {
      const lim = REDLINE_LIMITS[param];
      const rocs = [];
      for (let i = 1; i < data.length; i++) {
        const a = data[i - 1][param], b = data[i][param];
        if (typeof a === 'number' && typeof b === 'number') rocs.push(Math.abs(b - a));
      }
      if (rocs.length === 0) continue;
      const avg = rocs.reduce((a, b) => a + b, 0) / rocs.length;
      const threshold = avg * MULT;
      if (threshold === 0) continue;

      for (let i = 1; i < data.length; i++) {
        const a = data[i - 1][param], b = data[i][param];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const roc = Math.abs(b - a);
        if (roc > threshold) {
          this.anomalies.push({
            type: 'Rapid Change',
            severity: roc > threshold * 3 ? 'CRITICAL' : roc > threshold * 2 ? 'WARNING' : 'CAUTION',
            parameter: param,
            paramLabel: lim?.label || param,
            value: +b.toFixed(2),
            previousValue: +a.toFixed(2),
            rateOfChange: +roc.toFixed(2),
            unit: lim?.unit || '',
            missionTime: data[i].mission_time_s,
            index: i,
            description: `Rapid ${b > a ? 'increase' : 'decrease'} in ${lim?.label || param}: delta ${roc.toFixed(1)} ${lim?.unit || ''}/s (avg ${avg.toFixed(2)})`,
          });
        }
      }
    }
  }

  _detectRedlineViolations(data) {
    for (const [param, lim] of Object.entries(REDLINE_LIMITS)) {
      for (let i = 0; i < data.length; i++) {
        const v = data[i][param];
        if (typeof v !== 'number') continue;
        let viol = null;
        if (v > lim.max) viol = { dir: 'HIGH', exc: +(v - lim.max).toFixed(2), limit: lim.max };
        else if (v < lim.min) viol = { dir: 'LOW', exc: +(lim.min - v).toFixed(2), limit: lim.min };
        if (viol) {
          const pct = (viol.exc / Math.abs(viol.limit || 1)) * 100;
          this.anomalies.push({
            type: 'Redline Violation',
            severity: pct > 10 ? 'CRITICAL' : pct > 5 ? 'WARNING' : 'CAUTION',
            parameter: param,
            paramLabel: lim.label,
            value: +v.toFixed(2),
            redlineLimit: viol.limit,
            exceedance: viol.exc,
            direction: viol.dir,
            percentOver: +pct.toFixed(2),
            unit: lim.unit,
            missionTime: data[i].mission_time_s,
            index: i,
            description: `${lim.label} ${viol.dir} redline: ${v.toFixed(1)} ${lim.unit} (limit ${viol.limit} ${lim.unit}, ${pct.toFixed(1)}% over)`,
          });
        }
      }
    }
  }

  _detectSustainedDeviations(data) {
    const WIN = 20;
    const SIG = 2.0;
    for (const [param, s] of Object.entries(this.stats)) {
      if (s.std === 0) continue;
      const lim = REDLINE_LIMITS[param];
      for (let i = WIN; i < data.length; i++) {
        const vals = data.slice(i - WIN, i).map(d => d[param]).filter(v => typeof v === 'number');
        if (vals.length < WIN * 0.8) continue;
        const wm = vals.reduce((a, b) => a + b, 0) / vals.length;
        const dev = Math.abs(wm - s.mean) / s.std;
        if (dev > SIG) {
          const dup = this.anomalies.find(a =>
            a.type === 'Sustained Deviation' && a.parameter === param && Math.abs(a.index - i) < WIN
          );
          if (!dup) {
            this.anomalies.push({
              type: 'Sustained Deviation',
              severity: dev > 4 ? 'CRITICAL' : dev > 3 ? 'WARNING' : 'CAUTION',
              parameter: param,
              paramLabel: lim?.label || param,
              value: +wm.toFixed(2),
              expected: +s.mean.toFixed(2),
              deviationSigma: +dev.toFixed(2),
              unit: lim?.unit || '',
              missionTime: data[i].mission_time_s,
              index: i,
              description: `Sustained ${dev.toFixed(1)} sigma deviation in ${lim?.label || param} over ${WIN}s window (mean ${wm.toFixed(1)}, nominal ${s.mean.toFixed(1)})`,
            });
          }
        }
      }
    }
  }

  _clusterAnomalies() {
    this.anomalies.sort((a, b) => a.missionTime - b.missionTime);
    const TIME_WIN = 10;
    let eid = 1;
    const used = new Set();
    this.events = [];

    for (let i = 0; i < this.anomalies.length; i++) {
      if (used.has(i)) continue;
      const ev = {
        id: `EVT-${String(eid).padStart(3, '0')}`,
        anomalies: [this.anomalies[i]],
        startTime: this.anomalies[i].missionTime,
        endTime: this.anomalies[i].missionTime,
      };
      used.add(i);
      for (let j = i + 1; j < this.anomalies.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(this.anomalies[j].missionTime - ev.startTime) < TIME_WIN) {
          ev.anomalies.push(this.anomalies[j]);
          ev.endTime = Math.max(ev.endTime, this.anomalies[j].missionTime);
          used.add(j);
        }
      }
      const sevs = ev.anomalies.map(a => a.severity);
      ev.severity = sevs.includes('CRITICAL') ? 'CRITICAL' : sevs.includes('WARNING') ? 'WARNING' : 'CAUTION';
      ev.affectedParams = [...new Set(ev.anomalies.map(a => a.paramLabel))];
      ev.anomalyTypes = [...new Set(ev.anomalies.map(a => a.type))];
      ev.count = ev.anomalies.length;
      this.events.push(ev);
      eid++;
    }
  }

  getSummary() {
    const total = this.anomalies.length;
    const bySeverity = { CRITICAL: 0, WARNING: 0, CAUTION: 0 };
    const byType = {};
    const byParam = {};
    for (const a of this.anomalies) {
      bySeverity[a.severity]++;
      byType[a.type] = (byType[a.type] || 0) + 1;
      byParam[a.paramLabel] = (byParam[a.paramLabel] || 0) + 1;
    }
    return {
      totalAnomalies: total,
      totalEvents: this.events?.length || 0,
      bySeverity,
      byType,
      byParameter: byParam,
      events: this.events || [],
      redlineLimits: REDLINE_LIMITS,
      missionEvents: MISSION_EVENTS,
    };
  }
}

module.exports = { AnomalyDetector, REDLINE_LIMITS, MISSION_EVENTS };
