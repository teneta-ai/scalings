import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalConfigService } from '../services/config.js';
import {
  SimulationConfig,
  DEFAULT_CONFIG,
  DEFAULT_SCALING,
  DEFAULT_ADVANCED,
  DEFAULT_CHAOS,
  DEFAULT_SIMULATION,
  SpikeParams,
  SteadyParams,
  StepParams,
  CustomParams,
} from '../interfaces/types.js';

const svc = new LocalConfigService();

function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
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
    assert.equal(imported.scaling.min_replicas, DEFAULT_CONFIG.scaling.min_replicas);
    assert.equal(imported.scaling.max_replicas, DEFAULT_CONFIG.scaling.max_replicas);
    assert.equal(imported.advanced.cooldown_scale_up, DEFAULT_CONFIG.advanced.cooldown_scale_up);
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
      traffic: {
        pattern: 'spike',
        params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
      },
    });
    const yaml = svc.export(config);
    const imported = svc.import(yaml);
    assert.equal(imported.traffic.pattern, 'spike');
    const params = imported.traffic.params as SpikeParams;
    assert.equal(params.base_rps, 200);
    assert.equal(params.spike_rps, 2000);
    assert.equal(params.spike_start, 120);
    assert.equal(params.spike_duration, 60);
  });

  it('preserves traffic pattern — steady', () => {
    const config = makeConfig({
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const yaml = svc.export(config);
    const imported = svc.import(yaml);
    assert.equal(imported.traffic.pattern, 'steady');
    assert.equal((imported.traffic.params as SteadyParams).rps, 500);
  });

  it('preserves all scaling parameters', () => {
    const config = makeConfig({
      scaling: {
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
    assert.deepStrictEqual(imported.scaling, config.scaling);
  });

  it('preserves all advanced parameters', () => {
    const config = makeConfig({
      advanced: {
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
    assert.deepStrictEqual(imported.advanced, config.advanced);
  });

  it('preserves queue config', () => {
    const config = makeConfig({
      queue: { enabled: true, max_size: 5000 },
    });
    const yaml = svc.export(config);
    const imported = svc.import(yaml);
    assert.equal(imported.queue.enabled, true);
    assert.equal(imported.queue.max_size, 5000);
  });

  it('preserves queue config with unlimited size', () => {
    const config = makeConfig({
      queue: { enabled: true, max_size: 0 },
    });
    const yaml = svc.export(config);
    const imported = svc.import(yaml);
    assert.equal(imported.queue.enabled, true);
    assert.equal(imported.queue.max_size, 0);
  });

  it('preserves queue disabled state', () => {
    const config = makeConfig({
      queue: { enabled: false, max_size: 1000 },
    });
    const yaml = svc.export(config);
    const imported = svc.import(yaml);
    assert.equal(imported.queue.enabled, false);
    assert.equal(imported.queue.max_size, 1000);
  });

  it('preserves chaos config with failure events', () => {
    const config = makeConfig({
      chaos: {
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
    assert.equal(imported.chaos.pod_failure_rate, 2.5);
    assert.equal(imported.chaos.random_seed, 42);
    assert.equal(imported.chaos.failure_events.length, 2);
    assert.equal(imported.chaos.failure_events[0].time, 60);
    assert.equal(imported.chaos.failure_events[0].count, 3);
    assert.equal(imported.chaos.failure_events[1].time, 180);
    assert.equal(imported.chaos.failure_events[1].count, 5);
  });
});

// ---------------------------------------------------------------------------
// YAML export format
// ---------------------------------------------------------------------------
describe('ConfigService — YAML export format', () => {
  it('starts with version header comment', () => {
    const yaml = svc.export(DEFAULT_CONFIG);
    assert.ok(yaml.startsWith('# scalings.xyz simulator config v1'));
  });

  it('contains version field', () => {
    const yaml = svc.export(DEFAULT_CONFIG);
    assert.ok(yaml.includes('version: 1'));
  });

  it('contains all top-level sections', () => {
    const yaml = svc.export(DEFAULT_CONFIG);
    assert.ok(yaml.includes('simulation:'));
    assert.ok(yaml.includes('scaling:'));
    assert.ok(yaml.includes('advanced:'));
    assert.ok(yaml.includes('chaos:'));
    assert.ok(yaml.includes('queue:'));
    assert.ok(yaml.includes('traffic:'));
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
    assert.equal(decoded.scaling.min_replicas, config.scaling.min_replicas);
  });

  it('throws on invalid URL hash', () => {
    assert.throws(() => svc.fromURL('#nope=abc'), /No config found/);
  });

  it('round-trips all parameters', () => {
    const config = makeConfig({
      name: 'Full round trip',
      platform: 'gcp-mig',
      scaling: { ...DEFAULT_SCALING, min_replicas: 7, max_replicas: 77 },
    });
    const decoded = svc.fromURL(svc.toURL(config));
    assert.equal(decoded.platform, 'gcp-mig');
    assert.equal(decoded.scaling.min_replicas, 7);
    assert.equal(decoded.scaling.max_replicas, 77);
  });
});

// ---------------------------------------------------------------------------
// Validation / defaults
// ---------------------------------------------------------------------------
describe('ConfigService — import validation', () => {
  it('returns defaults for empty YAML', () => {
    const config = svc.import('version: 1\nname: "empty"');
    assert.equal(config.version, 1);
    assert.equal(config.scaling.min_replicas, DEFAULT_CONFIG.scaling.min_replicas);
    assert.equal(config.advanced.cooldown_scale_up, DEFAULT_CONFIG.advanced.cooldown_scale_up);
  });

  it('falls back to defaults for invalid platform', () => {
    const config = svc.import('version: 1\nname: "test"\nplatform: invalid-platform');
    assert.equal(config.platform, DEFAULT_CONFIG.platform);
  });

  it('falls back to defaults for missing queue config', () => {
    const config = svc.import('version: 1\nname: "no queue"');
    assert.equal(config.queue.enabled, DEFAULT_CONFIG.queue.enabled);
    assert.equal(config.queue.max_size, DEFAULT_CONFIG.queue.max_size);
  });

  it('falls back to defaults for missing numeric values', () => {
    const yaml = `version: 1
name: "partial"
platform: kubernetes-hpa
scaling:
  min_replicas: 3`;
    const config = svc.import(yaml);
    assert.equal(config.scaling.min_replicas, 3);
    assert.equal(config.scaling.max_replicas, DEFAULT_CONFIG.scaling.max_replicas);
  });
});

// ---------------------------------------------------------------------------
// Step and Custom traffic patterns in YAML
// ---------------------------------------------------------------------------
describe('ConfigService — step traffic YAML', () => {
  it('exports and imports step traffic', () => {
    const config = makeConfig({
      traffic: {
        pattern: 'step',
        params: {
          steps: [
            { rps: 100, duration: 60 },
            { rps: 300, duration: 60 },
          ],
        } as StepParams,
      },
    });
    const yaml = svc.export(config);
    assert.ok(yaml.includes('pattern: step'));
    assert.ok(yaml.includes('steps:'));
    const imported = svc.import(yaml);
    assert.equal(imported.traffic.pattern, 'step');
    const steps = (imported.traffic.params as StepParams).steps;
    assert.ok(Array.isArray(steps));
    assert.equal(steps.length, 2);
    assert.equal(steps[0].rps, 100);
    assert.equal(steps[1].rps, 300);
  });
});

describe('ConfigService — custom traffic YAML', () => {
  it('exports and imports custom series', () => {
    const config = makeConfig({
      traffic: {
        pattern: 'custom',
        params: {
          series: [
            { t: 0, rps: 100 },
            { t: 60, rps: 500 },
          ],
        } as CustomParams,
      },
    });
    const yaml = svc.export(config);
    assert.ok(yaml.includes('pattern: custom'));
    assert.ok(yaml.includes('series:'));
    const imported = svc.import(yaml);
    assert.equal(imported.traffic.pattern, 'custom');
    const series = (imported.traffic.params as CustomParams).series;
    assert.ok(Array.isArray(series));
    assert.equal(series.length, 2);
    assert.equal(series[0].t, 0);
    assert.equal(series[0].rps, 100);
    assert.equal(series[1].t, 60);
    assert.equal(series[1].rps, 500);
  });
});
