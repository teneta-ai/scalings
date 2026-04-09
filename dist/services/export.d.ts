import { ExportService, SimulationConfig, TargetConfig } from '../interfaces/types.js';
export declare class LocalExportService implements ExportService {
    generate(config: SimulationConfig): TargetConfig;
    private generateKubernetes;
    private generateAWS;
    private generateGCP;
    private generateCustom;
}
