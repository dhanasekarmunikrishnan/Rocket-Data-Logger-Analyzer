/**
 * CSV Parser Service
 * Parses rocket telemetry CSV files into structured data
 */

const fs = require('fs');
const csv = require('csv-parser');

class CSVParser {
  /**
   * Parse a CSV file and return structured telemetry data
   */
  static async parseFile(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          // Convert numeric fields
          const parsed = {};
          for (const [key, value] of Object.entries(row)) {
            const num = parseFloat(value);
            parsed[key] = isNaN(num) ? value : num;
          }
          results.push(parsed);
        })
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  /**
   * Get parameter statistics
   */
  static getStats(data, paramName) {
    const values = data.map(d => d[paramName]).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length === 0) return null;

    values.sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);

    return {
      parameter: paramName,
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      mean: parseFloat(mean.toFixed(4)),
      std: parseFloat(std.toFixed(4)),
      median: values[Math.floor(values.length / 2)],
      q1: values[Math.floor(values.length * 0.25)],
      q3: values[Math.floor(values.length * 0.75)],
      iqr: values[Math.floor(values.length * 0.75)] - values[Math.floor(values.length * 0.25)],
    };
  }

  /**
   * Get all numeric column names
   */
  static getNumericColumns(data) {
    if (data.length === 0) return [];
    return Object.keys(data[0]).filter(key => {
      return typeof data[0][key] === 'number' && key !== 'mission_time_s';
    });
  }

  /**
   * Downsample data for visualization (every nth point)
   */
  static downsample(data, maxPoints = 1000) {
    if (data.length <= maxPoints) return data;
    const step = Math.ceil(data.length / maxPoints);
    return data.filter((_, i) => i % step === 0);
  }
}

module.exports = CSVParser;
