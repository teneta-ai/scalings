// ============================================================================
// scalings.xyz — Load Test Export Service
// ============================================================================
import { K6Exporter } from './k6.js';
import { GatlingExporter } from './gatling.js';
import { LocustExporter } from './locust.js';
import { JMeterExporter } from './jmeter.js';
import { ArtilleryExporter } from './artillery.js';
export class LocalLoadTestExportService {
    constructor() {
        this.exporters = new Map();
        this.registerExporter(new K6Exporter());
        this.registerExporter(new GatlingExporter());
        this.registerExporter(new LocustExporter());
        this.registerExporter(new JMeterExporter());
        this.registerExporter(new ArtilleryExporter());
    }
    registerExporter(exporter) {
        this.exporters.set(exporter.id, exporter);
    }
    getExporter(framework) {
        const exporter = this.exporters.get(framework);
        if (!exporter) {
            throw new Error(`Unknown load test framework: ${framework}`);
        }
        return exporter;
    }
    getAvailableFrameworks() {
        return Array.from(this.exporters.values()).map(e => ({
            id: e.id,
            name: e.name,
        }));
    }
    generate(config, options, results) {
        const exporter = this.getExporter(options.framework);
        return exporter.generate(config, options.targetUrl, options.avgResponseTimeMs, results);
    }
    validate(config, framework) {
        const exporter = this.getExporter(framework);
        return exporter.validate(config);
    }
}
//# sourceMappingURL=index.js.map