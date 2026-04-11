// ============================================================================
// scalings.xyz — Traffic Pattern Service
// ============================================================================
export class LocalTrafficPatternService {
    generate(traffic, duration, tickInterval) {
        const ticks = Math.ceil(duration / tickInterval);
        const result = [];
        for (let i = 0; i < ticks; i++) {
            const t = i * tickInterval;
            result.push(Math.max(0, this.getRPS(traffic, t, duration)));
        }
        return result;
    }
    preview(traffic, points = 100) {
        const duration = this.getPreviewDuration(traffic);
        const tickInterval = duration / points;
        return this.generate(traffic, duration, tickInterval);
    }
    getRPS(traffic, t, duration) {
        switch (traffic.pattern) {
            case 'steady':
                return this.steady(traffic.params);
            case 'gradual':
                return this.gradual(traffic.params, t, duration);
            case 'spike':
                return this.spike(traffic.params, t);
            case 'wave':
                return this.wave(traffic.params, t);
            case 'step':
                return this.step(traffic.params, t);
            case 'custom':
                return this.custom(traffic.params, t);
            default:
                return 0;
        }
    }
    steady(params) {
        return params.rps;
    }
    gradual(params, t, duration) {
        const progress = Math.min(t / duration, 1);
        return params.start_rps + (params.end_rps - params.start_rps) * progress;
    }
    spike(params, t) {
        if (t >= params.spike_start && t < params.spike_start + params.spike_duration) {
            return params.spike_rps;
        }
        return params.base_rps;
    }
    wave(params, t) {
        return params.base_rps + params.amplitude * Math.sin((2 * Math.PI * t) / params.period);
    }
    step(params, t) {
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
    custom(params, t) {
        const series = params.series;
        if (!series || series.length === 0)
            return 0;
        if (series.length === 1)
            return series[0].rps;
        // Find surrounding points and interpolate
        for (let i = 0; i < series.length - 1; i++) {
            if (t >= series[i].t && t <= series[i + 1].t) {
                const span = series[i + 1].t - series[i].t;
                if (span === 0)
                    return series[i].rps;
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
    getPreviewDuration(traffic) {
        switch (traffic.pattern) {
            case 'steady':
                return 60;
            case 'gradual':
                return 600;
            case 'spike': {
                const p = traffic.params;
                return p.spike_start + p.spike_duration + Math.max(60, p.spike_duration);
            }
            case 'wave': {
                const p = traffic.params;
                return p.period * 3;
            }
            case 'step': {
                const p = traffic.params;
                return p.steps.reduce((sum, s) => sum + s.duration, 0);
            }
            case 'custom': {
                const p = traffic.params;
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
export function parseGrafanaCSV(csv, valueUnit = 'rps') {
    const lines = csv.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2)
        throw new Error('CSV must have a header row and at least one data row');
    // Detect separator: semicolon, comma, or tab
    const header = lines[0];
    const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
    const headerCols = parseCsvRow(header, sep);
    // Identify column indices — case-insensitive, handle quoted headers
    const colNames = headerCols.map(c => c.toLowerCase().trim());
    const timeIdx = colNames.findIndex(c => c === 'time' || c === 'timestamp');
    if (timeIdx === -1)
        throw new Error('CSV must have a "Time" or "Timestamp" column');
    // Value column: explicit "Value"/"value" column, or first numeric column that isn't Time
    let valueIdx = colNames.findIndex(c => c === 'value' || c === 'values');
    if (valueIdx === -1) {
        // Pick the first column that isn't "time", "timestamp", or "series"/"name"
        valueIdx = colNames.findIndex((c, i) => i !== timeIdx && c !== 'series' && c !== 'name' && c !== 'metric');
    }
    if (valueIdx === -1)
        throw new Error('CSV must have at least one value column besides Time');
    // Parse data rows
    const raw = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i], sep);
        if (cols.length <= Math.max(timeIdx, valueIdx))
            continue;
        const tsRaw = cols[timeIdx].trim();
        const valRaw = cols[valueIdx].trim();
        const val = parseFloat(valRaw);
        if (isNaN(val))
            continue;
        const ts = parseTimestamp(tsRaw);
        if (ts === null)
            continue;
        const divisor = valueUnit === 'rpm' ? 60 : valueUnit === 'rph' ? 3600 : 1;
        raw.push({ ts, rps: Math.max(0, val / divisor) });
    }
    if (raw.length === 0)
        throw new Error('No valid data rows found in CSV');
    // Sort by timestamp and convert to relative seconds from t=0
    raw.sort((a, b) => a.ts - b.ts);
    const t0 = raw[0].ts;
    return raw.map(r => ({
        t: Math.round(r.ts - t0),
        rps: Math.round(r.rps * 100) / 100,
    }));
}
/** Parse a single CSV row respecting quoted fields. */
function parseCsvRow(row, sep) {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        }
        else if (ch === sep && !inQuotes) {
            cols.push(current);
            current = '';
        }
        else {
            current += ch;
        }
    }
    cols.push(current);
    return cols;
}
/** Parse a timestamp string into epoch seconds. */
function parseTimestamp(raw) {
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
//# sourceMappingURL=traffic.js.map