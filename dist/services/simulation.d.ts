import { SimulationService, SimulationConfig, SimulationResult, TrafficPatternService } from '../interfaces/types.js';
export declare class LocalSimulationService implements SimulationService {
    private trafficService;
    constructor(trafficService?: TrafficPatternService);
    run(config: SimulationConfig): Promise<SimulationResult>;
    private calculateSummary;
}
