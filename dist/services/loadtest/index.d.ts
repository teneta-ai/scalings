import { LoadTestExportService, LoadTestExporter, LoadTestExportOptions, LoadTestFramework, LoadTestValidationResult, SimulationConfig, SimulationResult } from '../../interfaces/types.js';
export declare class LocalLoadTestExportService implements LoadTestExportService {
    private exporters;
    constructor();
    private registerExporter;
    getExporter(framework: LoadTestFramework): LoadTestExporter;
    getAvailableFrameworks(): {
        id: LoadTestFramework;
        name: string;
    }[];
    generate(config: SimulationConfig, options: LoadTestExportOptions, results?: SimulationResult): string;
    validate(config: SimulationConfig, framework: LoadTestFramework): LoadTestValidationResult;
}
