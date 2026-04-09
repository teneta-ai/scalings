import { SimulationService, ConfigService, ExportService, TrafficPatternService } from './interfaces/types.js';
export interface ServiceContainer {
    simulation: SimulationService;
    config: ConfigService;
    export: ExportService;
    traffic: TrafficPatternService;
}
export declare function createServices(): ServiceContainer;
