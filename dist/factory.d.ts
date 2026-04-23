import { SimulationService, ConfigService, ExportService, TrafficPatternService, LoadTestExportService, UserContextService } from './interfaces/types.js';
export interface ServiceContainer {
    simulation: SimulationService;
    config: ConfigService;
    export: ExportService;
    traffic: TrafficPatternService;
    loadTestExport: LoadTestExportService;
    userContext: UserContextService;
}
export declare function createServices(): ServiceContainer;
