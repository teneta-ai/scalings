import { TrafficPatternService, TrafficConfig, CustomTimePoint } from '../interfaces/types.js';
export declare class LocalTrafficPatternService implements TrafficPatternService {
    generate(traffic: TrafficConfig, duration: number, tickInterval: number): number[];
    preview(traffic: TrafficConfig, points?: number): number[];
    private getRPS;
    private steady;
    private gradual;
    private spike;
    private wave;
    private step;
    private custom;
    private getPreviewDuration;
}
/**
 * Parse a Grafana-exported CSV into CustomTimePoint[].
 * Supports common Grafana export formats:
 *   - "Series;Time;Value" (panel CSV download, semicolon-separated)
 *   - "Time,Value" or "Time,MetricName" (Inspect → Data → Download CSV)
 *   - Tab-separated variants
 * Timestamps: epoch milliseconds, epoch seconds, or ISO 8601 strings.
 * Values are converted to relative seconds from the first data point.
 * Negative RPS values are clamped to 0.
 */
export declare function parseGrafanaCSV(csv: string): CustomTimePoint[];
