import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalSimulationService } from '../services/simulation.js';
import {
  SimulationConfig,
  DEFAULT_CONFIG,
  DEFAULT_SCALING,
  DEFAULT_ADVANCED,
  DEFAULT_SIMULATION,
  SteadyParams,
  SpikeParams,
} from '../interfaces/types.js';

const svc = new LocalSimulationService();

function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    simulation: { ...DEFAULT_SIMULATION, duration: 60, tick_interval: 1 },
    scaling: { ...DEFAULT_SCALING },
    advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic simulation mechanics
// ---------------------------------------------------------------------------
describe('SimulationService — basic', () => {
  it('returns correct number of snapshots', async () => {
    const config = makeConfig();
    const result = await svc.run(config);
    assert.equal(result.snapshots.length, 60);
  });

  it('starts with min_replicas running pods', async () => {
    const config = makeConfig();
    const result = await svc.run(config);
    assert.equal(result.snapshots[0].running_pods, DEFAULT_SCALING.min_replicas);
  });

  it('snapshot times are sequential', async () => {
    const config = makeConfig();
    const result = await svc.run(config);
    for (let i = 0; i < result.snapshots.length; i++) {
      assert.equal(result.snapshots[i].time, i);
    }
  });

  it('returns a summary object', async () => {
    const config = makeConfig();
    const result = await svc.run(config);
    assert.ok(result.summary);
    assert.ok(typeof result.summary.total_requests === 'number');
    assert.ok(typeof result.summary.total_served === 'number');
    assert.ok(typeof result.summary.total_dropped === 'number');
    assert.ok(typeof result.summary.peak_pod_count === 'number');
    assert.ok(typeof result.summary.estimated_total_cost === 'number');
  });
});

// ---------------------------------------------------------------------------
// Low traffic — no drops, no scale-up
// ---------------------------------------------------------------------------
describe('SimulationService — low traffic', () => {
  it('drops nothing when traffic is well within capacity', async () => {
    const config = makeConfig({
      traffic: { pattern: 'steady', params: { rps: 50 } as SteadyParams },
    });
    const result = await svc.run(config);
    assert.equal(result.summary.total_dropped, 0);
    assert.equal(result.summary.drop_rate_percent, 0);
  });

  it('does not scale up when utilization is below threshold', async () => {
    const config = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 5, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams },
    });
    // 100 rps / (5 * 100) = 20% utilization — below 70% threshold
    const result = await svc.run(config);
    assert.equal(result.summary.peak_pod_count, 5);
  });
});

// ---------------------------------------------------------------------------
// High traffic — scale-up triggered
// ---------------------------------------------------------------------------
describe('SimulationService — scale-up', () => {
  it('scales up when utilization exceeds threshold', async () => {
    const config = makeConfig({
      simulation: { duration: 120, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 2, capacity_per_replica: 100, startup_time: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    // 500 rps / (2 * 100) = 250% → should trigger many scale-ups
    const result = await svc.run(config);
    assert.ok(result.summary.peak_pod_count > 2, `peak was ${result.summary.peak_pod_count}`);
  });

  it('respects max_replicas ceiling', async () => {
    const config = makeConfig({
      simulation: { duration: 300, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 2, max_replicas: 5, capacity_per_replica: 100, startup_time: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 5000 } as SteadyParams },
    });
    const result = await svc.run(config);
    assert.ok(result.summary.peak_pod_count <= 5, `peak was ${result.summary.peak_pod_count}`);
  });
});

// ---------------------------------------------------------------------------
// Scale-down
// ---------------------------------------------------------------------------
describe('SimulationService — scale-down', () => {
  it('scales down when utilization drops below threshold', async () => {
    const config = makeConfig({
      simulation: { duration: 200, tick_interval: 1 },
      scaling: {
        ...DEFAULT_SCALING,
        min_replicas: 2,
        max_replicas: 20,
        capacity_per_replica: 100,
        startup_time: 1,
        scale_up_step: 5,
      },
      advanced: {
        ...DEFAULT_ADVANCED,
        metric_observation_delay: 0,
        cooldown_scale_up: 0,
        cooldown_scale_down: 5,
        node_provisioning_time: 0,
        graceful_shutdown_time: 1,
      },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 50, spike_rps: 1500, spike_start: 5, spike_duration: 20 } as SpikeParams,
      },
    });
    const result = await svc.run(config);
    // After spike, pods should scale back down
    const lastSnapshot = result.snapshots[result.snapshots.length - 1];
    assert.ok(
      lastSnapshot.running_pods < result.summary.peak_pod_count,
      `last pods (${lastSnapshot.running_pods}) should be less than peak (${result.summary.peak_pod_count})`
    );
  });

  it('respects min_replicas floor', async () => {
    const config = makeConfig({
      simulation: { duration: 200, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 3, capacity_per_replica: 1000, startup_time: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 0, graceful_shutdown_time: 1 },
      traffic: { pattern: 'steady', params: { rps: 10 } as SteadyParams },
    });
    const result = await svc.run(config);
    const lastSnapshot = result.snapshots[result.snapshots.length - 1];
    assert.ok(lastSnapshot.running_pods >= 3, `running pods (${lastSnapshot.running_pods}) should be >= min_replicas (3)`);
  });
});

// ---------------------------------------------------------------------------
// Dropped requests
// ---------------------------------------------------------------------------
describe('SimulationService — dropped requests', () => {
  it('drops requests when traffic exceeds capacity', async () => {
    const config = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const result = await svc.run(config);
    assert.ok(result.summary.total_dropped > 0);
    assert.ok(result.summary.drop_rate_percent > 0);
  });

  it('served + dropped equals total', async () => {
    const config = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const result = await svc.run(config);
    const total = result.summary.total_served + result.summary.total_dropped;
    assert.ok(
      Math.abs(total - result.summary.total_requests) < 2,
      `served(${result.summary.total_served}) + dropped(${result.summary.total_dropped}) = ${total}, expected ${result.summary.total_requests}`
    );
  });
});

// ---------------------------------------------------------------------------
// Cooldown periods
// ---------------------------------------------------------------------------
describe('SimulationService — cooldown', () => {
  it('cooldown prevents rapid scale-up', async () => {
    const config = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 2, max_replicas: 50, capacity_per_replica: 100, startup_time: 1, scale_up_step: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 20, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 5000 } as SteadyParams },
    });
    const result = await svc.run(config);
    // With 20s cooldown over 60s, can only scale up ~3 times (tick 0, 20, 40)
    // Starting at 2, adding 1 each time = max 5
    assert.ok(result.summary.peak_pod_count <= 6, `peak was ${result.summary.peak_pod_count}`);
  });
});

// ---------------------------------------------------------------------------
// Startup time
// ---------------------------------------------------------------------------
describe('SimulationService — startup time', () => {
  it('new pods do not serve traffic during startup', async () => {
    const config = makeConfig({
      simulation: { duration: 10, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 5 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const result = await svc.run(config);
    // At tick 0: 1 running pod, capacity 100. Scale-up triggered.
    // New pods won't serve until tick 5+.
    // So early ticks should have starting_pods > 0
    const earlySnapshot = result.snapshots[2]; // tick 2
    assert.ok(earlySnapshot.starting_pods > 0 || earlySnapshot.running_pods === 1);
  });
});

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------
describe('SimulationService — cost', () => {
  it('cumulative cost increases over time', async () => {
    const config = makeConfig({
      advanced: { ...DEFAULT_ADVANCED, cost_per_replica_hour: 1.0, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 9999 },
      traffic: { pattern: 'steady', params: { rps: 50 } as SteadyParams },
    });
    const result = await svc.run(config);
    const firstCost = result.snapshots[0].estimated_cost;
    const lastCost = result.snapshots[result.snapshots.length - 1].estimated_cost;
    assert.ok(lastCost > firstCost, `last cost (${lastCost}) should be > first (${firstCost})`);
    assert.ok(result.summary.estimated_total_cost > 0);
  });

  it('cost is proportional to pod count', async () => {
    const config1 = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 2 },
      advanced: { ...DEFAULT_ADVANCED, cost_per_replica_hour: 1.0, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 9999 },
      traffic: { pattern: 'steady', params: { rps: 10 } as SteadyParams },
    });
    const config5 = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 5 },
      advanced: { ...DEFAULT_ADVANCED, cost_per_replica_hour: 1.0, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 9999 },
      traffic: { pattern: 'steady', params: { rps: 10 } as SteadyParams },
    });
    const result1 = await svc.run(config1);
    const result5 = await svc.run(config5);
    // 5 pods should cost ~2.5x more than 2 pods
    const ratio = result5.summary.estimated_total_cost / result1.summary.estimated_total_cost;
    assert.ok(ratio > 2 && ratio < 3, `ratio was ${ratio}`);
  });
});

// ---------------------------------------------------------------------------
// Summary calculations
// ---------------------------------------------------------------------------
describe('SimulationService — summary', () => {
  it('under-provisioned time is tracked correctly', async () => {
    const config = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const result = await svc.run(config);
    // Always over capacity → 100% under-provisioned
    assert.ok(result.summary.time_under_provisioned_percent > 90);
  });

  it('zero drops when capacity is sufficient', async () => {
    const config = makeConfig({
      scaling: { ...DEFAULT_SCALING, min_replicas: 10, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams },
    });
    const result = await svc.run(config);
    assert.equal(result.summary.total_dropped, 0);
    assert.equal(result.summary.time_under_provisioned_seconds, 0);
  });
});
