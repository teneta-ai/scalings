// ============================================================================
// scalings.xyz — Traffic Pattern Service
// ============================================================================

import {
  TrafficPatternService,
  TrafficConfig,
  SteadyParams,
  GradualParams,
  SpikeParams,
  WaveParams,
  StepParams,
  CustomParams,
  CustomTimePoint,
  GrafanaParams,
} from '../interfaces/types.js';

export class LocalTrafficPatternService implements TrafficPatternService {
  generate(traffic: TrafficConfig, duration: number, tickInterval: number): number[] {
    const ticks = Math.ceil(duration / tickInterval);
    const result: number[] = [];

    for (let i = 0; i < ticks; i++) {
      const t = i * tickInterval;
      result.push(Math.max(0, this.getRPS(traffic, t, duration)));
    }

    return result;
  }

  preview(traffic: TrafficConfig, points: number = 100): number[] {
    const duration = this.getPreviewDuration(traffic);
    const tickInterval = duration / points;
    return this.generate(traffic, duration, tickInterval);
  }

  private getRPS(traffic: TrafficConfig, t: number, duration: number): number {
    switch (traffic.pattern) {
      case 'steady':
        return this.steady(traffic.params as SteadyParams);
      case 'gradual':
        return this.gradual(traffic.params as GradualParams, t, duration);
      case 'spike':
        return this.spike(traffic.params as SpikeParams, t);
      case 'wave':
        return this.wave(traffic.params as WaveParams, t);
      case 'step':
        return this.step(traffic.params as StepParams, t);
      case 'custom':
        return this.custom(traffic.params as CustomParams, t);
      case 'grafana':
        return this.custom(traffic.params as GrafanaParams, t);
      default:
        return 0;
    }
  }

  private steady(params: SteadyParams): number {
    return params.rps;
  }

  private gradual(params: GradualParams, t: number, duration: number): number {
    const progress = Math.min(t / duration, 1);
    return params.start_rps + (params.end_rps - params.start_rps) * progress;
  }

  private spike(params: SpikeParams, t: number): number {
    if (t >= params.spike_start && t < params.spike_start + params.spike_duration) {
      return params.spike_rps;
    }
    return params.base_rps;
  }

  private wave(params: WaveParams, t: number): number {
    return params.base_rps + params.amplitude * Math.sin((2 * Math.PI * t) / params.period);
  }

  private step(params: StepParams, t: number): number {
    let elapsed = 0;
    for (const s of params.steps) {
      if (t < elapsed + s.duration) {
        return s.rps;
      }
      elapsed += s.duration;
    }
    // After all steps, hold the last value
    return params.steps.length > 0 ? params.steps[params.steps.length - 1].rps : 0;
  }

  private custom(params: CustomParams, t: number): number {
    const series = params.series;
    if (!series || series.length === 0) return 0;
    if (series.length === 1) return series[0].rps;

    // Find surrounding points and interpolate
    for (let i = 0; i < series.length - 1; i++) {
      if (t >= series[i].t && t <= series[i + 1].t) {
        const span = series[i + 1].t - series[i].t;
        if (span === 0) return series[i].rps;
        const progress = (t - series[i].t) / span;
        return series[i].rps + (series[i + 1].rps - series[i].rps) * progress;
      }
    }

    // Beyond the last point, hold the last value
    if (t >= series[series.length - 1].t) {
      return series[series.length - 1].rps;
    }

    return series[0].rps;
  }

  private getPreviewDuration(traffic: TrafficConfig): number {
    switch (traffic.pattern) {
      case 'steady':
        return 60;
      case 'gradual':
        return 600;
      case 'spike': {
        const p = traffic.params as SpikeParams;
        return p.spike_start + p.spike_duration + Math.max(60, p.spike_duration);
      }
      case 'wave': {
        const p = traffic.params as WaveParams;
        return p.period * 3;
      }
      case 'step': {
        const p = traffic.params as StepParams;
        return p.steps.reduce((sum, s) => sum + s.duration, 0);
      }
      case 'custom': {
        const p = traffic.params as CustomParams;
        if (p.series && p.series.length > 0) {
          return p.series[p.series.length - 1].t;
        }
        return 600;
      }
      case 'grafana': {
        const p = traffic.params as GrafanaParams;
        if (p.series && p.series.length > 0) {
          return p.series[p.series.length - 1].t;
        }
        return 600;
      }
      default:
        return 600;
    }
  }
}

// ============================================================================
// Grafana CSV Import — parse exported time-series into CustomTimePoint[]
// ============================================================================

/**
 * Parse a Grafana-exported CSV into CustomTimePoint[].
 * Supports common Grafana export formats:
 *   - "Series;Time;Value" (panel CSV download, semicolon-separated)
 *   - "Time,Value" or "Time,MetricName" (Inspect → Data → Download CSV)
 *   - Tab-separated variants
 * Timestamps: epoch milliseconds, epoch seconds, or ISO 8601 strings.
 * Values are converted to relative seconds from the first data point.
 * Negative RPS values are clamped to 0.
 *
 * @param csv      Raw CSV text
 * @param valueUnit Unit of the value column: 'rps' (default), 'rpm', or 'rph'.
 *                  Non-RPS values are divided by 60 or 3600 to convert to RPS.
 */
export function parseGrafanaCSV(csv: string, valueUnit: 'rps' | 'rpm' | 'rph' = 'rps'): CustomTimePoint[] {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  // Detect separator: semicolon, comma, or tab
  const header = lines[0];
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
  const headerCols = parseCsvRow(header, sep);

  // Identify column indices — case-insensitive, handle quoted headers
  const colNames = headerCols.map(c => c.toLowerCase().trim());
  const timeIdx = colNames.findIndex(c => c === 'time' || c === 'timestamp');
  if (timeIdx === -1) throw new Error('CSV must have a "Time" or "Timestamp" column');

  // Value column: explicit "Value"/"value" column, or first numeric column that isn't Time
  let valueIdx = colNames.findIndex(c => c === 'value' || c === 'values');
  if (valueIdx === -1) {
    // Pick the first column that isn't "time", "timestamp", or "series"/"name"
    valueIdx = colNames.findIndex((c, i) => i !== timeIdx && c !== 'series' && c !== 'name' && c !== 'metric');
  }
  if (valueIdx === -1) throw new Error('CSV must have at least one value column besides Time');

  // Parse data rows
  const raw: { ts: number; rps: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i], sep);
    if (cols.length <= Math.max(timeIdx, valueIdx)) continue;

    const tsRaw = cols[timeIdx].trim();
    const valRaw = cols[valueIdx].trim();
    const val = parseHumanValue(valRaw);
    if (isNaN(val)) continue;

    const ts = parseTimestamp(tsRaw);
    if (ts === null) continue;

    const divisor = valueUnit === 'rpm' ? 60 : valueUnit === 'rph' ? 3600 : 1;
    raw.push({ ts, rps: Math.max(0, val / divisor) });
  }

  if (raw.length === 0) throw new Error('No valid data rows found in CSV');

  // Sort by timestamp and convert to relative seconds from t=0
  raw.sort((a, b) => a.ts - b.ts);
  const t0 = raw[0].ts;

  return raw.map(r => ({
    t: Math.round(r.ts - t0),
    rps: Math.round(r.rps * 100) / 100,
  }));
}

export interface CsvUnitGuess {
  unit: 'rps' | 'rpm' | 'rph';
  reason: string;
}

/**
 * Guess the value unit of a Grafana CSV based on the column name and value magnitudes.
 * Returns a guess with a human-readable reason. The caller should display the reason
 * and let the user override if wrong.
 */
export function detectCsvValueUnit(csv: string): CsvUnitGuess {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { unit: 'rps', reason: 'too few rows to guess' };

  const header = lines[0];
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
  const headerCols = parseCsvRow(header, sep);
  const colNames = headerCols.map(c => c.toLowerCase().trim());

  const timeIdx = colNames.findIndex(c => c === 'time' || c === 'timestamp');
  if (timeIdx === -1) return { unit: 'rps', reason: 'no Time column found' };

  let valueIdx = colNames.findIndex(c => c === 'value' || c === 'values');
  if (valueIdx === -1) {
    valueIdx = colNames.findIndex((c, i) => i !== timeIdx && c !== 'series' && c !== 'name' && c !== 'metric');
  }
  if (valueIdx === -1) return { unit: 'rps', reason: 'no value column found' };

  // --- Heuristic 1: Column name keywords ---
  const colName = colNames[valueIdx];
  const rphPatterns = /(?:^|[_.\s/])rph(?:$|[_.\s])|per[_.\s]?hour|\/h(?:our)?(?:$|[_.\s])/;
  const rpmPatterns = /(?:^|[_.\s/])rpm(?:$|[_.\s])|per[_.\s]?min|\/min/;
  const rpsPatterns = /(?:^|[_.\s/])rps(?:$|[_.\s])|per[_.\s]?sec|\/s(?:ec)?(?:$|[_.\s])/;

  if (rphPatterns.test(colName)) {
    return { unit: 'rph', reason: `column "${headerCols[valueIdx].trim()}" suggests requests/hour` };
  }
  if (rpmPatterns.test(colName)) {
    return { unit: 'rpm', reason: `column "${headerCols[valueIdx].trim()}" suggests requests/min` };
  }
  if (rpsPatterns.test(colName)) {
    return { unit: 'rps', reason: `column "${headerCols[valueIdx].trim()}" suggests requests/sec` };
  }

  // --- Heuristic 2: Unit suffix in value strings (e.g. "40.0K ops/m") ---
  // Check a few data rows for a consistent unit suffix
  const suffixSampleLimit = Math.min(lines.length, 6);
  for (let i = 1; i < suffixSampleLimit; i++) {
    const cols = parseCsvRow(lines[i], sep);
    if (cols.length <= valueIdx) continue;
    const suffixUnit = detectUnitFromValueSuffix(cols[valueIdx]);
    if (suffixUnit) {
      const unitLabels = { rps: 'requests/sec', rpm: 'requests/min', rph: 'requests/hour' };
      return { unit: suffixUnit, reason: `value suffix suggests ${unitLabels[suffixUnit]}` };
    }
  }

  // --- Heuristic 3: Value magnitude ---
  // Sample up to 100 values to compute the median (using parseHumanValue for SI suffixes)
  const values: number[] = [];
  const sampleLimit = Math.min(lines.length, 101);
  for (let i = 1; i < sampleLimit; i++) {
    const cols = parseCsvRow(lines[i], sep);
    if (cols.length <= valueIdx) continue;
    const val = parseHumanValue(cols[valueIdx].trim());
    if (!isNaN(val) && val > 0) values.push(val);
  }

  if (values.length === 0) return { unit: 'rps', reason: 'no numeric values to analyze' };

  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];

  // Conservative thresholds: only guess non-RPS when values are clearly too large
  // A typical service might do 1–10,000 RPS; RPM values would be 60–600,000
  if (median > 100_000) {
    return { unit: 'rph', reason: `median value ${Math.round(median).toLocaleString()} suggests requests/hour` };
  }
  if (median > 5_000) {
    return { unit: 'rpm', reason: `median value ${Math.round(median).toLocaleString()} suggests requests/min` };
  }

  return { unit: 'rps', reason: 'values look like requests/sec' };
}

/**
 * Parse a human-readable numeric value that may include SI suffixes and unit text.
 * Examples: "40.0K ops/m" → 40000, "104K" → 104000, "119 ops/m" → 119,
 *           "1.07K ops/m" → 1070, "2.5M" → 2500000
 * Returns NaN if no number can be parsed.
 */
export function parseHumanValue(raw: string): number {
  const trimmed = raw.trim();
  // Match: optional sign, digits with optional decimal, optional SI suffix, optional trailing text
  const m = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*([KMBT])?/i);
  if (!m) return NaN;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return NaN;
  const suffix = (m[2] || '').toUpperCase();
  const multipliers: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return num * (multipliers[suffix] || 1);
}

/**
 * Detect a rate unit from a value string's suffix text.
 * E.g. "40.0K ops/m" → 'rpm', "500 req/s" → 'rps', "1.2K ops/h" → 'rph'.
 * Returns null if no unit suffix is detected.
 */
export function detectUnitFromValueSuffix(raw: string): 'rps' | 'rpm' | 'rph' | null {
  const trimmed = raw.trim();
  // Strip leading number and optional SI suffix
  const rest = trimmed.replace(/^[+-]?\d+(?:\.\d+)?\s*[KMBT]?\s*/i, '').toLowerCase();
  if (!rest) return null;
  // Slash-based: ops/s, req/min, events/h, r/s, w/s, etc.
  if (/\/h(?:r|our)?$|per\s*h(?:r|our)?/.test(rest)) return 'rph';
  if (/\/m(?:in)?$|per\s*m(?:in)?/.test(rest)) return 'rpm';
  if (/\/s(?:ec)?$|per\s*s(?:ec)?/.test(rest)) return 'rps';
  // Standalone abbreviations: rps, qps, cps, eps, wps, mps, iops, rpm, rph
  if (/(?:^|[\s/])(?:[rqcew]ps|iops)$/.test(rest)) return 'rps';
  if (/(?:^|[\s/])(?:rpm|qpm)$/.test(rest)) return 'rpm';
  if (/(?:^|[\s/])(?:rph|qph)$/.test(rest)) return 'rph';
  return null;
}

/** Parse a single CSV row respecting quoted fields. */
function parseCsvRow(row: string, sep: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

/** Parse a timestamp string into epoch seconds. */
function parseTimestamp(raw: string): number | null {
  // Try numeric (epoch ms or epoch seconds)
  const num = Number(raw);
  if (!isNaN(num) && isFinite(num)) {
    // If > 1e12 it's milliseconds, else seconds
    return num > 1e12 ? num / 1000 : num;
  }
  // Try ISO 8601 / date string
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.getTime() / 1000;
  }
  return null;
}
