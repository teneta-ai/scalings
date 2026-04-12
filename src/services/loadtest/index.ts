// ============================================================================
// scalings.xyz — Load Test Export Service
// ============================================================================

import {
  LoadTestExportService,
  LoadTestExporter,
  LoadTestExportOptions,
  LoadTestFramework,
  LoadTestValidationResult,
  SimulationConfig,
  SimulationResult,
} from '../../interfaces/types.js';

import { K6Exporter } from './k6.js';
import { GatlingExporter } from './gatling.js';
import { LocustExporter } from './locust.js';
import { JMeterExporter } from './jmeter.js';
import { ArtilleryExporter } from './artillery.js';

export class LocalLoadTestExportService implements LoadTestExportService {
  private exporters: Map<LoadTestFramework, LoadTestExporter>;

  constructor() {
    this.exporters = new Map();
    this.registerExporter(new K6Exporter());
    this.registerExporter(new GatlingExporter());
    this.registerExporter(new LocustExporter());
    this.registerExporter(new JMeterExporter());
    this.registerExporter(new ArtilleryExporter());
  }

  private registerExporter(exporter: LoadTestExporter): void {
    this.exporters.set(exporter.id, exporter);
  }

  getExporter(framework: LoadTestFramework): LoadTestExporter {
    const exporter = this.exporters.get(framework);
    if (!exporter) {
      throw new Error(`Unknown load test framework: ${framework}`);
    }
    return exporter;
  }

  getAvailableFrameworks(): { id: LoadTestFramework; name: string }[] {
    return Array.from(this.exporters.values()).map(e => ({
      id: e.id,
      name: e.name,
    }));
  }

  generate(config: SimulationConfig, options: LoadTestExportOptions, results?: SimulationResult): string {
    const exporter = this.getExporter(options.framework);
    return exporter.generate(config, options.targetUrl, options.avgResponseTimeMs, options.request, results);
  }

  validate(config: SimulationConfig, framework: LoadTestFramework): LoadTestValidationResult {
    const exporter = this.getExporter(framework);
    return exporter.validate(config);
  }
}
