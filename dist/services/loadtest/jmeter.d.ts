import { LoadTestExporter, LoadTestValidationResult, SimulationConfig, SimulationResult } from '../../interfaces/types.js';
export declare class JMeterExporter implements LoadTestExporter {
    readonly id: "jmeter";
    readonly name = "JMeter";
    readonly extension = "jmx";
    generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, results?: SimulationResult): string;
    validate(config: SimulationConfig): LoadTestValidationResult;
    private buildThreadGroups;
    private wrapThreadGroup;
    private wrapUltimateThreadGroup;
    private rpsToThreads;
    private steadyThreadGroup;
    private gradualThreadGroup;
    private spikeThreadGroup;
    private waveThreadGroup;
    private stepThreadGroup;
    private customThreadGroup;
    private buildAssertions;
    private estimatePeakRps;
    private escapeXml;
}
