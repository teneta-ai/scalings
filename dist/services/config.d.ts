import { ConfigService, SimulationConfig } from '../interfaces/types.js';
export declare class LocalConfigService implements ConfigService {
    export(config: SimulationConfig): string;
    import(yaml: string): SimulationConfig;
    toURL(config: SimulationConfig): string;
    fromURL(hash: string): SimulationConfig;
    saveLocal(config: SimulationConfig): void;
    loadLocal(): SimulationConfig | null;
    private validateConfig;
    private validateSimulation;
    private validateScaling;
    private validateAdvanced;
    private validateTraffic;
    private num;
    private toYAML;
    private serializeTrafficParams;
    private fromYAML;
    private parseYAML;
    private parseValue;
    private escapeYAMLString;
}
