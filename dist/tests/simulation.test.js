import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalSimulationService } from '../services/simulation.js';
import { DEFAULT_CONFIG, DEFAULT_SERVICE, DEFAULT_BROKER, DEFAULT_PRODUCER, DEFAULT_CLIENT, DEFAULT_SIMULATION, } from '../interfaces/types.js';
const svc = new LocalSimulationService();
// Shorthand for service overrides — includes the "fast autoscaler" defaults
const SVC = { ...DEFAULT_SERVICE, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 0 };
function makeConfig(overrides = {}) {
    return {
        ...DEFAULT_CONFIG,
        simulation: { ...DEFAULT_SIMULATION, duration: 60, tick_interval: 1 },
        service: SVC,
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
        assert.equal(result.snapshots[0].running_pods, DEFAULT_SERVICE.min_replicas);
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
    it('returns a run_id string', async () => {
        const config = makeConfig();
        const result = await svc.run(config);
        assert.ok(typeof result.run_id === 'string');
        assert.ok(result.run_id.length > 0);
        assert.ok(result.run_id.startsWith('run-'));
    });
    it('generates unique run_ids across runs', async () => {
        const config = makeConfig();
        const ids = new Set();
        for (let i = 0; i < 5; i++) {
            const result = await svc.run(config);
            assert.ok(!ids.has(result.run_id), `Duplicate run_id: ${result.run_id}`);
            ids.add(result.run_id);
        }
        assert.equal(ids.size, 5);
    });
});
// ---------------------------------------------------------------------------
// Low traffic — no drops, no scale-up
// ---------------------------------------------------------------------------
describe('SimulationService — low traffic', () => {
    it('drops nothing when traffic is well within capacity', async () => {
        const config = makeConfig({
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
        });
        const result = await svc.run(config);
        assert.equal(result.summary.total_dropped, 0);
        assert.equal(result.summary.drop_rate_percent, 0);
    });
    it('does not scale up when utilization is below threshold', async () => {
        const config = makeConfig({
            service: { ...SVC, min_replicas: 5, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 100 } } },
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
            service: { ...SVC, min_replicas: 2, capacity_per_replica: 100, startup_time: 1, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
        });
        // 500 rps / (2 * 100) = 250% → should trigger many scale-ups
        const result = await svc.run(config);
        assert.ok(result.summary.peak_pod_count > 2, `peak was ${result.summary.peak_pod_count}`);
    });
    it('respects max_replicas ceiling', async () => {
        const config = makeConfig({
            simulation: { duration: 300, tick_interval: 1 },
            service: { ...SVC, min_replicas: 2, max_replicas: 5, capacity_per_replica: 100, startup_time: 1, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 5000 } } },
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
            service: { ...SVC, min_replicas: 2, max_replicas: 20, capacity_per_replica: 100, startup_time: 1, scale_up_step: 5, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 5, node_provisioning_time: 0, graceful_shutdown_time: 1 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 50, spike_rps: 1500, spike_start: 5, spike_duration: 20 },
                } },
        });
        const result = await svc.run(config);
        // After spike, pods should scale back down
        const lastSnapshot = result.snapshots[result.snapshots.length - 1];
        assert.ok(lastSnapshot.running_pods < result.summary.peak_pod_count, `last pods (${lastSnapshot.running_pods}) should be less than peak (${result.summary.peak_pod_count})`);
    });
    it('respects min_replicas floor', async () => {
        const config = makeConfig({
            simulation: { duration: 200, tick_interval: 1 },
            service: { ...SVC, min_replicas: 3, capacity_per_replica: 1000, startup_time: 1, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 0, graceful_shutdown_time: 1 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 10 } } },
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
            service: { ...SVC, min_replicas: 2, max_replicas: 20, capacity_per_replica: 100, startup_time: 5, scale_up_step: 4, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 5, node_provisioning_time: 0, graceful_shutdown_time: 10 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 50, spike_rps: 1500, spike_start: 10, spike_duration: 30 },
                } },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            const sum = snap.running_pods + snap.starting_pods + snap.shutting_down_pods;
            assert.equal(sum, snap.total_pods, `t=${snap.time}: running(${snap.running_pods}) + starting(${snap.starting_pods}) + shutting_down(${snap.shutting_down_pods}) = ${sum} != total(${snap.total_pods})`);
        }
    });
    it('scale-down event immediately reflects in running_pods', async () => {
        const config = makeConfig({
            simulation: { duration: 100, tick_interval: 1 },
            service: { ...SVC, min_replicas: 2, max_replicas: 10, capacity_per_replica: 100, startup_time: 1, scale_up_step: 5, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 5, node_provisioning_time: 0, graceful_shutdown_time: 5 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 50, spike_rps: 1000, spike_start: 5, spike_duration: 10 },
                } },
        });
        const result = await svc.run(config);
        for (let i = 0; i < result.snapshots.length; i++) {
            const snap = result.snapshots[i];
            if (snap.scale_event === 'down' && i > 0) {
                const prev = result.snapshots[i - 1];
                assert.ok(snap.running_pods < prev.running_pods, `t=${snap.time}: scale-down event but running_pods (${snap.running_pods}) did not decrease from previous tick (${prev.running_pods})`);
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
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
        });
        const result = await svc.run(config);
        assert.ok(result.summary.total_dropped > 0);
        assert.ok(result.summary.drop_rate_percent > 0);
    });
    it('served + dropped equals total', async () => {
        const config = makeConfig({
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
        });
        const result = await svc.run(config);
        const total = result.summary.total_served + result.summary.total_dropped;
        assert.ok(Math.abs(total - result.summary.total_requests) < 2, `served(${result.summary.total_served}) + dropped(${result.summary.total_dropped}) = ${total}, expected ${result.summary.total_requests}`);
    });
});
// ---------------------------------------------------------------------------
// Cooldown periods
// ---------------------------------------------------------------------------
describe('SimulationService — cooldown', () => {
    it('cooldown prevents rapid scale-up', async () => {
        const config = makeConfig({
            simulation: { duration: 60, tick_interval: 1 },
            service: { ...SVC, min_replicas: 2, max_replicas: 50, capacity_per_replica: 100, startup_time: 1, scale_up_step: 1, metric_observation_delay: 0, cooldown_scale_up: 20, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 5000 } } },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 5, metric_observation_delay: 0, cooldown_scale_up: 0, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
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
            service: { ...SVC, cost_per_replica_hour: 1.0, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 9999 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
        });
        const result = await svc.run(config);
        const firstCost = result.snapshots[0].estimated_cost;
        const lastCost = result.snapshots[result.snapshots.length - 1].estimated_cost;
        assert.ok(lastCost > firstCost, `last cost (${lastCost}) should be > first (${firstCost})`);
        assert.ok(result.summary.estimated_total_cost > 0);
    });
    it('cost is proportional to pod count', async () => {
        const config1 = makeConfig({
            service: { ...SVC, min_replicas: 2, cost_per_replica_hour: 1.0, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 9999 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 10 } } },
        });
        const config5 = makeConfig({
            service: { ...SVC, min_replicas: 5, cost_per_replica_hour: 1.0, metric_observation_delay: 0, cooldown_scale_up: 9999, cooldown_scale_down: 9999 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 10 } } },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
        });
        const result = await svc.run(config);
        // Always over capacity → 100% under-provisioned
        assert.ok(result.summary.time_under_provisioned_percent > 90);
    });
    it('zero drops when capacity is sufficient', async () => {
        const config = makeConfig({
            service: { ...SVC, min_replicas: 10, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 100 } } },
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
            service: { ...SVC, min_replicas: 5, max_replicas: 20, capacity_per_replica: 100, pod_failure_rate: 5, random_seed: 42, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
        });
        const result1 = await svc.run(config);
        const result2 = await svc.run(config);
        assert.deepStrictEqual(result1.snapshots, result2.snapshots);
        assert.deepStrictEqual(result1.summary, result2.summary);
    });
    it('produces different results with different seeds', async () => {
        const baseConfig = makeConfig({
            simulation: { duration: 60, tick_interval: 1 },
            service: { ...SVC, min_replicas: 5, max_replicas: 20, capacity_per_replica: 100, pod_failure_rate: 10, random_seed: 1, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
        });
        const result1 = await svc.run(baseConfig);
        const result2 = await svc.run({ ...baseConfig, service: { ...baseConfig.service, random_seed: 999 } });
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
            service: { ...SVC, min_replicas: 5, max_replicas: 5, capacity_per_replica: 100, failure_events: [{ time: 10, count: 3 }] },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 100 } } },
        });
        const result = await svc.run(config);
        // Before event: 5 running. At t=10: 3 killed → 2 running
        const atEvent = result.snapshots[10];
        assert.equal(atEvent.running_pods, 2, `expected 2 running pods at t=10, got ${atEvent.running_pods}`);
    });
    it('does not kill more pods than are running', async () => {
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 2, max_replicas: 2, capacity_per_replica: 100, failure_events: [{ time: 5, count: 10 }] },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 1, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
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
            service: { ...SVC, min_replicas: 2, max_replicas: 20, capacity_per_replica: 100, startup_time: 1, scale_up_step: 5, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 5, node_provisioning_time: 0, graceful_shutdown_time: 1 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 50, spike_rps: 1500, spike_start: 5, spike_duration: 20 },
                } },
        });
        const result = await svc.run(config);
        const scaleDownLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.startsWith('Scaled down'));
        assert.ok(scaleDownLogs.length > 0, 'should have at least one scale-down log');
        assert.ok(scaleDownLogs[0].includes('below'), 'scale-down log should mention below threshold');
    });
    it('logs scheduled failure events', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 5, max_replicas: 5, capacity_per_replica: 100, failure_events: [{ time: 10, count: 3 }] },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 100 } } },
        });
        const result = await svc.run(config);
        const failureLogs = result.snapshots[10].log_entries.filter(l => l.includes('Scheduled failure'));
        assert.ok(failureLogs.length === 1, 'should have one scheduled failure log at t=10');
        assert.ok(failureLogs[0].includes('3'), 'should mention 3 pods killed');
    });
    it('logs pod lifecycle transitions', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 5, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
        });
        const result = await svc.run(config);
        const readyLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('finished starting'));
        assert.ok(readyLogs.length > 0, 'should log when pods finish starting');
    });
    it('logs drop start and recovery', async () => {
        const config = makeConfig({
            simulation: { duration: 120, tick_interval: 1 },
            service: { ...SVC, min_replicas: 2, max_replicas: 30, capacity_per_replica: 100, startup_time: 1, scale_up_step: 10, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 100, spike_rps: 2000, spike_start: 10, spike_duration: 20 },
                } },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 3, capacity_per_replica: 100, startup_time: 1, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 5000 } } },
        });
        const result = await svc.run(config);
        const maxLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.startsWith('At max replicas'));
        assert.ok(maxLogs.length > 0, 'should log max replicas warning');
    });
    it('logs cooldown blocking scale-up', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 50, capacity_per_replica: 100, startup_time: 1, scale_up_step: 1, metric_observation_delay: 0, cooldown_scale_up: 10, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 5000 } } },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const result = await svc.run(config);
        assert.equal(result.summary.total_dropped, 0, 'unlimited queue should never drop');
        assert.equal(result.summary.drop_rate_percent, 0);
    });
    it('builds up queue depth when traffic exceeds capacity', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 20, capacity_per_replica: 100, startup_time: 1, scale_up_step: 5, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 50, spike_rps: 1500, spike_start: 5, spike_duration: 20 },
                } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const result = await svc.run(config);
        // Queue should build during spike then drain after
        assert.ok(result.summary.peak_queue_depth > 0, 'queue should build during spike');
        const lastSnapshot = result.snapshots[result.snapshots.length - 1];
        assert.ok(lastSnapshot.queue_depth < result.summary.peak_queue_depth, `queue should drain: last=${lastSnapshot.queue_depth}, peak=${result.summary.peak_queue_depth}`);
    });
    it('tracks peak_queue_depth in summary', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 200 },
        });
        const result = await svc.run(config);
        assert.ok(result.summary.total_dropped > 0, 'bounded queue should eventually drop');
        assert.ok(result.summary.peak_queue_depth <= 200, `queue should not exceed max_size: peak=${result.summary.peak_queue_depth}`);
    });
    it('queue depth never exceeds max_size', async () => {
        const config = makeConfig({
            simulation: { duration: 60, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 1000 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 500 },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.ok(snap.queue_depth <= 500, `t=${snap.time}: queue_depth ${snap.queue_depth} exceeds max_size 500`);
        }
    });
    it('drops less than OLTP mode with same traffic', async () => {
        const baseConfig = makeConfig({
            simulation: { duration: 60, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 10, capacity_per_replica: 100, startup_time: 1, scale_up_step: 2, metric_observation_delay: 0, cooldown_scale_up: 0, cooldown_scale_down: 9999, node_provisioning_time: 0 },
            producer: { ...DEFAULT_PRODUCER, traffic: {
                    pattern: 'spike',
                    params: { base_rps: 50, spike_rps: 800, spike_start: 5, spike_duration: 15 },
                } },
        });
        const oltpResult = await svc.run({ ...baseConfig, broker: { ...DEFAULT_BROKER, enabled: false, max_size: 0 } });
        const queueResult = await svc.run({ ...baseConfig, broker: { ...DEFAULT_BROKER, enabled: true, max_size: 5000 } });
        assert.ok(queueResult.summary.total_dropped <= oltpResult.summary.total_dropped, `queue dropped (${queueResult.summary.total_dropped}) should be <= OLTP dropped (${oltpResult.summary.total_dropped})`);
    });
});
describe('SimulationService — queue disabled', () => {
    it('queue_depth is always 0 when queue is disabled', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: false, max_size: 1000 },
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
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: false, max_size: 0 },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            const total = snap.served_requests + snap.dropped_requests;
            assert.ok(Math.abs(total - snap.traffic_rps) < 0.01, `t=${snap.time}: served(${snap.served_requests}) + dropped(${snap.dropped_requests}) should equal traffic(${snap.traffic_rps})`);
        }
    });
});
describe('SimulationService — queue log entries', () => {
    it('logs queue depth when buffering', async () => {
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const result = await svc.run(config);
        const queueLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('Queue depth'));
        assert.ok(queueLogs.length > 0, 'should log queue depth when buffering');
        assert.ok(queueLogs[0].includes('buffered'), 'queue log should mention buffered requests');
    });
    it('logs queue full when bounded queue overflows', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 1000 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 100 },
        });
        const result = await svc.run(config);
        const fullLogs = result.snapshots.flatMap(s => s.log_entries).filter(l => l.includes('Broker full'));
        assert.ok(fullLogs.length > 0, 'should log when broker is full and dropping');
    });
});
// ---------------------------------------------------------------------------
// Saturation model — capacity degradation under high utilization
// ---------------------------------------------------------------------------
describe('SimulationService — saturation capacity degradation', () => {
    it('reduces effective capacity when utilization exceeds saturation threshold', async () => {
        // Traffic 150 RPS vs capacity 100 RPS = 100% utilization (capped), well above 80% threshold
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100, saturation_threshold: 80, max_capacity_reduction: 0.5 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 150 } } },
        });
        const result = await svc.run(config);
        // Utilization is capped at 100%, which exceeds 80% threshold, so capacity degrades
        const degradedTicks = result.snapshots.filter(s => s.effective_capacity_rps < s.capacity_rps);
        assert.ok(degradedTicks.length > 0, 'should have ticks where effective capacity < base capacity');
        const lastSnap = result.snapshots[result.snapshots.length - 1];
        assert.ok(lastSnap.effective_capacity_rps < 100, `effective capacity (${lastSnap.effective_capacity_rps}) should be less than base (100)`);
    });
    it('does not degrade capacity when utilization is below threshold', async () => {
        // Traffic 50 RPS vs capacity 100 RPS = 50% utilization, below 80% threshold
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100, saturation_threshold: 80, max_capacity_reduction: 0.5 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.equal(snap.effective_capacity_rps, snap.capacity_rps, `t=${snap.time}: effective capacity should equal base when utilization (50%) is below threshold (80%)`);
        }
    });
    it('caps capacity reduction at max_capacity_reduction', async () => {
        // Traffic 200 RPS vs capacity 100 = 100% utilization (capped), max reduction 0.3
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100, saturation_threshold: 80, max_capacity_reduction: 0.3 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 200 } } },
        });
        const result = await svc.run(config);
        // Even at full saturation, effective capacity should never drop below 70% of base
        for (const snap of result.snapshots) {
            assert.ok(snap.effective_capacity_rps >= 70 - 0.01, `t=${snap.time}: effective capacity (${snap.effective_capacity_rps}) should be >= 70 (70% of 100)`);
        }
    });
    it('saturation is disabled when threshold is 0', async () => {
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100, saturation_threshold: 0, max_capacity_reduction: 0.5 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 150 } } },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.equal(snap.effective_capacity_rps, snap.capacity_rps, `t=${snap.time}: no degradation when threshold is 0`);
        }
    });
    it('works in OLTP mode without broker', async () => {
        // Saturation should degrade capacity even without a broker
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100, saturation_threshold: 80, max_capacity_reduction: 0.5 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 150 } } },
            broker: { ...DEFAULT_BROKER, enabled: false },
        });
        const result = await svc.run(config);
        const degradedTicks = result.snapshots.filter(s => s.effective_capacity_rps < s.capacity_rps);
        assert.ok(degradedTicks.length > 0, 'saturation should degrade capacity even without broker');
    });
});
describe('SimulationService — queue wait time', () => {
    it('calculates wait time proportional to queue depth', async () => {
        const config = makeConfig({
            simulation: { duration: 20, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const result = await svc.run(config);
        // Wait time should increase as queue grows
        const midWait = result.snapshots[10].queue_wait_time_ms;
        const endWait = result.snapshots[19].queue_wait_time_ms;
        assert.ok(endWait > midWait, `wait time should grow: mid=${midWait}ms, end=${endWait}ms`);
        assert.ok(result.summary.peak_queue_wait_time_ms > 0, 'peak wait time should be > 0');
        assert.ok(result.summary.avg_queue_wait_time_ms > 0, 'avg wait time should be > 0');
    });
    it('wait time is 0 when queue is empty', async () => {
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 10, max_replicas: 10, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.equal(snap.queue_wait_time_ms, 0, `t=${snap.time}: wait time should be 0 when queue is empty`);
        }
    });
});
describe('SimulationService — request timeout/expiry', () => {
    it('expires requests that exceed the timeout', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0, request_timeout_ms: 2000 },
        });
        const result = await svc.run(config);
        const totalExpired = result.snapshots.reduce((acc, s) => acc + s.expired_requests, 0);
        assert.ok(totalExpired > 0, 'should expire requests when wait time exceeds timeout');
        assert.ok(result.summary.total_expired > 0, 'summary should track total expired');
    });
    it('limits queue growth compared to no timeout', async () => {
        const baseConfig = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0 },
        });
        const noTimeout = await svc.run(baseConfig);
        const withTimeout = await svc.run({
            ...baseConfig,
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0, request_timeout_ms: 2000 },
        });
        // Timeout should significantly limit queue growth vs unbounded
        assert.ok(withTimeout.summary.peak_queue_depth < noTimeout.summary.peak_queue_depth, `timeout peak (${withTimeout.summary.peak_queue_depth}) should be less than no-timeout peak (${noTimeout.summary.peak_queue_depth})`);
        // Queue should reach a steady state rather than growing unboundedly
        const lastSnap = withTimeout.snapshots[withTimeout.snapshots.length - 1];
        const midSnap = withTimeout.snapshots[Math.floor(withTimeout.snapshots.length / 2)];
        // With timeout, queue should plateau rather than growing linearly
        assert.ok(lastSnap.queue_depth < noTimeout.snapshots[noTimeout.snapshots.length - 1].queue_depth, 'timeout queue should be smaller than unbounded at end');
    });
    it('does not expire when timeout is 0 (disabled)', async () => {
        const config = makeConfig({
            simulation: { duration: 20, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0, request_timeout_ms: 0 },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.equal(snap.expired_requests, 0, `t=${snap.time}: no expiry when timeout is 0`);
        }
    });
});
describe('SimulationService — retry storms', () => {
    it('retries amplify traffic when enabled', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            client: { ...DEFAULT_CLIENT, max_retries: 3 },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 200 },
        });
        const result = await svc.run(config);
        // Retry traffic should appear after the first drops
        const retryTicks = result.snapshots.filter(s => s.retry_requests > 0);
        assert.ok(retryTicks.length > 0, 'should have ticks with retry traffic');
        assert.ok(result.summary.total_retries > 0, 'summary should track total retries');
    });
    it('no retries when max_retries is 0', async () => {
        const config = makeConfig({
            simulation: { duration: 20, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            client: { ...DEFAULT_CLIENT, max_retries: 0 },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 200 },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.equal(snap.retry_requests, 0, `t=${snap.time}: no retries when max_retries is 0`);
        }
    });
    it('retries from expired requests trigger when both timeout and retries are configured', async () => {
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 500 } } },
            client: { ...DEFAULT_CLIENT, max_retries: 3 },
            broker: { ...DEFAULT_BROKER, enabled: true, max_size: 0, request_timeout_ms: 2000 },
        });
        const result = await svc.run(config);
        // Both expiry and retries should be present
        assert.ok(result.summary.total_expired > 0, 'should have expired requests');
        assert.ok(result.summary.total_retries > 0, 'expired requests should trigger retries');
    });
    it('requests are permanently dropped after max retries exhausted', async () => {
        // With max_retries=1, each failed request gets 1 retry then is dropped
        const config = makeConfig({
            simulation: { duration: 20, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 200 } } },
            client: { ...DEFAULT_CLIENT, max_retries: 1 },
        });
        const result = await svc.run(config);
        // With max_retries=1, retry traffic should be bounded (not growing without limit)
        // Later ticks should show stable retry traffic, not exponential growth
        const laterRetries = result.snapshots.slice(5).map(s => s.retry_requests);
        const maxRetry = Math.max(...laterRetries);
        // Retries should exist but not exceed fresh traffic (bounded by 1 attempt)
        assert.ok(maxRetry > 0, 'should have retry traffic');
        assert.ok(maxRetry <= 200, 'retry traffic should be bounded by fresh traffic rate');
    });
    it('retry_delay defers retries by the configured number of seconds', async () => {
        // Traffic 200 RPS, capacity 100 RPS, retry_delay 5s
        // First drops at tick 0, retries should not appear until tick 5
        const config = makeConfig({
            simulation: { duration: 15, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 200 } } },
            client: { max_retries: 3, retry_delay: 5, retry_strategy: 'fixed' },
        });
        const result = await svc.run(config);
        // First few ticks should have no retry traffic (delay hasn't elapsed)
        for (let i = 0; i < 5; i++) {
            assert.equal(result.snapshots[i].retry_requests, 0, `t=${result.snapshots[i].time}: no retries before delay elapses`);
        }
        // After delay, retries should appear
        const laterRetries = result.snapshots.slice(5).filter(s => s.retry_requests > 0);
        assert.ok(laterRetries.length > 0, 'retries should appear after delay');
    });
});
// ---------------------------------------------------------------------------
// Retry strategies — exponential backoff and jitter
// ---------------------------------------------------------------------------
describe('SimulationService — retry strategies', () => {
    it('exponential backoff increases delay with each attempt', async () => {
        // base_delay=2s, exponential: attempt 0 → 2s, attempt 1 → 4s, attempt 2 → 8s
        // With fixed delay=2s all retries arrive at tick+2
        const fixedConfig = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
            client: { max_retries: 3, retry_delay: 2, retry_strategy: 'fixed' },
        });
        const fixedResult = await svc.run(fixedConfig);
        const expConfig = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
            client: { max_retries: 3, retry_delay: 2, retry_strategy: 'exponential' },
        });
        const expResult = await svc.run(expConfig);
        // Exponential should spread retries more widely over time
        // Fixed retries all arrive 2 ticks after failure; exponential arrives at 2, 4, 8 ticks
        // So the first retry tick with traffic should be similar, but later retry traffic is more spread
        const fixedRetryTicks = fixedResult.snapshots.filter(s => s.retry_requests > 0).length;
        const expRetryTicks = expResult.snapshots.filter(s => s.retry_requests > 0).length;
        assert.ok(expRetryTicks >= fixedRetryTicks, `exponential should spread retries across at least as many ticks: exp=${expRetryTicks}, fixed=${fixedRetryTicks}`);
    });
    it('exponential backoff delays later attempts longer', async () => {
        // With base_delay=1s, exponential: attempt 0 → 1 tick, attempt 1 → 2 ticks, attempt 2 → 4 ticks
        // We verify that retries still appear later in the simulation
        const config = makeConfig({
            simulation: { duration: 20, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
            client: { max_retries: 3, retry_delay: 1, retry_strategy: 'exponential' },
        });
        const result = await svc.run(config);
        // Retries should appear
        const retryTicks = result.snapshots.filter(s => s.retry_requests > 0);
        assert.ok(retryTicks.length > 0, 'exponential retries should generate retry traffic');
        assert.ok(result.summary.total_retries > 0, 'summary should track retry totals');
    });
    it('exponential-jitter adds variation to retry timing', async () => {
        // Use a deterministic seed so jitter is reproducible
        const config = makeConfig({
            simulation: { duration: 30, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100, random_seed: 42 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 300 } } },
            client: { max_retries: 3, retry_delay: 2, retry_strategy: 'exponential-jitter' },
        });
        const result = await svc.run(config);
        // Jitter retries should still appear and work
        const retryTicks = result.snapshots.filter(s => s.retry_requests > 0);
        assert.ok(retryTicks.length > 0, 'jitter retries should produce retry traffic');
        assert.ok(result.summary.total_retries > 0, 'summary should track jitter retry totals');
    });
    it('fixed strategy with retry_delay=0 retries on next tick', async () => {
        const config = makeConfig({
            simulation: { duration: 10, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 200 } } },
            client: { max_retries: 1, retry_delay: 0, retry_strategy: 'fixed' },
        });
        const result = await svc.run(config);
        // Retries should appear starting from tick 1 (next tick after first drops)
        assert.equal(result.snapshots[0].retry_requests, 0, 'no retries on first tick');
        const hasRetries = result.snapshots.slice(1).some(s => s.retry_requests > 0);
        assert.ok(hasRetries, 'retries should appear from tick 1 onwards');
    });
});
describe('SimulationService — saturation new snapshot fields', () => {
    it('includes all new fields in snapshots with defaults', async () => {
        const config = makeConfig({
            simulation: { duration: 5, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
        });
        const result = await svc.run(config);
        for (const snap of result.snapshots) {
            assert.equal(typeof snap.queue_wait_time_ms, 'number');
            assert.equal(typeof snap.expired_requests, 'number');
            assert.equal(typeof snap.retry_requests, 'number');
            assert.equal(typeof snap.effective_capacity_rps, 'number');
            assert.equal(snap.expired_requests, 0);
            assert.equal(snap.retry_requests, 0);
        }
    });
    it('includes all new fields in summary with defaults', async () => {
        const config = makeConfig({
            simulation: { duration: 5, tick_interval: 1 },
            service: { ...SVC, min_replicas: 1, max_replicas: 1, capacity_per_replica: 100 },
            producer: { ...DEFAULT_PRODUCER, traffic: { pattern: 'steady', params: { rps: 50 } } },
        });
        const result = await svc.run(config);
        assert.equal(typeof result.summary.avg_queue_wait_time_ms, 'number');
        assert.equal(typeof result.summary.peak_queue_wait_time_ms, 'number');
        assert.equal(typeof result.summary.total_expired, 'number');
        assert.equal(typeof result.summary.total_retries, 'number');
    });
});
//# sourceMappingURL=simulation.test.js.map