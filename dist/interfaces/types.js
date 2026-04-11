// ============================================================================
// scalings.xyz — Type Definitions
// ============================================================================
// --- Default Values ---
export const DEFAULT_SIMULATION = {
    duration: 600,
    tick_interval: 1,
};
export const DEFAULT_TRAFFIC = {
    pattern: 'spike',
    params: {
        base_rps: 200,
        spike_rps: 2000,
        spike_start: 120,
        spike_duration: 60,
    },
};
export const DEFAULT_PRODUCER = {
    traffic: DEFAULT_TRAFFIC,
};
export const DEFAULT_CLIENT = {
    max_retries: 0,
    retry_delay: 0,
    retry_strategy: 'fixed',
};
export const DEFAULT_BROKER = {
    enabled: false,
    max_size: 1000,
    request_timeout_ms: 0,
};
export const DEFAULT_SERVICE = {
    // Basic scaling
    min_replicas: 1,
    max_replicas: 50,
    scale_up_threshold: 80,
    scale_down_threshold: 30,
    capacity_per_replica: 100,
    startup_time: 30,
    scale_up_step: 4,
    scale_down_step: 1,
    // Advanced
    metric_observation_delay: 15,
    cooldown_scale_up: 15,
    cooldown_scale_down: 60,
    node_provisioning_time: 120,
    cluster_node_capacity: 20,
    pods_per_node: 10,
    graceful_shutdown_time: 30,
    cost_per_replica_hour: 0.05,
    // Saturation
    saturation_threshold: 0,
    max_capacity_reduction: 0,
    // Chaos
    pod_failure_rate: 0,
    random_seed: 0,
    failure_events: [],
};
export const DEFAULT_CONFIG = {
    version: 2,
    name: 'Untitled Simulation',
    platform: 'kubernetes-hpa',
    simulation: DEFAULT_SIMULATION,
    producer: DEFAULT_PRODUCER,
    client: DEFAULT_CLIENT,
    broker: DEFAULT_BROKER,
    service: DEFAULT_SERVICE,
};
export const PRESET_SCENARIOS = [
    {
        name: 'Black Friday Spike',
        description: 'Simulating a 10x traffic spike lasting 60 seconds with aggressive scaling',
        config: {
            name: 'Black Friday Spike',
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 10,
                max_replicas: 100,
                scale_up_threshold: 50,
                scale_up_step: 10,
                startup_time: 30,
                capacity_per_replica: 40,
                cooldown_scale_up: 15,
                metric_observation_delay: 5,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'spike',
                    params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 },
                },
            },
        },
    },
    {
        name: 'Gradual Daily Ramp',
        description: 'Traffic linearly increases from morning to peak, simulating a typical workday',
        config: {
            name: 'Gradual Daily Ramp',
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 2,
                max_replicas: 30,
                scale_up_threshold: 75,
                capacity_per_replica: 150,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'gradual',
                    params: { start_rps: 50, end_rps: 800 },
                },
            },
        },
    },
    {
        name: 'Noisy Neighbor',
        description: 'Oscillating traffic with random pod failures simulating shared infrastructure',
        config: {
            name: 'Noisy Neighbor',
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 3,
                max_replicas: 40,
                scale_up_threshold: 65,
                startup_time: 45,
                pod_failure_rate: 0.5,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'wave',
                    params: { base_rps: 300, amplitude: 200, period: 120 },
                },
            },
        },
    },
    {
        name: 'Step Migration',
        description: 'Traffic increases in discrete steps, simulating a phased rollout',
        config: {
            name: 'Step Migration',
            simulation: {
                ...DEFAULT_SIMULATION,
                duration: 600,
            },
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 2,
                max_replicas: 80,
                scale_up_step: 2,
                scale_down_step: 1,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'step',
                    params: {
                        steps: [
                            { rps: 100, duration: 120 },
                            { rps: 300, duration: 120 },
                            { rps: 600, duration: 120 },
                            { rps: 1000, duration: 120 },
                            { rps: 500, duration: 120 },
                        ],
                    },
                },
            },
        },
    },
    {
        name: 'Bottomless Queue',
        description: 'Spike traffic with an unlimited broker — no requests dropped, backlog drains as capacity catches up',
        config: {
            name: 'Bottomless Queue',
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 2,
                max_replicas: 50,
                scale_up_threshold: 70,
                scale_up_step: 4,
                capacity_per_replica: 100,
                startup_time: 30,
                cooldown_scale_up: 15,
                metric_observation_delay: 10,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'spike',
                    params: { base_rps: 200, spike_rps: 2000, spike_start: 60, spike_duration: 90 },
                },
            },
            broker: {
                ...DEFAULT_BROKER,
                enabled: true,
                max_size: 0,
            },
        },
    },
    {
        name: 'Death Spiral (OLTP)',
        description: 'Pod saturation + retries cause cascading failure without a broker — excess is dropped immediately, retries amplify the overload',
        config: {
            name: 'Death Spiral (OLTP)',
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 3,
                max_replicas: 30,
                scale_up_threshold: 70,
                scale_up_step: 3,
                capacity_per_replica: 100,
                startup_time: 30,
                cooldown_scale_up: 10,
                metric_observation_delay: 10,
                saturation_threshold: 85,
                max_capacity_reduction: 0.4,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'spike',
                    params: { base_rps: 200, spike_rps: 1500, spike_start: 30, spike_duration: 60 },
                },
            },
            client: {
                max_retries: 3,
                retry_delay: 2,
                retry_strategy: 'fixed',
            },
        },
    },
    {
        name: 'Death Spiral (Queued)',
        description: 'Pod saturation + retries with a bounded broker — queue fills up, requests expire, retries amplify the overload into cascading failure',
        config: {
            name: 'Death Spiral (Queued)',
            service: {
                ...DEFAULT_SERVICE,
                min_replicas: 3,
                max_replicas: 30,
                scale_up_threshold: 70,
                scale_up_step: 3,
                capacity_per_replica: 100,
                startup_time: 30,
                cooldown_scale_up: 10,
                metric_observation_delay: 10,
                saturation_threshold: 85,
                max_capacity_reduction: 0.4,
            },
            producer: {
                ...DEFAULT_PRODUCER,
                traffic: {
                    pattern: 'spike',
                    params: { base_rps: 200, spike_rps: 1500, spike_start: 30, spike_duration: 60 },
                },
            },
            client: {
                max_retries: 3,
                retry_delay: 2,
                retry_strategy: 'fixed',
            },
            broker: {
                enabled: true,
                max_size: 5000,
                request_timeout_ms: 10000,
            },
        },
    },
];
//# sourceMappingURL=types.js.map