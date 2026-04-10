import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalSimulationService } from '../services/simulation.js';
import {
  SimulationConfig,
  DEFAULT_CONFIG,
  DEFAULT_SCALING,
  DEFAULT_ADVANCED,
  DEFAULT_CHAOS,
  DEFAULT_QUEUE,
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
// Snapshot consistency
// ---------------------------------------------------------------------------
describe('SimulationService — snapshot consistency', () => {
  it('pod state counts always sum to total_pods', async () => {
    const config = makeConfig({
      simulation: { duration: 200, tick_interval: 1 },
      scaling: {
        ...DEFAULT_SCALING,
        min_replicas: 2,
        max_replicas: 20,
        capacity_per_replica: 100,
        startup_time: 5,
        scale_up_step: 4,
      },
      advanced: {
        ...DEFAULT_ADVANCED,
        metric_observation_delay: 0,
        cooldown_scale_up: 0,
        cooldown_scale_down: 5,
        node_provisioning_time: 0,
        graceful_shutdown_time: 10,
      },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 50, spike_rps: 1500, spike_start: 10, spike_duration: 30 } as SpikeParams,
      },
    });
    const result = await svc.run(config);
    for (const snap of result.snapshots) {
      const sum = snap.running_pods + snap.starting_pods + snap.shutting_down_pods;
      assert.equal(sum, snap.total_pods,
        `t=${snap.time}: running(${snap.running_pods}) + starting(${snap.starting_pods}) + shutting_down(${snap.shutting_down_pods}) = ${sum} != total(${snap.total_pods})`
      );
    }
  });

  it('scale-down event immediately reflects in running_pods', async () => {
    const config = makeConfig({
      simulation: { duration: 100, tick_interval: 1 },
      scaling: {
        ...DEFAULT_SCALING,
        min_replicas: 2,
        max_replicas: 10,
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
        graceful_shutdown_time: 5,
      },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 50, spike_rps: 1000, spike_start: 5, spike_duration: 10 } as SpikeParams,
      },
    });
    const result = await svc.run(config);
    for (let i = 0; i < result.snapshots.length; i++) {
      const snap = result.snapshots[i];
      if (snap.scale_event === 'down' && i > 0) {
        const prev = result.snapshots[i - 1];
        assert.ok(snap.running_pods < prev.running_pods,
          `t=${snap.time}: scale-down event but running_pods (${snap.running_pods}) did not decrease from previous tick (${prev.running_pods})`
        );
      }
    }
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

// ---------------------------------------------------------------------------
// Seeded PRNG — reproducibility
// ---------------------------------------------------------------------------
describe('SimulationService — seeded PRNG', () => {
  it('produces identical results with the same seed', async () => {
    const config = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 5, max_replicas: 20, capacity_per_replica: 100 },
      advanced: {
        ...DEFAULT_ADVANCED,
        metric_observation_delay: 0,
        cooldown_scale_up: 0,
        cooldown_scale_down: 9999,
      },
      chaos: { ...DEFAULT_CHAOS, pod_failure_rate: 5, random_seed: 42 },
      traffic: { pattern: 'steady', params: { rps: 300 } as SteadyParams },
    });
    const result1 = await svc.run(config);
    const result2 = await svc.run(config);
    assert.deepStrictEqual(result1.snapshots, result2.snapshots);
    assert.deepStrictEqual(result1.summary, result2.summary);
  });

  it('produces different results with different seeds', async () => {
    const baseConfig = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 5, max_replicas: 20, capacity_per_replica: 100 },
      advanced: {
        ...DEFAULT_ADVANCED,
        metric_observation_delay: 0,
        cooldown_scale_up: 0,
        cooldown_scale_down: 9999,
      },
      chaos: { ...DEFAULT_CHAOS, pod_failure_rate: 10, random_seed: 1 },
      traffic: { pattern: 'steady', params: { rps: 300 } as SteadyParams },
    });
    const result1 = await svc.run(baseConfig);
    const result2 = await svc.run({ ...baseConfig, chaos: { ...baseConfig.chaos, random_seed: 999 } });
    // With a 10% failure rate over 60 ticks, different seeds should produce different pod counts
    const pods1 = result1.snapshots.map(s => s.running_pods);
    const pods2 = result2.snapshots.map(s => s.running_pods);
    const identical = pods1.every((v, i) => v === pods2[i]);
    assert.ok(!identical, 'Different seeds should produce different results');
  });
});

// ---------------------------------------------------------------------------
// Scheduled failure events
// ---------------------------------------------------------------------------
describe('SimulationService — failure events', () => {
  it('kills pods at the scheduled time', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 5, max_replicas: 5, capacity_per_replica: 100 },
      chaos: {
        ...DEFAULT_CHAOS,
        failure_events: [{ time: 10, count: 3 }],
      },
      traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams },
    });
    const result = await svc.run(config);
    // Before event: 5 running. At t=10: 3 killed → 2 running
    const atEvent = result.snapshots[10];
    assert.equal(atEvent.running_pods, 2, `expected 2 running pods at t=10, got ${atEvent.running_pods}`);
  });

  it('does not kill more pods than are running', async () => {
    const config = makeConfig({
      simulation: { duration: 10, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 2, max_replicas: 2, capacity_per_replica: 100 },
      chaos: {
        ...DEFAULT_CHAOS,
        failure_events: [{ time: 5, count: 10 }],
      },
      traffic: { pattern: 'steady', params: { rps: 50 } as SteadyParams },
    });
    const result = await svc.run(config);
    const atEvent = result.snapshots[5];
    assert.equal(atEvent.running_pods, 0, `expected 0 running pods, got ${atEvent.running_pods}`);
  });
});

// ---------------------------------------------------------------------------
// Decision log entries
// ---------------------------------------------------------------------------
describe('SimulationService — log entries', () => {
  it('every snapshot has a log_entries array', async () => {
    const config = makeConfig();
    const result = await svc.run(config);
    for (const snap of result.snapshots) {
      assert.ok(Array.isArray(snap.log_entries), `t=${snap.time}: log_entries should be an array`);
    }
  });

  it('logs scale-up events with utilization info', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const result = await svc.run(config);
    const scaleUpLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.startsWith('Scaled up'));
    assert.ok(scaleUpLogs.length > 0, 'should have at least one scale-up log');
    assert.ok(scaleUpLogs[0].includes('exceeds'), 'scale-up log should mention exceeding threshold');
    assert.ok(scaleUpLogs[0].includes('threshold'), 'scale-up log should mention threshold');
  });

  it('logs scale-down events with utilization info', async () => {
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
    const scaleDownLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.startsWith('Scaled down'));
    assert.ok(scaleDownLogs.length > 0, 'should have at least one scale-down log');
    assert.ok(scaleDownLogs[0].includes('below'), 'scale-down log should mention below threshold');
  });

  it('logs scheduled failure events', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 5, max_replicas: 5, capacity_per_replica: 100 },
      chaos: {
        ...DEFAULT_CHAOS,
        failure_events: [{ time: 10, count: 3 }],
      },
      traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams },
    });
    const result = await svc.run(config);
    const failureLogs = result.snapshots[10].log_entries.filter(l => l.includes('Scheduled failure'));
    assert.ok(failureLogs.length === 1, 'should have one scheduled failure log at t=10');
    assert.ok(failureLogs[0].includes('3'), 'should mention 3 pods killed');
  });

  it('logs pod lifecycle transitions', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 5 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
    });
    const result = await svc.run(config);
    const readyLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('finished starting'));
    assert.ok(readyLogs.length > 0, 'should log when pods finish starting');
  });

  it('logs drop start and recovery', async () => {
    const config = makeConfig({
      simulation: { duration: 120, tick_interval: 1 },
      scaling: {
        ...DEFAULT_SCALING,
        min_replicas: 2,
        max_replicas: 30,
        capacity_per_replica: 100,
        startup_time: 1,
        scale_up_step: 10,
      },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 100, spike_rps: 2000, spike_start: 10, spike_duration: 20 } as SpikeParams,
      },
    });
    const result = await svc.run(config);
    const allLogs = result.snapshots.flatMap(s => s.log_entries);
    const dropLogs = allLogs.filter(l => l.startsWith('Dropping'));
    const recoverLogs = allLogs.filter(l => l.startsWith('Recovered'));
    assert.ok(dropLogs.length > 0, 'should log when drops begin');
    assert.ok(recoverLogs.length > 0, 'should log when system recovers');
  });

  it('logs max replicas warning when at ceiling', async () => {
    const config = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 3, capacity_per_replica: 100, startup_time: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 5000 } as SteadyParams },
    });
    const result = await svc.run(config);
    const maxLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.startsWith('At max replicas'));
    assert.ok(maxLogs.length > 0, 'should log max replicas warning');
  });

  it('logs cooldown blocking scale-up', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 50, capacity_per_replica: 100, startup_time: 1, scale_up_step: 1 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 10, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: { pattern: 'steady', params: { rps: 5000 } as SteadyParams },
    });
    const result = await svc.run(config);
    const cooldownLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('cooldown active'));
    assert.ok(cooldownLogs.length > 0, 'should log cooldown blocking');
  });
});

// ---------------------------------------------------------------------------
// Queue mode — shared queue buffering
// ---------------------------------------------------------------------------
describe('SimulationService — queue mode (unlimited)', () => {
  it('never drops requests with unlimited queue', async () => {
    const config = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      queue: { enabled: true, max_size: 0 },
    });
    const result = await svc.run(config);
    assert.equal(result.summary.total_dropped, 0, 'unlimited queue should never drop');
    assert.equal(result.summary.drop_rate_percent, 0);
  });

  it('builds up queue depth when traffic exceeds capacity', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      queue: { enabled: true, max_size: 0 },
    });
    const result = await svc.run(config);
    assert.ok(result.summary.peak_queue_depth > 0, 'queue should accumulate backlog');
    // Queue should grow over time with constant overflow
    const midDepth = result.snapshots[15].queue_depth;
    const endDepth = result.snapshots[29].queue_depth;
    assert.ok(endDepth > midDepth, `queue should grow: mid=${midDepth}, end=${endDepth}`);
  });

  it('drains queue when capacity exceeds traffic', async () => {
    const config = makeConfig({
      simulation: { duration: 120, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 20, capacity_per_replica: 100, startup_time: 1, scale_up_step: 5 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 50, spike_rps: 1500, spike_start: 5, spike_duration: 20 } as SpikeParams,
      },
      queue: { enabled: true, max_size: 0 },
    });
    const result = await svc.run(config);
    // Queue should build during spike then drain after
    assert.ok(result.summary.peak_queue_depth > 0, 'queue should build during spike');
    const lastSnapshot = result.snapshots[result.snapshots.length - 1];
    assert.ok(
      lastSnapshot.queue_depth < result.summary.peak_queue_depth,
      `queue should drain: last=${lastSnapshot.queue_depth}, peak=${result.summary.peak_queue_depth}`
    );
  });

  it('tracks peak_queue_depth in summary', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 300 } as SteadyParams },
      queue: { enabled: true, max_size: 0 },
    });
    const result = await svc.run(config);
    const maxFromSnapshots = Math.max(...result.snapshots.map(s => s.queue_depth));
    assert.equal(result.summary.peak_queue_depth, maxFromSnapshots);
  });
});

describe('SimulationService — queue mode (bounded)', () => {
  it('drops requests when queue is full', async () => {
    const config = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      queue: { enabled: true, max_size: 200 },
    });
    const result = await svc.run(config);
    assert.ok(result.summary.total_dropped > 0, 'bounded queue should eventually drop');
    assert.ok(result.summary.peak_queue_depth <= 200, `queue should not exceed max_size: peak=${result.summary.peak_queue_depth}`);
  });

  it('queue depth never exceeds max_size', async () => {
    const config = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 1000 } as SteadyParams },
      queue: { enabled: true, max_size: 500 },
    });
    const result = await svc.run(config);
    for (const snap of result.snapshots) {
      assert.ok(snap.queue_depth <= 500, `t=${snap.time}: queue_depth ${snap.queue_depth} exceeds max_size 500`);
    }
  });

  it('drops less than OLTP mode with same traffic', async () => {
    const baseConfig = makeConfig({
      simulation: { duration: 60, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 1, scale_up_step: 2 },
      advanced: { ...DEFAULT_ADVANCED, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 50, spike_rps: 800, spike_start: 5, spike_duration: 15 } as SpikeParams,
      },
    });

    const oltpResult = await svc.run({ ...baseConfig, queue: { enabled: false, max_size: 0 } });
    const queueResult = await svc.run({ ...baseConfig, queue: { enabled: true, max_size: 5000 } });

    assert.ok(
      queueResult.summary.total_dropped <= oltpResult.summary.total_dropped,
      `queue dropped (${queueResult.summary.total_dropped}) should be <= OLTP dropped (${oltpResult.summary.total_dropped})`
    );
  });
});

describe('SimulationService — queue disabled', () => {
  it('queue_depth is always 0 when queue is disabled', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      queue: { enabled: false, max_size: 1000 },
    });
    const result = await svc.run(config);
    for (const snap of result.snapshots) {
      assert.equal(snap.queue_depth, 0, `t=${snap.time}: queue_depth should be 0 when disabled`);
    }
    assert.equal(result.summary.peak_queue_depth, 0);
  });

  it('served + dropped equals traffic when queue is disabled', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      queue: { enabled: false, max_size: 0 },
    });
    const result = await svc.run(config);
    for (const snap of result.snapshots) {
      const total = snap.served_requests + snap.dropped_requests;
      assert.ok(
        Math.abs(total - snap.traffic_rps) < 0.01,
        `t=${snap.time}: served(${snap.served_requests}) + dropped(${snap.dropped_requests}) should equal traffic(${snap.traffic_rps})`
      );
    }
  });
});

describe('SimulationService — queue log entries', () => {
  it('logs queue depth when buffering', async () => {
    const config = makeConfig({
      simulation: { duration: 10, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      queue: { enabled: true, max_size: 0 },
    });
    const result = await svc.run(config);
    const queueLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('Queue depth'));
    assert.ok(queueLogs.length > 0, 'should log queue depth when buffering');
    assert.ok(queueLogs[0].includes('buffered'), 'queue log should mention buffered requests');
  });

  it('logs queue full when bounded queue overflows', async () => {
    const config = makeConfig({
      simulation: { duration: 30, tick_interval: 1 },
      scaling: { ...DEFAULT_SCALING, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
      traffic: { pattern: 'steady', params: { rps: 1000 } as SteadyParams },
      queue: { enabled: true, max_size: 100 },
    });
    const result = await svc.run(config);
    const fullLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('Queue full'));
    assert.ok(fullLogs.length > 0, 'should log when queue is full and dropping');
  });
});
