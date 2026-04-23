// ============================================================================
// scalings.xyz — Service Factory
// ============================================================================
// Single place that decides which implementation of each service to use.
// Today: all local/browser implementations.
// Tomorrow: swap simulation to a remote API call, update here, nothing else changes.
import { LocalSimulationService } from './services/simulation.js';
import { LocalConfigService } from './services/config.js';
import { LocalExportService } from './services/export.js';
import { LocalTrafficPatternService } from './services/traffic.js';
import { LocalLoadTestExportService } from './services/loadtest/index.js';
import { LocalUserContextService } from './services/context.js';
export function createServices() {
    const traffic = new LocalTrafficPatternService();
    const simulation = new LocalSimulationService(traffic);
    const config = new LocalConfigService();
    const exportService = new LocalExportService();
    const loadTestExport = new LocalLoadTestExportService();
    const userContext = new LocalUserContextService();
    return {
        simulation,
        config,
        export: exportService,
        traffic,
        loadTestExport,
        userContext,
    };
}
//# sourceMappingURL=factory.js.map