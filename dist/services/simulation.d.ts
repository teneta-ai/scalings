import { SimulationService, SimulationConfig, SimulationResult, TrafficPatternService } from '../interfaces/types.js';
export declare class LocalSimulationService implements SimulationService {
    private trafficService;
    constructor(trafficService?: TrafficPatternService);
    /** Simple seeded PRNG (mulberry32). Returns a function that produces values in [0, 1). */
    private createRng;
    run(config: SimulationConfig): Promise<SimulationResult>;
    /**
     * Determines how overflow traffic is handled for a single tick.
     * OLTP mode: excess is dropped immediately.
     * Queue mode: excess is buffered, only dropped when queue is full.
     */
    private resolveOverflow;
    private calculateSummary;
}
