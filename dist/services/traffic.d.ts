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
 *
 * @param csv      Raw CSV text
 * @param valueUnit Unit of the value column: 'rps' (default), 'rpm', or 'rph'.
 *                  Non-RPS values are divided by 60 or 3600 to convert to RPS.
 */
export declare function parseGrafanaCSV(csv: string, valueUnit?: 'rps' | 'rpm' | 'rph'): CustomTimePoint[];
export interface CsvUnitGuess {
    unit: 'rps' | 'rpm' | 'rph';
    reason: string;
}
/**
 * Guess the value unit of a Grafana CSV based on the column name and value magnitudes.
 * Returns a guess with a human-readable reason. The caller should display the reason
 * and let the user override if wrong.
 */
export declare function detectCsvValueUnit(csv: string): CsvUnitGuess;
