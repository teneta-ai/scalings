// ============================================================================
// scalings.xyz — Simulation Service (Local/Browser Implementation)
// ============================================================================
import { LocalTrafficPatternService } from './traffic.js';
export class LocalSimulationService {
    constructor(trafficService) {
        this.trafficService = trafficService || new LocalTrafficPatternService();
    }
    /** Simple seeded PRNG (mulberry32). Returns a function that produces values in [0, 1). */
    createRng(seed) {
        let s = seed | 0;
        return () => {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    async run(config) {
        const { simulation, scaling, advanced, chaos, traffic, queue } = config;
        const totalTicks = Math.ceil(simulation.duration / simulation.tick_interval);
        // Generate traffic pattern
        const trafficData = this.trafficService.generate(traffic, simulation.duration, simulation.tick_interval);
        // Set up random number generator (seeded or Math.random)
        const rng = chaos.random_seed > 0
            ? this.createRng(chaos.random_seed)
            : Math.random;
        // Pre-process scheduled failure events into a time-indexed map
        const failureEventMap = new Map();
        for (const evt of chaos.failure_events) {
            const existing = failureEventMap.get(evt.time) || 0;
            failureEventMap.set(evt.time, existing + evt.count);
        }
        // State
        let pods = [];
        let nextPodId = 0;
        let lastScaleUpTime = -Infinity;
        let lastScaleDownTime = -Infinity;
        let cumulativeCost = 0;
        const snapshots = [];
        // Queue state
        let queuedRequests = 0;
        // Utilization history for delayed observation
        const utilizationHistory = [];
        // Initialize with min replicas (already running)
        for (let i = 0; i < scaling.min_replicas; i++) {
            pods.push({ id: nextPodId++, state: 'running', stateTimer: 0, needsNodeProvisioning: false });
        }
        // Count total pods on existing nodes for node provisioning tracking
        let totalPodsEverScheduled = scaling.min_replicas;
        // Track state transitions for logging
        let prevDropping = false;
        for (let tick = 0; tick < totalTicks; tick++) {
            const time = tick * simulation.tick_interval;
            const currentTraffic = trafficData[tick] || 0;
            const logEntries = [];
            // --- Random pod failures ---
            if (chaos.pod_failure_rate > 0) {
                const failureProbability = chaos.pod_failure_rate / 100;
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
            const podsToRemove = [];
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
                }
                else if (pod.state === 'shutting_down') {
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
            let scaleEvent = null;
            // Scale up check
            const scaleUpThresholdFraction = scaling.scale_up_threshold / 100;
            if (delayedUtilization > scaleUpThresholdFraction
                && (time - lastScaleUpTime) >= advanced.cooldown_scale_up
                && allPodsCount < scaling.max_replicas) {
                const podsToAdd = Math.min(scaling.scale_up_step, scaling.max_replicas - allPodsCount);
                let needsNewNode = false;
                for (let i = 0; i < podsToAdd; i++) {
                    // Check if we need node provisioning (new node when pods exceed current node capacity)
                    let startupDelay = scaling.startup_time;
                    const currentNodePods = totalPodsEverScheduled % advanced.pods_per_node;
                    const nodesUsed = Math.ceil(totalPodsEverScheduled / advanced.pods_per_node);
                    if (currentNodePods === 0 && totalPodsEverScheduled > 0
                        && advanced.node_provisioning_time > 0
                        && nodesUsed < advanced.cluster_node_capacity) {
                        startupDelay += advanced.node_provisioning_time;
                        needsNewNode = true;
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
                let msg = `Scaled up +${podsToAdd} pod${podsToAdd > 1 ? 's' : ''}: observed utilization ${(delayedUtilization * 100).toFixed(0)}% exceeds ${scaling.scale_up_threshold}% threshold`;
                if (needsNewNode)
                    msg += ' (provisioning new node)';
                logEntries.push(msg);
            }
            else if (delayedUtilization > scaleUpThresholdFraction && allPodsCount >= scaling.max_replicas) {
                logEntries.push(`At max replicas (${scaling.max_replicas}), cannot scale up despite ${(delayedUtilization * 100).toFixed(0)}% utilization`);
            }
            else if (delayedUtilization > scaleUpThresholdFraction
                && (time - lastScaleUpTime) < advanced.cooldown_scale_up) {
                const remaining = advanced.cooldown_scale_up - (time - lastScaleUpTime);
                logEntries.push(`Scale-up needed but cooldown active (${remaining}s remaining)`);
            }
            // Scale down check
            const scaleDownThresholdFraction = scaling.scale_down_threshold / 100;
            if (delayedUtilization < scaleDownThresholdFraction
                && (time - lastScaleDownTime) >= advanced.cooldown_scale_down
                && runningPods.length > scaling.min_replicas) {
                const podsToRemoveCount = Math.min(scaling.scale_down_step, runningPods.length - scaling.min_replicas);
                // Start graceful shutdown for selected pods
                for (let i = 0; i < podsToRemoveCount; i++) {
                    const pod = runningPods[runningPods.length - 1 - i];
                    if (pod) {
                        pod.state = 'shutting_down';
                        pod.stateTimer = advanced.graceful_shutdown_time;
                    }
                }
                lastScaleDownTime = time;
                if (scaleEvent === null)
                    scaleEvent = 'down';
                logEntries.push(`Scaled down -${podsToRemoveCount} pod${podsToRemoveCount > 1 ? 's' : ''}: observed utilization ${(delayedUtilization * 100).toFixed(0)}% below ${scaling.scale_down_threshold}% threshold`);
            }
            else if (delayedUtilization < scaleDownThresholdFraction
                && runningPods.length <= scaling.min_replicas
                && runningPods.length > 0
                && delayedUtilization > 0) {
                logEntries.push(`Already at min replicas (${scaling.min_replicas}), cannot scale down further`);
            }
            // --- Resolve overflow (OLTP drop vs Queue buffer) ---
            const overflow = this.resolveOverflow(currentTraffic, capacity, queuedRequests, queue);
            const { served, dropped } = overflow;
            queuedRequests = overflow.queueDepth;
            for (const msg of overflow.logEntries)
                logEntries.push(msg);
            // Log drop transitions
            if (dropped > 0 && !prevDropping) {
                if (queue.enabled) {
                    logEntries.push(`Queue full — dropping requests: ${Math.round(dropped)} RPS overflow (queue max: ${queue.max_size})`);
                }
                else {
                    logEntries.push(`Dropping requests: traffic ${Math.round(currentTraffic)} RPS exceeds capacity ${Math.round(capacity)} RPS (${Math.round(dropped)} RPS dropped)`);
                }
                prevDropping = true;
            }
            else if (dropped === 0 && prevDropping) {
                logEntries.push(`Recovered: capacity ${Math.round(capacity)} RPS now meets traffic ${Math.round(currentTraffic)} RPS`);
                prevDropping = false;
            }
            // Cost calculation: per-tick cost for all non-terminated pods
            const tickHours = simulation.tick_interval / 3600;
            const billablePods = pods.length; // All pods incur cost
            cumulativeCost += billablePods * advanced.cost_per_replica_hour * tickHours;
            // Re-count pod states after autoscaler decisions for accurate snapshot
            let snapshotRunning = 0;
            let snapshotStarting = 0;
            let snapshotShuttingDown = 0;
            for (const pod of pods) {
                if (pod.state === 'running')
                    snapshotRunning++;
                else if (pod.state === 'starting')
                    snapshotStarting++;
                else if (pod.state === 'shutting_down')
                    snapshotShuttingDown++;
            }
            snapshots.push({
                time,
                traffic_rps: currentTraffic,
                capacity_rps: capacity,
                running_pods: snapshotRunning,
                total_pods: pods.length,
                starting_pods: snapshotStarting,
                shutting_down_pods: snapshotShuttingDown,
                served_requests: served,
                dropped_requests: dropped,
                queue_depth: queuedRequests,
                utilization: Math.min(utilization, 2), // Cap display at 200%
                delayed_utilization: Math.min(delayedUtilization, 2),
                estimated_cost: cumulativeCost,
                scale_event: scaleEvent,
                log_entries: logEntries,
            });
        }
        const summary = this.calculateSummary(snapshots, simulation.tick_interval);
        return { snapshots, summary };
    }
    /**
     * Determines how overflow traffic is handled for a single tick.
     * OLTP mode: excess is dropped immediately.
     * Queue mode: excess is buffered, only dropped when queue is full.
     */
    resolveOverflow(traffic, capacity, currentQueueDepth, queue) {
        const logEntries = [];
        if (!queue.enabled) {
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
        let queueDepth;
        let dropped;
        if (queue.max_size > 0) {
            queueDepth = Math.min(unserved, queue.max_size);
            dropped = Math.max(0, unserved - queue.max_size);
        }
        else {
            // max_size 0 = unlimited queue
            queueDepth = unserved;
            dropped = 0;
        }
        if (queueDepth > 0) {
            logEntries.push(`Queue depth: ${Math.round(queueDepth)} requests buffered`);
        }
        return { served, dropped, queueDepth, logEntries };
    }
    calculateSummary(snapshots, tickInterval) {
        let totalRequests = 0;
        let totalServed = 0;
        let totalDropped = 0;
        let peakPods = 0;
        let minPods = Infinity;
        let peakQueueDepth = 0;
        let underProvisionedTicks = 0;
        // Track recovery: time from first drop to when system stabilizes
        let firstDropTime = null;
        let lastDropTime = null;
        for (const snap of snapshots) {
            totalRequests += snap.traffic_rps * tickInterval;
            totalServed += snap.served_requests * tickInterval;
            totalDropped += snap.dropped_requests * tickInterval;
            peakPods = Math.max(peakPods, snap.total_pods);
            minPods = Math.min(minPods, snap.running_pods);
            peakQueueDepth = Math.max(peakQueueDepth, snap.queue_depth);
            if (snap.dropped_requests > 0) {
                underProvisionedTicks++;
                if (firstDropTime === null)
                    firstDropTime = snap.time;
                lastDropTime = snap.time;
            }
        }
        // Find the first tick after all drops have ceased where capacity meets traffic
        let recoveredTime = null;
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
            time_under_provisioned_seconds: underProvisionedSeconds,
            time_under_provisioned_percent: totalDuration > 0 ? (underProvisionedSeconds / totalDuration) * 100 : 0,
            time_to_recover_seconds: firstDropTime !== null && recoveredTime !== null ? recoveredTime - firstDropTime : null,
            estimated_total_cost: snapshots.length > 0 ? snapshots[snapshots.length - 1].estimated_cost : 0,
        };
    }
}
//# sourceMappingURL=simulation.js.map