// ============================================================================
// scalings.xyz — Service Factory
// ============================================================================
// Single place that decides which implementation of each service to use.
// Today: all local/browser implementations.
// Tomorrow: swap simulation to a remote API call, update here, nothing else changes.

import {
  SimulationService,
  ConfigService,
  ExportService,
  TrafficPatternService,
} from './interfaces/types.js';
import { LocalSimulationService } from './services/simulation.js';
import { LocalConfigService } from './services/config.js';
import { LocalExportService } from './services/export.js';
import { LocalTrafficPatternService } from './services/traffic.js';

export interface ServiceContainer {
  simulation: SimulationService;
  config: ConfigService;
  export: ExportService;
  traffic: TrafficPatternService;
}

export function createServices(): ServiceContainer {
  const traffic = new LocalTrafficPatternService();
  const simulation = new LocalSimulationService(traffic);
  const config = new LocalConfigService();
  const exportService = new LocalExportService();

  return {
    simulation,
    config,
    export: exportService,
    traffic,
  };
}
