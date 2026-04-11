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
  BrokerConfig,
  ServiceConfig,
  TrafficPatternService,
  RetryStrategy,
} from '../interfaces/types.js';
import { LocalTrafficPatternService } from './traffic.js';

export class LocalSimulationService implements SimulationService {
  private trafficService: TrafficPatternService;
  private runCounter: number = 0;

  constructor(trafficService?: TrafficPatternService) {
    this.trafficService = trafficService || new LocalTrafficPatternService();
  }

  /** Generate a short unique run ID: counter + random hex suffix. */
  private generateRunId(): string {
    this.runCounter++;
    const suffix = Math.random().toString(16).slice(2, 8);
    return `run-${this.runCounter}-${suffix}`;
  }

  /** Simple seeded PRNG (mulberry32). Returns a function that produces values in [0, 1). */
  private createRng(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async run(config: SimulationConfig): Promise<SimulationResult> {
    const { simulation, producer, client, broker, service } = config;
    const totalTicks = Math.ceil(simulation.duration / simulation.tick_interval);

    // Generate traffic pattern
    const trafficData = this.trafficService.generate(producer.traffic, simulation.duration, simulation.tick_interval);

    // Set up random number generator (seeded or Math.random)
    const rng = service.random_seed > 0
      ? this.createRng(service.random_seed)
      : Math.random;

    // Pre-process scheduled failure events into a time-indexed map
    const failureEventMap = new Map<number, number>();
    for (const evt of service.failure_events) {
      const existing = failureEventMap.get(evt.time) || 0;
      failureEventMap.set(evt.time, existing + evt.count);
    }

    // State
    let pods: Pod[] = [];
    let nextPodId = 0;
    let lastScaleUpTime = -Infinity;
    let lastScaleDownTime = -Infinity;
    let cumulativeCost = 0;
    const snapshots: TickSnapshot[] = [];

    // Queue state
    let queuedRequests = 0;
    // Retry queue: deferred batches with per-attempt counts
    const retryQueue: { tick: number, counts: number[] }[] = [];

    // Utilization history for delayed observation
    const utilizationHistory: number[] = [];

    // Initialize with min replicas (already running)
    for (let i = 0; i < service.min_replicas; i++) {
      pods.push({ id: nextPodId++, state: 'running', stateTimer: 0, needsNodeProvisioning: false });
    }

    // Count total pods on existing nodes for node provisioning tracking
    let totalPodsEverScheduled = service.min_replicas;

    // Track state transitions for logging
    let prevDropping = false;

    for (let tick = 0; tick < totalTicks; tick++) {
      const time = tick * simulation.tick_interval;
      const currentTraffic = trafficData[tick] || 0;
      const logEntries: string[] = [];

      // --- Random pod failures ---
      if (service.pod_failure_rate > 0) {
        const failureProbability = service.pod_failure_rate / 100;
        let randomKillCount = 0;
        pods = pods.filter(pod => {
          if (pod.state === 'running' && rng() < failureProbability) {
            randomKillCount++;
            return false;
          }
          return true;
        });
        if (randomKillCount > 0) {
          logEntries.push(`Random failure killed ${randomKillCount} pod${randomKillCount > 1 ? 's' : ''}`);
        }
      }

      // --- Scheduled failure events ---
      const scheduledKills = failureEventMap.get(time);
      if (scheduledKills && scheduledKills > 0) {
        let killed = 0;
        pods = pods.filter(pod => {
          if (killed < scheduledKills && pod.state === 'running') {
            killed++;
            return false;
          }
          return true;
        });
        if (killed > 0) {
          logEntries.push(`Scheduled failure killed ${killed} pod${killed > 1 ? 's' : ''}`);
        }
      }

      // --- Update pod states ---
      const podsToRemove: number[] = [];
      let becameReady = 0;
      let finishedShutdown = 0;
      for (const pod of pods) {
        if (pod.state === 'starting') {
          pod.stateTimer -= simulation.tick_interval;
          if (pod.stateTimer <= 0) {
            pod.state = 'running';
            pod.stateTimer = 0;
            becameReady++;
          }
        } else if (pod.state === 'shutting_down') {
          pod.stateTimer -= simulation.tick_interval;
          if (pod.stateTimer <= 0) {
            podsToRemove.push(pod.id);
            finishedShutdown++;
          }
        }
      }
      pods = pods.filter(p => !podsToRemove.includes(p.id));

      if (becameReady > 0) {
        logEntries.push(`${becameReady} pod${becameReady > 1 ? 's' : ''} finished starting and is now running`);
      }
      if (finishedShutdown > 0) {
        logEntries.push(`${finishedShutdown} pod${finishedShutdown > 1 ? 's' : ''} completed graceful shutdown and terminated`);
      }

      // --- Inject retry traffic that is ready ---
      const readyByAttempt = new Array(client.max_retries).fill(0);
      let retryTraffic = 0;
      for (let i = retryQueue.length - 1; i >= 0; i--) {
        if (retryQueue[i].tick <= tick) {
          for (let k = 0; k < client.max_retries; k++) {
            readyByAttempt[k] += retryQueue[i].counts[k];
          }
          retryQueue.splice(i, 1);
        }
      }
      for (let k = 0; k < readyByAttempt.length; k++) {
        retryTraffic += readyByAttempt[k];
      }
      const effectiveTraffic = currentTraffic + retryTraffic;

      // --- Calculate capacity ---
      const runningPods = pods.filter(p => p.state === 'running');
      // Pods shutting down still serve traffic during graceful shutdown
      const shuttingDownPods = pods.filter(p => p.state === 'shutting_down');
      const startingPods = pods.filter(p => p.state === 'starting');

      const servingPods = runningPods.length + shuttingDownPods.length;
      const baseCapacity = servingPods * service.capacity_per_replica;

      // --- Saturation: degrade capacity when utilization is high ---
      const rawUtilization = baseCapacity > 0 ? Math.min(effectiveTraffic, baseCapacity) / baseCapacity : 0;
      const effectiveCapacity = this.applySaturation(baseCapacity, rawUtilization, service);
      const capacity = effectiveCapacity;

      const utilization = capacity > 0 ? effectiveTraffic / capacity : (effectiveTraffic > 0 ? Infinity : 0);

      // Store utilization for delayed observation
      utilizationHistory.push(utilization);

      // Get delayed utilization
      const delayTicks = Math.ceil(service.metric_observation_delay / simulation.tick_interval);
      const delayedIndex = Math.max(0, tick - delayTicks);
      const delayedUtilization = delayedIndex < utilizationHistory.length
        ? utilizationHistory[delayedIndex]
        : utilization;

      // --- Autoscaler decision ---
      const allPodsCount = pods.length;
      let scaleEvent: 'up' | 'down' | null = null;

      // Scale up check
      const scaleUpThresholdFraction = service.scale_up_threshold / 100;
      if (delayedUtilization > scaleUpThresholdFraction
        && (time - lastScaleUpTime) >= service.cooldown_scale_up
        && allPodsCount < service.max_replicas) {
        const podsToAdd = Math.min(service.scale_up_step, service.max_replicas - allPodsCount);
        let needsNewNode = false;
        for (let i = 0; i < podsToAdd; i++) {
          // Check if we need node provisioning (new node when pods exceed current node capacity)
          let startupDelay = service.startup_time;
          const currentNodePods = totalPodsEverScheduled % service.pods_per_node;
          const nodesUsed = Math.ceil(totalPodsEverScheduled / service.pods_per_node);
          if (currentNodePods === 0 && totalPodsEverScheduled > 0
            && service.node_provisioning_time > 0
            && nodesUsed < service.cluster_node_capacity) {
            startupDelay += service.node_provisioning_time;
            needsNewNode = true;
          }
          pods.push({
            id: nextPodId++,
            state: 'starting',
            stateTimer: startupDelay,
            needsNodeProvisioning: startupDelay > service.startup_time,
          });
          totalPodsEverScheduled++;
        }
        lastScaleUpTime = time;
        scaleEvent = 'up';
        let msg = `Scaled up +${podsToAdd} pod${podsToAdd > 1 ? 's' : ''}: observed utilization ${(delayedUtilization * 100).toFixed(0)}% exceeds ${service.scale_up_threshold}% threshold`;
        if (needsNewNode) msg += ' (provisioning new node)';
        logEntries.push(msg);
      } else if (delayedUtilization > scaleUpThresholdFraction && allPodsCount >= service.max_replicas) {
        logEntries.push(`At max replicas (${service.max_replicas}), cannot scale up despite ${(delayedUtilization * 100).toFixed(0)}% utilization`);
      } else if (delayedUtilization > scaleUpThresholdFraction
        && (time - lastScaleUpTime) < service.cooldown_scale_up) {
        const remaining = service.cooldown_scale_up - (time - lastScaleUpTime);
        logEntries.push(`Scale-up needed but cooldown active (${remaining}s remaining)`);
      }

      // Scale down check
      const scaleDownThresholdFraction = service.scale_down_threshold / 100;
      if (delayedUtilization < scaleDownThresholdFraction
        && (time - lastScaleDownTime) >= service.cooldown_scale_down
        && runningPods.length > service.min_replicas) {
        const podsToRemoveCount = Math.min(
          service.scale_down_step,
          runningPods.length - service.min_replicas
        );
        // Start graceful shutdown for selected pods
        for (let i = 0; i < podsToRemoveCount; i++) {
          const pod = runningPods[runningPods.length - 1 - i];
          if (pod) {
            pod.state = 'shutting_down';
            pod.stateTimer = service.graceful_shutdown_time;
          }
        }
        lastScaleDownTime = time;
        if (scaleEvent === null) scaleEvent = 'down';
        logEntries.push(`Scaled down -${podsToRemoveCount} pod${podsToRemoveCount > 1 ? 's' : ''}: observed utilization ${(delayedUtilization * 100).toFixed(0)}% below ${service.scale_down_threshold}% threshold`);
      } else if (delayedUtilization < scaleDownThresholdFraction
        && runningPods.length <= service.min_replicas
        && runningPods.length > 0
        && delayedUtilization > 0) {
        logEntries.push(`Already at min replicas (${service.min_replicas}), cannot scale down further`);
      }

      // --- Expire timed-out requests from broker queue ---
      const expired = this.expireQueuedRequests(queuedRequests, capacity, broker);
      queuedRequests -= expired;
      if (expired > 0) {
        logEntries.push(`Expired ${Math.round(expired)} requests from broker (exceeded ${broker.request_timeout_ms}ms timeout)`);
      }

      // --- Resolve overflow (OLTP drop vs Broker buffer) ---
      const overflow = this.resolveOverflow(effectiveTraffic, capacity, queuedRequests, broker);
      const { served, dropped } = overflow;
      queuedRequests = overflow.queueDepth;

      for (const msg of overflow.logEntries) logEntries.push(msg);

      // --- Calculate queue wait time (Little's Law) ---
      const queueWaitTimeMs = capacity > 0 && queuedRequests > 0
        ? (queuedRequests / capacity) * 1000
        : 0;

      // --- Schedule retries ---
      if (client.max_retries > 0 && effectiveTraffic > 0) {
        const failedTotal = dropped + expired;
        const failRatio = effectiveTraffic > 0 ? failedTotal / effectiveTraffic : 0;

        // Distribute failures proportionally across fresh traffic and each retry cohort
        // Fresh failures → attempt 1, attempt K failures → attempt K+1, max reached → permanently dropped
        const freshFailed = Math.round(currentTraffic * failRatio);
        const nextRetries = new Array(client.max_retries).fill(0);
        nextRetries[0] = freshFailed; // fresh failures become attempt 1
        for (let k = 0; k < readyByAttempt.length - 1; k++) {
          nextRetries[k + 1] += Math.round(readyByAttempt[k] * failRatio); // promote to next attempt
        }
        // readyByAttempt[max_retries - 1] failures are permanently dropped (max reached)

        const totalScheduled = nextRetries.reduce((a, b) => a + b, 0);
        if (totalScheduled > 0) {
          // Schedule each attempt level with its own delay based on strategy
          for (let k = 0; k < client.max_retries; k++) {
            if (nextRetries[k] <= 0) continue;
            const delayTicks = this.computeRetryDelay(k, client.retry_delay, client.retry_strategy, simulation.tick_interval, rng);
            const counts = new Array(client.max_retries).fill(0);
            counts[k] = nextRetries[k];
            retryQueue.push({ tick: tick + delayTicks, counts });
          }
          const minDelay = this.computeRetryDelay(0, client.retry_delay, client.retry_strategy, simulation.tick_interval, rng);
          const minDelaySec = minDelay * simulation.tick_interval;
          const strategyLabel = client.retry_strategy === 'fixed' ? '' : ` [${client.retry_strategy}]`;
          logEntries.push(`${totalScheduled} requests will retry in ${minDelaySec}s+ (max ${client.max_retries} attempts)${strategyLabel}`);
        }
      }

      // Log drop transitions
      if (dropped > 0 && !prevDropping) {
        if (broker.enabled) {
          logEntries.push(`Broker full — dropping requests: ${Math.round(dropped)} RPS overflow (broker max: ${broker.max_size})`);
        } else {
          logEntries.push(`Dropping requests: traffic ${Math.round(effectiveTraffic)} RPS exceeds capacity ${Math.round(capacity)} RPS (${Math.round(dropped)} RPS dropped)`);
        }
        prevDropping = true;
      } else if (dropped === 0 && prevDropping) {
        logEntries.push(`Recovered: capacity ${Math.round(capacity)} RPS now meets traffic ${Math.round(effectiveTraffic)} RPS`);
        prevDropping = false;
      }

      // Log saturation if active
      if (service.saturation_threshold > 0 && capacity < baseCapacity) {
        const reductionPct = ((1 - capacity / baseCapacity) * 100).toFixed(0);
        logEntries.push(`Saturation: capacity reduced ${reductionPct}% (utilization ${(rawUtilization * 100).toFixed(0)}% exceeds threshold ${service.saturation_threshold}%)`);
      }

      // Cost calculation: per-tick cost for all non-terminated pods
      const tickHours = simulation.tick_interval / 3600;
      const billablePods = pods.length; // All pods incur cost
      cumulativeCost += billablePods * service.cost_per_replica_hour * tickHours;

      // Re-count pod states after autoscaler decisions for accurate snapshot
      let snapshotRunning = 0;
      let snapshotStarting = 0;
      let snapshotShuttingDown = 0;
      for (const pod of pods) {
        if (pod.state === 'running') snapshotRunning++;
        else if (pod.state === 'starting') snapshotStarting++;
        else if (pod.state === 'shutting_down') snapshotShuttingDown++;
      }

      snapshots.push({
        time,
        traffic_rps: currentTraffic,
        capacity_rps: baseCapacity,
        running_pods: snapshotRunning,
        total_pods: pods.length,
        starting_pods: snapshotStarting,
        shutting_down_pods: snapshotShuttingDown,
        served_requests: served,
        dropped_requests: dropped,
        queue_depth: queuedRequests,
        queue_wait_time_ms: queueWaitTimeMs,
        expired_requests: expired,
        retry_requests: retryTraffic,
        effective_capacity_rps: capacity,
        utilization: Math.min(utilization, 2), // Cap display at 200%
        delayed_utilization: Math.min(delayedUtilization, 2),
        estimated_cost: cumulativeCost,
        scale_event: scaleEvent,
        log_entries: logEntries,
      });
    }

    const summary = this.calculateSummary(snapshots, simulation.tick_interval);
    const run_id = this.generateRunId();

    return { run_id, snapshots, summary };
  }

  /**
   * Determines how overflow traffic is handled for a single tick.
   * OLTP mode: excess is dropped immediately.
   * Broker mode: excess is buffered, only dropped when broker is full.
   */
  private resolveOverflow(
    traffic: number,
    capacity: number,
    currentQueueDepth: number,
    broker: BrokerConfig,
  ): { served: number; dropped: number; queueDepth: number; logEntries: string[] } {
    const logEntries: string[] = [];

    if (!broker.enabled) {
      return {
        served: Math.min(traffic, capacity),
        dropped: Math.max(0, traffic - capacity),
        queueDepth: 0,
        logEntries,
      };
    }

    const totalDemand = traffic + currentQueueDepth;
    const served = Math.min(totalDemand, capacity);
    const unserved = totalDemand - served;

    let queueDepth: number;
    let dropped: number;
    if (broker.max_size > 0) {
      queueDepth = Math.min(unserved, broker.max_size);
      dropped = Math.max(0, unserved - broker.max_size);
    } else {
      // max_size 0 = unlimited broker queue
      queueDepth = unserved;
      dropped = 0;
    }

    if (queueDepth > 0) {
      logEntries.push(`Queue depth: ${Math.round(queueDepth)} requests buffered`);
    }

    return { served, dropped, queueDepth, logEntries };
  }

  /**
   * Reduces effective capacity when pod utilization exceeds the saturation threshold.
   * Models real-world degradation from CPU saturation, memory pressure, GC pauses,
   * and thread contention. Degradation is linear from threshold to 100% utilization.
   */
  private applySaturation(
    baseCapacity: number,
    utilization: number,
    service: ServiceConfig,
  ): number {
    if (service.saturation_threshold <= 0 || service.max_capacity_reduction <= 0) {
      return baseCapacity;
    }
    const threshold = service.saturation_threshold / 100;
    if (utilization <= threshold) {
      return baseCapacity;
    }

    const headroom = 1 - threshold;
    const factor = headroom > 0 ? Math.min(1, (utilization - threshold) / headroom) : 1;
    const reduction = factor * service.max_capacity_reduction;
    return baseCapacity * (1 - reduction);
  }

  /**
   * Expires queued requests that have been waiting longer than the configured timeout.
   * Uses Little's Law: wait_time = queue_depth / capacity.
   * Returns the number of requests expired.
   */
  private expireQueuedRequests(
    queueDepth: number,
    capacity: number,
    broker: BrokerConfig,
  ): number {
    if (!broker.enabled || broker.request_timeout_ms <= 0 || queueDepth <= 0 || capacity <= 0) {
      return 0;
    }

    const waitTimeMs = (queueDepth / capacity) * 1000;
    if (waitTimeMs <= broker.request_timeout_ms) {
      return 0;
    }

    // Trim queue to the depth where wait_time = timeout
    const maxQueueForTimeout = Math.floor(capacity * broker.request_timeout_ms / 1000);
    return Math.max(0, queueDepth - maxQueueForTimeout);
  }

  /**
   * Computes retry delay in ticks for a given attempt number and strategy.
   * attempt is 0-indexed (0 = first retry, 1 = second retry, etc.).
   */
  private computeRetryDelay(
    attempt: number,
    baseDelay: number,
    strategy: RetryStrategy,
    tickInterval: number,
    rng: () => number,
  ): number {
    let delaySec: number;
    switch (strategy) {
      case 'exponential':
        delaySec = (baseDelay || tickInterval) * Math.pow(2, attempt);
        break;
      case 'exponential-jitter':
        delaySec = (baseDelay || tickInterval) * Math.pow(2, attempt) * (0.5 + rng() * 0.5);
        break;
      case 'fixed':
      default:
        delaySec = baseDelay;
        break;
    }
    return Math.max(1, Math.ceil(delaySec / tickInterval));
  }

  private calculateSummary(snapshots: TickSnapshot[], tickInterval: number): SimulationSummary {
    let totalRequests = 0;
    let totalServed = 0;
    let totalDropped = 0;
    let peakPods = 0;
    let minPods = Infinity;
    let peakQueueDepth = 0;
    let totalWaitTimeMs = 0;
    let peakWaitTimeMs = 0;
    let waitTimeTicks = 0;
    let totalExpired = 0;
    let totalRetries = 0;
    let underProvisionedTicks = 0;

    // Track recovery: time from first drop to when system stabilizes
    let firstDropTime: number | null = null;
    let lastDropTime: number | null = null;

    for (const snap of snapshots) {
      totalRequests += snap.traffic_rps * tickInterval;
      totalServed += snap.served_requests * tickInterval;
      totalDropped += snap.dropped_requests * tickInterval;
      peakPods = Math.max(peakPods, snap.total_pods);
      minPods = Math.min(minPods, snap.running_pods);
      peakQueueDepth = Math.max(peakQueueDepth, snap.queue_depth);

      if (snap.queue_wait_time_ms > 0) {
        totalWaitTimeMs += snap.queue_wait_time_ms;
        waitTimeTicks++;
      }
      peakWaitTimeMs = Math.max(peakWaitTimeMs, snap.queue_wait_time_ms);
      totalExpired += snap.expired_requests * tickInterval;
      totalRetries += snap.retry_requests * tickInterval;

      if (snap.dropped_requests > 0) {
        underProvisionedTicks++;
        if (firstDropTime === null) firstDropTime = snap.time;
        lastDropTime = snap.time;
      }
    }

    // Find the first tick after all drops have ceased where capacity meets traffic
    let recoveredTime: number | null = null;
    if (lastDropTime !== null) {
      for (const snap of snapshots) {
        if (snap.time > lastDropTime && snap.dropped_requests === 0) {
          recoveredTime = snap.time;
          break;
        }
      }
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
      peak_queue_depth: peakQueueDepth,
      avg_queue_wait_time_ms: waitTimeTicks > 0 ? totalWaitTimeMs / waitTimeTicks : 0,
      peak_queue_wait_time_ms: peakWaitTimeMs,
      total_expired: Math.round(totalExpired),
      total_retries: Math.round(totalRetries),
      time_under_provisioned_seconds: underProvisionedSeconds,
      time_under_provisioned_percent: totalDuration > 0 ? (underProvisionedSeconds / totalDuration) * 100 : 0,
      time_to_recover_seconds: firstDropTime !== null && recoveredTime !== null ? recoveredTime - firstDropTime : null,
      estimated_total_cost: snapshots.length > 0 ? snapshots[snapshots.length - 1].estimated_cost : 0,
    };
  }
}
