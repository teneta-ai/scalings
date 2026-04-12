import { SimulationService, ConfigService, ExportService, TrafficPatternService, LoadTestExportService } from './interfaces/types.js';
export interface ServiceContainer {
    simulation: SimulationService;
    config: ConfigService;
    export: ExportService;
    traffic: TrafficPatternService;
    loadTestExport: LoadTestExportService;
}
export declare function createServices(): ServiceContainer;
