import { LoadTestExporter, LoadTestValidationResult, SimulationConfig, SimulationResult } from '../../interfaces/types.js';
export declare class LocustExporter implements LoadTestExporter {
    readonly id: "locust";
    readonly name = "Locust";
    readonly extension = "py";
    generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, results?: SimulationResult): string;
    validate(config: SimulationConfig): LoadTestValidationResult;
    private buildShape;
    private gradualShape;
    private spikeShape;
    private waveShape;
    private stepShape;
    private customShape;
    private rpsToUsers;
    private estimatePeakRps;
}
