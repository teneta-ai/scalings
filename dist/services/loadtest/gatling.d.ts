import { LoadTestExporter, LoadTestValidationResult, SimulationConfig, SimulationResult } from '../../interfaces/types.js';
export declare class GatlingExporter implements LoadTestExporter {
    readonly id: "gatling";
    readonly name = "Gatling";
    readonly extension = "java";
    generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, results?: SimulationResult): string;
    validate(config: SimulationConfig): LoadTestValidationResult;
    private buildInjection;
    private steadyInjection;
    private gradualInjection;
    private spikeInjection;
    private waveInjection;
    private stepInjection;
    private customInjection;
    private buildAssertions;
    private estimatePeakRps;
}
