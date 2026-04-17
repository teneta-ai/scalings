// ============================================================================
// Unit tests for MCP tool handlers.
// ============================================================================

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  DEFAULT_SERVICE,
  PRESET_SCENARIOS,
  TrafficPatternType,
  SteadyParams,
  SpikeParams,
  GradualParams,
  WaveParams,
  StepParams,
  CustomParams,
  GrafanaParams,
} from '../../src/interfaces/types.js';
import { runSimulationTool } from '../tools/run-simulation.js';
import { compareSimulationsTool } from '../tools/compare.js';
import { listPresetsTool } from '../tools/presets.js';
import { getSimulationUrlTool } from '../tools/url.js';
import { describeParametersTool } from '../tools/parameters.js';
import { makeConfig } from './helpers.js';

// ---------------------------------------------------------------------------
// run_simulation
// ---------------------------------------------------------------------------
describe('run_simulation tool', () => {
  it('runs a simulation with default config and returns valid result', async () => {
    const result = await runSimulationTool({ config: {} });
    assert.ok(result.run_id);
    assert.ok(Array.isArray(result.snapshots));
    assert.ok(result.snapshots.length > 0);
    assert.ok(result.summary);
    assert.equal(typeof result.summary.total_requests, 'number');
  });

  it('merges partial config with defaults correctly', async () => {
    const result = await runSimulationTool({
      config: {
        simulation: { duration: 30, tick_interval: 1 },
        service: { min_replicas: 7 },
      },
    });
    assert.equal(result.snapshots.length, 30);
    assert.equal(result.snapshots[0].running_pods, 7);
  });

  it('rejects duration > 3600 with clear error', async () => {
    await assert.rejects(
      () => runSimulationTool({ config: { simulation: { duration: 4000, tick_interval: 1 } } }),
      (err: Error) => {
        assert.match(err.message, /duration/i);
        assert.match(err.message, /3600/);
        return true;
      },
    );
  });

  it('rejects tick_interval < 0.5 with clear error', async () => {
    await assert.rejects(
      () => runSimulationTool({ config: { simulation: { duration: 60, tick_interval: 0.1 } } }),
      (err: Error) => {
        assert.match(err.message, /tick_interval/i);
        return true;
      },
    );
  });

  it('rejects max_replicas > 1000 with clear error', async () => {
    await assert.rejects(
      () => runSimulationTool({ config: { service: { max_replicas: 5000 } } }),
      (err: Error) => {
        assert.match(err.message, /max_replicas/i);
        assert.match(err.message, /1000/);
        return true;
      },
    );
  });

  it('rejects negative numeric values', async () => {
    await assert.rejects(
      () => runSimulationTool({ config: { service: { min_replicas: -5 } } }),
      (err: Error) => {
        assert.match(err.message, /min_replicas/i);
        return true;
      },
    );
  });

  it('returns correct number of snapshots for given duration/tick_interval', async () => {
    const result = await runSimulationTool({
      config: { simulation: { duration: 120, tick_interval: 2 } },
    });
    assert.equal(result.snapshots.length, 60);
  });

  it('summary metrics are consistent with snapshots', async () => {
    const result = await runSimulationTool({
      config: {
        simulation: { duration: 60, tick_interval: 1 },
        service: { ...DEFAULT_SERVICE, metric_observation_delay: 0, cooldown_scale_up: 0 },
      },
    });
    let peakPods = 0;
    for (const snap of result.snapshots) {
      peakPods = Math.max(peakPods, snap.total_pods);
    }
    assert.equal(result.summary.peak_pod_count, peakPods);
  });

  it('handles all traffic pattern types', async () => {
    const patterns: { pattern: TrafficPatternType; params: unknown }[] = [
      { pattern: 'steady', params: { rps: 100 } as SteadyParams },
      { pattern: 'gradual', params: { start_rps: 10, end_rps: 500 } as GradualParams },
      { pattern: 'spike', params: { base_rps: 100, spike_rps: 500, spike_start: 10, spike_duration: 10 } as SpikeParams },
      { pattern: 'wave', params: { base_rps: 100, amplitude: 50, period: 30 } as WaveParams },
      { pattern: 'step', params: { steps: [{ rps: 100, duration: 30 }, { rps: 200, duration: 30 }] } as StepParams },
      { pattern: 'custom', params: { series: [{ t: 0, rps: 100 }, { t: 60, rps: 500 }] } as CustomParams },
      { pattern: 'grafana', params: { series: [{ t: 0, rps: 100 }, { t: 60, rps: 500 }], raw_csv: '', value_unit: 'rps' } as GrafanaParams },
    ];
    for (const { pattern, params } of patterns) {
      const result = await runSimulationTool({
        config: {
          simulation: { duration: 60, tick_interval: 1 },
          producer: { traffic: { pattern, params: params as never } },
        },
      });
      assert.equal(result.snapshots.length, 60, `pattern=${pattern}`);
    }
  });

  it('preset configs produce valid results', async () => {
    for (const preset of PRESET_SCENARIOS) {
      // Cap duration to keep tests fast while still exercising each preset.
      const cfg = {
        ...preset.config,
        simulation: { duration: 30, tick_interval: 1 },
      };
      const result = await runSimulationTool({ config: cfg });
      assert.ok(result.snapshots.length > 0, `preset=${preset.name}`);
      assert.equal(typeof result.summary.total_requests, 'number', `preset=${preset.name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// compare_simulations
// ---------------------------------------------------------------------------
describe('compare_simulations tool', () => {
  it('returns both results and a comparison summary', async () => {
    const out = await compareSimulationsTool({
      config_a: makeConfig({ service: { ...DEFAULT_SERVICE, min_replicas: 2, max_replicas: 10 } }),
      config_b: makeConfig({ service: { ...DEFAULT_SERVICE, min_replicas: 10, max_replicas: 50 } }),
    });
    assert.ok(out.a);
    assert.ok(out.b);
    assert.ok(out.comparison);
    assert.equal(out.comparison.labels.a, 'a');
    assert.equal(out.comparison.labels.b, 'b');
  });

  it('comparison deltas are mathematically correct', async () => {
    const out = await compareSimulationsTool({
      config_a: makeConfig(),
      config_b: makeConfig({ service: { ...DEFAULT_SERVICE, min_replicas: 15, max_replicas: 50 } }),
    });
    assert.equal(
      out.comparison.total_dropped_delta,
      out.b.summary.total_dropped - out.a.summary.total_dropped,
    );
    assert.equal(
      out.comparison.peak_pods_delta,
      out.b.summary.peak_pod_count - out.a.summary.peak_pod_count,
    );
    assert.equal(
      out.comparison.estimated_total_cost_delta,
      out.b.summary.estimated_total_cost - out.a.summary.estimated_total_cost,
    );
  });

  it('uses custom labels when provided', async () => {
    const out = await compareSimulationsTool({
      config_a: makeConfig(),
      config_b: makeConfig({ service: { ...DEFAULT_SERVICE, min_replicas: 5 } }),
      labels: { a: 'baseline', b: 'aggressive' },
    });
    assert.equal(out.comparison.labels.a, 'baseline');
    assert.equal(out.comparison.labels.b, 'aggressive');
  });

  it('validates both configs independently', async () => {
    await assert.rejects(
      () => compareSimulationsTool({
        config_a: makeConfig(),
        config_b: { service: { max_replicas: 5000 } },
      }),
      /config_b.*max_replicas/i,
    );
  });
});

// ---------------------------------------------------------------------------
// list_presets
// ---------------------------------------------------------------------------
describe('list_presets tool', () => {
  it('returns all presets from PRESET_SCENARIOS', async () => {
    const out = await listPresetsTool();
    assert.equal(out.presets.length, PRESET_SCENARIOS.length);
    const names = out.presets.map(p => p.name).sort();
    const expected = PRESET_SCENARIOS.map(p => p.name).sort();
    assert.deepEqual(names, expected);
  });

  it('each preset has name, description, and valid config', async () => {
    const out = await listPresetsTool();
    for (const preset of out.presets) {
      assert.ok(preset.name);
      assert.ok(preset.description);
      assert.ok(preset.config);
      assert.ok(preset.config.simulation);
      assert.ok(preset.config.producer);
      assert.ok(preset.config.service);
      assert.ok(preset.config.client);
      assert.ok(preset.config.broker);
    }
  });
});

// ---------------------------------------------------------------------------
// get_simulation_url
// ---------------------------------------------------------------------------
describe('get_simulation_url tool', () => {
  it('generates a valid scalings.xyz URL', async () => {
    const out = await getSimulationUrlTool({ config: makeConfig() });
    assert.match(out.url, /^https:\/\/scalings\.xyz\/#config=/);
  });

  it('URL contains base64-encoded config that decodes to valid JSON', async () => {
    const out = await getSimulationUrlTool({
      config: makeConfig({ name: 'roundtrip-test' }),
    });
    const match = out.url.match(/#config=([^&]+)/);
    assert.ok(match);
    const json = Buffer.from(match![1], 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    assert.equal(parsed.name, 'roundtrip-test');
  });

  it('includes autorun=true when requested', async () => {
    const out = await getSimulationUrlTool({ config: makeConfig(), autorun: true });
    assert.match(out.url, /autorun=true/);
  });

  it('URL without autorun has no autorun parameter', async () => {
    const out = await getSimulationUrlTool({ config: makeConfig() });
    assert.doesNotMatch(out.url, /autorun/);
  });
});

// ---------------------------------------------------------------------------
// describe_parameters
// ---------------------------------------------------------------------------
describe('describe_parameters tool', () => {
  it('returns all service parameters with defaults', async () => {
    const out = await describeParametersTool({});
    assert.ok(out.sections);
    const service = out.sections!.service;
    assert.ok(service);
    const maxReplicas = service.find(p => p.name === 'max_replicas');
    assert.ok(maxReplicas);
    assert.equal(maxReplicas!.default, DEFAULT_SERVICE.max_replicas);
  });

  it('returns filtered results when section is specified', async () => {
    const out = await describeParametersTool({ section: 'broker' });
    assert.ok(out.sections);
    assert.ok(out.sections!.broker);
    assert.equal(Object.keys(out.sections!).length, 1);
  });

  it('every default value matches the actual DEFAULT_* constants', async () => {
    const out = await describeParametersTool({});
    assert.ok(out.sections);
    for (const param of out.sections!.service) {
      const key = param.name as keyof typeof DEFAULT_SERVICE;
      const expected = DEFAULT_SERVICE[key];
      if (Array.isArray(expected)) {
        assert.deepEqual(param.default, expected, `service.${param.name} default drift`);
      } else {
        assert.equal(param.default, expected, `service.${param.name} default drift`);
      }
    }
  });

  it('includes traffic_patterns in full response', async () => {
    const out = await describeParametersTool({});
    assert.ok(out.traffic_patterns);
    assert.ok(out.traffic_patterns!.length >= 6);
    const spike = out.traffic_patterns!.find(p => p.pattern === 'spike');
    assert.ok(spike);
    assert.ok(spike!.params.some(p => p.name === 'spike_rps'));
  });

  it('every DEFAULT_CONFIG top-level key is represented', async () => {
    const out = await describeParametersTool({});
    assert.ok(out.sections!.simulation);
    assert.ok(out.sections!.service);
    assert.ok(out.sections!.client);
    assert.ok(out.sections!.broker);
    assert.ok(out.sections!.producer);
    void DEFAULT_CONFIG; // referenced to keep the import as an invariant check
  });
});
