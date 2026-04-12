import { LoadTestExporter, LoadTestRequestConfig, LoadTestValidationResult, SimulationConfig, SimulationResult } from '../../interfaces/types.js';
export declare class K6Exporter implements LoadTestExporter {
    readonly id: "k6";
    readonly name = "k6 (Grafana)";
    readonly extension = "js";
    generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, request: LoadTestRequestConfig, results?: SimulationResult): string;
    validate(config: SimulationConfig): LoadTestValidationResult;
    private buildScenarios;
    private steadyScenarios;
    private gradualScenarios;
    private spikeScenarios;
    private waveScenarios;
    private stepScenarios;
    private customScenarios;
    private buildThresholds;
    private estimatePeakRps;
    private formatValue;
    private escapeJsString;
}
