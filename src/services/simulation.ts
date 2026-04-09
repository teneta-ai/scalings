// ============================================================================
// scalings.xyz — Simulation Service (Local/Browser Implementation)
// ============================================================================

import {
  SimulationService,
  SimulationConfig,
  SimulationResult,
  TickSnapshot,
  SimulationSummary,
  Pod,
  TrafficPatternService,
} from '../interfaces/types.js';
import { LocalTrafficPatternService } from './traffic.js';

export class LocalSimulationService implements SimulationService {
  private trafficService: TrafficPatternService;

  constructor(trafficService?: TrafficPatternService) {
    this.trafficService = trafficService || new LocalTrafficPatternService();
  }

  async run(config: SimulationConfig): Promise<SimulationResult> {
    const { simulation, scaling, advanced, traffic } = config;
    const totalTicks = Math.ceil(simulation.duration / simulation.tick_interval);

    // Generate traffic pattern
    const trafficData = this.trafficService.generate(traffic, simulation.duration, simulation.tick_interval);

    // State
    let pods: Pod[] = [];
    let nextPodId = 0;
    let lastScaleUpTime = -Infinity;
    let lastScaleDownTime = -Infinity;
    let cumulativeCost = 0;
    const snapshots: TickSnapshot[] = [];

    // Utilization history for delayed observation
    const utilizationHistory: number[] = [];

    // Initialize with min replicas (already running)
    for (let i = 0; i < scaling.min_replicas; i++) {
      pods.push({ id: nextPodId++, state: 'running', stateTimer: 0, needsNodeProvisioning: false });
    }

    // Count total pods on existing nodes for node provisioning tracking
    let totalPodsEverScheduled = scaling.min_replicas;

    for (let tick = 0; tick < totalTicks; tick++) {
      const time = tick * simulation.tick_interval;
      const currentTraffic = trafficData[tick] || 0;

      // --- Random pod failures ---
      if (advanced.pod_failure_rate > 0) {
        pods = pods.filter(pod => {
          if (pod.state === 'running' && Math.random() < advanced.pod_failure_rate) {
            return false; // Pod dies
          }
          return true;
        });
      }

      // --- Update pod states ---
      const podsToRemove: number[] = [];
      for (const pod of pods) {
        if (pod.state === 'starting') {
          pod.stateTimer -= simulation.tick_interval;
          if (pod.stateTimer <= 0) {
            pod.state = 'running';
            pod.stateTimer = 0;
          }
        } else if (pod.state === 'shutting_down') {
          pod.stateTimer -= simulation.tick_interval;
          if (pod.stateTimer <= 0) {
            podsToRemove.push(pod.id);
          }
        }
      }
      pods = pods.filter(p => !podsToRemove.includes(p.id));

      // --- Calculate capacity ---
      const runningPods = pods.filter(p => p.state === 'running');
      // Pods shutting down still serve traffic during graceful shutdown
      const shuttingDownPods = pods.filter(p => p.state === 'shutting_down');
      const startingPods = pods.filter(p => p.state === 'starting');

      const servingPods = runningPods.length + shuttingDownPods.length;
      const capacity = servingPods * scaling.capacity_per_replica;
      const utilization = capacity > 0 ? currentTraffic / capacity : (currentTraffic > 0 ? Infinity : 0);

      // Store utilization for delayed observation
      utilizationHistory.push(utilization);

      // Get delayed utilization
      const delayTicks = Math.ceil(advanced.metric_observation_delay / simulation.tick_interval);
      const delayedIndex = Math.max(0, tick - delayTicks);
      const delayedUtilization = delayedIndex < utilizationHistory.length
        ? utilizationHistory[delayedIndex]
        : utilization;

      // --- Autoscaler decision ---
      const allPodsCount = pods.length;
      let scaleEvent: 'up' | 'down' | null = null;

      // Scale up check
      if (delayedUtilization > scaling.scale_up_threshold / 100
        && (time - lastScaleUpTime) >= advanced.cooldown_scale_up
        && allPodsCount < scaling.max_replicas) {
        const podsToAdd = Math.min(scaling.scale_up_step, scaling.max_replicas - allPodsCount);
        for (let i = 0; i < podsToAdd; i++) {
          // Check if we need node provisioning
          let startupDelay = scaling.startup_time;
          const currentNodePods = totalPodsEverScheduled % advanced.cluster_node_capacity;
          if (currentNodePods === 0 && totalPodsEverScheduled > 0 && advanced.node_provisioning_time > 0) {
            startupDelay += advanced.node_provisioning_time;
          }
          pods.push({
            id: nextPodId++,
            state: 'starting',
            stateTimer: startupDelay,
            needsNodeProvisioning: startupDelay > scaling.startup_time,
          });
          totalPodsEverScheduled++;
        }
        lastScaleUpTime = time;
        scaleEvent = 'up';
      }

      // Scale down check
      if (delayedUtilization < scaling.scale_down_threshold / 100
        && (time - lastScaleDownTime) >= advanced.cooldown_scale_down
        && runningPods.length > scaling.min_replicas) {
        const podsToRemoveCount = Math.min(
          scaling.scale_down_step,
          runningPods.length - scaling.min_replicas
        );
        // Start graceful shutdown for selected pods
        for (let i = 0; i < podsToRemoveCount; i++) {
          const pod = runningPods[runningPods.length - 1 - i];
          if (pod) {
            pod.state = 'shutting_down';
            pod.stateTimer = advanced.graceful_shutdown_time;
          }
        }
        lastScaleDownTime = time;
        if (scaleEvent === null) scaleEvent = 'down';
      }

      // --- Calculate results ---
      const served = Math.min(currentTraffic, capacity);
      const dropped = Math.max(0, currentTraffic - capacity);

      // Cost calculation: per-tick cost for all non-terminated pods
      const tickHours = simulation.tick_interval / 3600;
      const billablePods = pods.length; // All pods incur cost
      cumulativeCost += billablePods * advanced.cost_per_replica_hour * tickHours;

      // Response time estimation: increases as utilization approaches 1
      // Using a simple M/M/1 queue model approximation
      const baseResponseTime = 10; // 10ms base
      const effectiveUtilization = Math.min(utilization, 0.99);
      const responseTime = capacity > 0
        ? baseResponseTime / (1 - effectiveUtilization)
        : currentTraffic > 0 ? 99999 : baseResponseTime;

      snapshots.push({
        time,
        traffic_rps: currentTraffic,
        capacity_rps: capacity,
        running_pods: runningPods.length,
        total_pods: pods.length,
        starting_pods: startingPods.length,
        shutting_down_pods: shuttingDownPods.length,
        served_requests: served,
        dropped_requests: dropped,
        utilization: Math.min(utilization, 2), // Cap display at 200%
        delayed_utilization: Math.min(delayedUtilization, 2),
        estimated_cost: cumulativeCost,
        scale_event: scaleEvent,
        response_time_ms: Math.min(responseTime, 99999),
      });
    }

    const summary = this.calculateSummary(snapshots, simulation.tick_interval);

    return { snapshots, summary };
  }

  private calculateSummary(snapshots: TickSnapshot[], tickInterval: number): SimulationSummary {
    let totalRequests = 0;
    let totalServed = 0;
    let totalDropped = 0;
    let peakPods = 0;
    let minPods = Infinity;
    let underProvisionedTicks = 0;
    let maxResponseTime = 0;
    let totalResponseTime = 0;

    // Track spike recovery
    let spikeDetected = false;
    let spikeEndTime: number | null = null;
    let recoveredTime: number | null = null;
    let previousTraffic = 0;

    for (const snap of snapshots) {
      totalRequests += snap.traffic_rps * tickInterval;
      totalServed += snap.served_requests * tickInterval;
      totalDropped += snap.dropped_requests * tickInterval;
      peakPods = Math.max(peakPods, snap.total_pods);
      minPods = Math.min(minPods, snap.running_pods);

      if (snap.dropped_requests > 0) {
        underProvisionedTicks++;
      }

      maxResponseTime = Math.max(maxResponseTime, snap.response_time_ms);
      totalResponseTime += snap.response_time_ms;

      // Simple spike detection: traffic doubles from one tick to next
      if (snap.traffic_rps > previousTraffic * 2 && previousTraffic > 0) {
        spikeDetected = true;
      }
      // After spike, when traffic returns to pre-spike levels
      if (spikeDetected && snap.traffic_rps < previousTraffic * 0.6 && !spikeEndTime) {
        spikeEndTime = snap.time;
      }
      // Recovery: after spike ended, capacity meets traffic again
      if (spikeEndTime && !recoveredTime && snap.capacity_rps >= snap.traffic_rps && snap.dropped_requests === 0) {
        recoveredTime = snap.time;
      }

      previousTraffic = snap.traffic_rps;
    }

    const totalDuration = snapshots.length * tickInterval;
    const underProvisionedSeconds = underProvisionedTicks * tickInterval;

    return {
      total_requests: Math.round(totalRequests),
      total_served: Math.round(totalServed),
      total_dropped: Math.round(totalDropped),
      drop_rate_percent: totalRequests > 0 ? (totalDropped / totalRequests) * 100 : 0,
      peak_pod_count: peakPods,
      min_pod_count: minPods === Infinity ? 0 : minPods,
      time_under_provisioned_seconds: underProvisionedSeconds,
      time_under_provisioned_percent: totalDuration > 0 ? (underProvisionedSeconds / totalDuration) * 100 : 0,
      time_to_recover_seconds: spikeEndTime && recoveredTime ? recoveredTime - spikeEndTime : null,
      estimated_total_cost: snapshots.length > 0 ? snapshots[snapshots.length - 1].estimated_cost : 0,
      max_response_time_ms: maxResponseTime,
      avg_response_time_ms: snapshots.length > 0 ? totalResponseTime / snapshots.length : 0,
    };
  }
}
