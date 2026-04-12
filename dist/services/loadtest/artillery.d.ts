import { LoadTestExporter, LoadTestRequestConfig, LoadTestValidationResult, SimulationConfig, SimulationResult } from '../../interfaces/types.js';
export declare class ArtilleryExporter implements LoadTestExporter {
    readonly id: "artillery";
    readonly name = "Artillery";
    readonly extension = "yml";
    generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, request: LoadTestRequestConfig, results?: SimulationResult): string;
    private replaceTemplateVars;
    private looksLikeJson;
    private escapeYamlString;
    private emitJsonAsYaml;
    validate(config: SimulationConfig): LoadTestValidationResult;
    private buildPhases;
    private steadyPhases;
    private gradualPhases;
    private spikePhases;
    private wavePhases;
    private stepPhases;
    private customPhases;
    private formatPhase;
    private estimatePeakRps;
}
