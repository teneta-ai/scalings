import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalConfigService } from '../services/config.js';
import { DEFAULT_CONFIG, DEFAULT_SERVICE, DEFAULT_BROKER, DEFAULT_PRODUCER, } from '../interfaces/types.js';
const svc = new LocalConfigService();
function makeConfig(overrides = {}) {
    return { ...DEFAULT_CONFIG, ...overrides };
}
// ---------------------------------------------------------------------------
// YAML export / import round-trip
// ---------------------------------------------------------------------------
describe('ConfigService — YAML round-trip', () => {
    it('exports and re-imports a default config', () => {
        const yaml = svc.export(DEFAULT_CONFIG);
        const imported = svc.import(yaml);
        assert.equal(imported.version, DEFAULT_CONFIG.version);
        assert.equal(imported.platform, DEFAULT_CONFIG.platform);
        assert.equal(imported.service.min_replicas, DEFAULT_CONFIG.service.min_replicas);
        assert.equal(imported.service.max_replicas, DEFAULT_CONFIG.service.max_replicas);
        assert.equal(imported.service.cooldown_scale_up, DEFAULT_CONFIG.service.cooldown_scale_up);
    });
    it('preserves config name with special characters', () => {
        const config = makeConfig({ name: 'Test Black Friday load' });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.name, 'Test Black Friday load');
    });
    it('preserves platform setting', () => {
        const config = makeConfig({ platform: 'aws-asg' });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.platform, 'aws-asg');
    });
    it('preserves traffic pattern — spike', () => {
        const config = makeConfig({
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'spike',
                    params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 },
                },
            },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.producer.traffic.pattern, 'spike');
        const params = imported.producer.traffic.params;
        assert.equal(params.base_rps, 200);
        assert.equal(params.spike_rps, 2000);
        assert.equal(params.spike_start, 120);
        assert.equal(params.spike_duration, 60);
    });
    it('preserves traffic pattern — steady', () => {
        const config = makeConfig({
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: { pattern: 'steady', params: { rps: 500 } },
            },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.producer.traffic.pattern, 'steady');
        assert.equal(imported.producer.traffic.params.rps, 500);
    });
    it('preserves all service scaling parameters', () => {
        const config = makeConfig({
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 5,
                max_replicas: 100,
                scale_up_threshold: 80,
                scale_down_threshold: 20,
                capacity_per_replica: 250,
                startup_time: 45,
                scale_up_step: 3,
                scale_down_step: 2,
            },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.service.min_replicas, 5);
        assert.equal(imported.service.max_replicas, 100);
        assert.equal(imported.service.scale_up_threshold, 80);
        assert.equal(imported.service.scale_down_threshold, 20);
        assert.equal(imported.service.capacity_per_replica, 250);
        assert.equal(imported.service.startup_time, 45);
        assert.equal(imported.service.scale_up_step, 3);
        assert.equal(imported.service.scale_down_step, 2);
    });
    it('preserves all service advanced parameters', () => {
        const config = makeConfig({
            service: {
                ...DEFAULT_SERVICE,
                metric_observation_delay: 30,
                cooldown_scale_up: 120,
                cooldown_scale_down: 600,
                node_provisioning_time: 60,
                cluster_node_capacity: 50,
                pods_per_node: 8,
                graceful_shutdown_time: 20,
                cost_per_replica_hour: 0.10,
            },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.service.metric_observation_delay, 30);
        assert.equal(imported.service.cooldown_scale_up, 120);
        assert.equal(imported.service.cooldown_scale_down, 600);
        assert.equal(imported.service.node_provisioning_time, 60);
        assert.equal(imported.service.cluster_node_capacity, 50);
        assert.equal(imported.service.pods_per_node, 8);
        assert.equal(imported.service.graceful_shutdown_time, 20);
        assert.equal(imported.service.cost_per_replica_hour, 0.10);
    });
    it('preserves broker config', () => {
        const config = makeConfig({
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 5000 },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.broker.enabled, true);
        assert.equal(imported.broker.max_size, 5000);
    });
    it('preserves broker config with unlimited size', () => {
        const config = makeConfig({
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.broker.enabled, true);
        assert.equal(imported.broker.max_size, 0);
    });
    it('preserves broker disabled state', () => {
        const config = makeConfig({
            broker: { ...DEFAULT_BROKER, enabled: false, max_size: 1000 },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.broker.enabled, false);
        assert.equal(imported.broker.max_size, 1000);
    });
    it('preserves saturation, broker, and client config', () => {
        const config = makeConfig({
            broker: {
                enabled: true,
                max_size: 5000,
                request_timeout_ms: 10000,
            },
            service: {
                ...DEFAULT_SERVICE,
                saturation_threshold: 85,
                max_capacity_reduction: 0.4,
            },
            client: {
                max_retries: 3,
                retry_delay: 2,
                retry_strategy: 'exponential-jitter',
            },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.broker.enabled, true);
        assert.equal(imported.broker.max_size, 5000);
        assert.equal(imported.broker.request_timeout_ms, 10000);
        assert.equal(imported.service.saturation_threshold, 85);
        assert.equal(imported.service.max_capacity_reduction, 0.4);
        assert.equal(imported.client.max_retries, 3);
        assert.equal(imported.client.retry_delay, 2);
        assert.equal(imported.client.retry_strategy, 'exponential-jitter');
    });
    it('preserves chaos config with failure events', () => {
        const config = makeConfig({
            service: {
                ...DEFAULT_SERVICE,
                pod_failure_rate: 2.5,
                random_seed: 42,
                failure_events: [
                    { time: 60, count: 3 },
                    { time: 180, count: 5 },
                ],
            },
        });
        const yaml = svc.export(config);
        const imported = svc.import(yaml);
        assert.equal(imported.service.pod_failure_rate, 2.5);
        assert.equal(imported.service.random_seed, 42);
        assert.equal(imported.service.failure_events.length, 2);
        assert.equal(imported.service.failure_events[0].time, 60);
        assert.equal(imported.service.failure_events[0].count, 3);
        assert.equal(imported.service.failure_events[1].time, 180);
        assert.equal(imported.service.failure_events[1].count, 5);
    });
});
// ---------------------------------------------------------------------------
// YAML export format
// ---------------------------------------------------------------------------
describe('ConfigService — YAML export format', () => {
    it('starts with version header comment', () => {
        const yaml = svc.export(DEFAULT_CONFIG);
        assert.ok(yaml.startsWith('# scalings.xyz simulator config v2'));
    });
    it('contains version field', () => {
        const yaml = svc.export(DEFAULT_CONFIG);
        assert.ok(yaml.includes('version: 2'));
    });
    it('contains all top-level sections', () => {
        const yaml = svc.export(DEFAULT_CONFIG);
        assert.ok(yaml.includes('simulation:'));
        assert.ok(yaml.includes('producer:'));
        assert.ok(yaml.includes('broker:'));
        assert.ok(yaml.includes('service:'));
    });
});
// ---------------------------------------------------------------------------
// URL encoding / decoding
// ---------------------------------------------------------------------------
describe('ConfigService — URL encoding', () => {
    it('encodes and decodes a config via URL hash', () => {
        const config = makeConfig({ name: 'URL Test' });
        const hash = svc.toURL(config);
        assert.ok(hash.startsWith('#config='));
        const decoded = svc.fromURL(hash);
        assert.equal(decoded.name, 'URL Test');
        assert.equal(decoded.platform, config.platform);
        assert.equal(decoded.service.min_replicas, config.service.min_replicas);
    });
    it('throws on invalid URL hash', () => {
        assert.throws(() => svc.fromURL('#nope=abc'), /No config found/);
    });
    it('round-trips all parameters', () => {
        const config = makeConfig({
            name: 'Full round trip',
            platform: 'gcp-mig',
            service: { ...DEFAULT_SERVICE, min_replicas: 7, max_replicas: 77 },
        });
        const decoded = svc.fromURL(svc.toURL(config));
        assert.equal(decoded.platform, 'gcp-mig');
        assert.equal(decoded.service.min_replicas, 7);
        assert.equal(decoded.service.max_replicas, 77);
    });
});
// ---------------------------------------------------------------------------
// Validation / defaults
// ---------------------------------------------------------------------------
describe('ConfigService — import validation', () => {
    it('returns defaults for empty YAML', () => {
        const config = svc.import('version: 2\nname: "empty"');
        assert.equal(config.version, 2);
        assert.equal(config.service.min_replicas, DEFAULT_CONFIG.service.min_replicas);
        assert.equal(config.service.cooldown_scale_up, DEFAULT_CONFIG.service.cooldown_scale_up);
    });
    it('falls back to defaults for invalid platform', () => {
        const config = svc.import('version: 2\nname: "test"\nplatform: invalid-platform');
        assert.equal(config.platform, DEFAULT_CONFIG.platform);
    });
    it('falls back to defaults for missing broker config', () => {
        const config = svc.import('version: 2\nname: "no broker"');
        assert.equal(config.broker.enabled, DEFAULT_CONFIG.broker.enabled);
        assert.equal(config.broker.max_size, DEFAULT_CONFIG.broker.max_size);
    });
    it('falls back to defaults for missing numeric values', () => {
        const yaml = `version: 2
name: "partial"
platform: kubernetes-hpa
service:
  min_replicas: 3`;
        const config = svc.import(yaml);
        assert.equal(config.service.min_replicas, 3);
        assert.equal(config.service.max_replicas, DEFAULT_CONFIG.service.max_replicas);
    });
});
// ---------------------------------------------------------------------------
// Step and Custom traffic patterns in YAML
// ---------------------------------------------------------------------------
describe('ConfigService — step traffic YAML', () => {
    it('exports and imports step traffic', () => {
        const config = makeConfig({
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'step',
                    params: {
                        steps: [
                            { rps: 100, duration: 60 },
                            { rps: 300, duration: 60 },
                        ],
                    },
                },
            },
        });
        const yaml = svc.export(config);
        assert.ok(yaml.includes('pattern: step'));
        assert.ok(yaml.includes('steps:'));
        const imported = svc.import(yaml);
        assert.equal(imported.producer.traffic.pattern, 'step');
        const steps = imported.producer.traffic.params.steps;
        assert.ok(Array.isArray(steps));
        assert.equal(steps.length, 2);
        assert.equal(steps[0].rps, 100);
        assert.equal(steps[1].rps, 300);
    });
});
describe('ConfigService — custom traffic YAML', () => {
    it('exports and imports custom series', () => {
        const config = makeConfig({
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'custom',
                    params: {
                        series: [
                            { t: 0, rps: 100 },
                            { t: 60, rps: 500 },
                        ],
                    },
                },
            },
        });
        const yaml = svc.export(config);
        assert.ok(yaml.includes('pattern: custom'));
        assert.ok(yaml.includes('series:'));
        const imported = svc.import(yaml);
        assert.equal(imported.producer.traffic.pattern, 'custom');
        const series = imported.producer.traffic.params.series;
        assert.ok(Array.isArray(series));
        assert.equal(series.length, 2);
        assert.equal(series[0].t, 0);
        assert.equal(series[0].rps, 100);
        assert.equal(series[1].t, 60);
        assert.equal(series[1].rps, 500);
    });
});
//# sourceMappingURL=config.test.js.map