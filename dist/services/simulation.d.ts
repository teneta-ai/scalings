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
     * Broker mode: excess is buffered, only dropped when broker is full.
     */
    private resolveOverflow;
    /**
     * Reduces effective capacity when queue depth exceeds the backpressure threshold.
     * Models real-world degradation from memory pressure, GC pauses, and context switching
     * under deep queue conditions. Degradation is linear from threshold to 2x threshold.
     */
    private applyBackpressure;
    /**
     * Expires queued requests that have been waiting longer than the configured timeout.
     * Uses Little's Law: wait_time = queue_depth / capacity.
     * Returns the number of requests expired.
     */
    private expireQueuedRequests;
    private calculateSummary;
}
