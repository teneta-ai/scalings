// ============================================================================
// scalings.xyz — Type Definitions
// ============================================================================
// --- Default Values ---
export const DEFAULT_SCALING = {
    min_replicas: 1,
    max_replicas: 50,
    scale_up_threshold: 80,
    scale_down_threshold: 30,
    capacity_per_replica: 100,
    startup_time: 30,
    scale_up_step: 4,
    scale_down_step: 1,
};
export const DEFAULT_ADVANCED = {
    metric_observation_delay: 15,
    cooldown_scale_up: 15,
    cooldown_scale_down: 60,
    node_provisioning_time: 120,
    cluster_node_capacity: 20,
    pods_per_node: 10,
    graceful_shutdown_time: 30,
    cost_per_replica_hour: 0.05,
};
export const DEFAULT_CHAOS = {
    pod_failure_rate: 0,
    random_seed: 0,
    failure_events: [],
};
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
export const DEFAULT_CONFIG = {
    version: 1,
    name: 'Untitled Simulation',
    platform: 'kubernetes-hpa',
    simulation: DEFAULT_SIMULATION,
    scaling: DEFAULT_SCALING,
    advanced: DEFAULT_ADVANCED,
    chaos: DEFAULT_CHAOS,
    traffic: DEFAULT_TRAFFIC,
};
export const PRESET_SCENARIOS = [
    {
        name: 'Black Friday Spike',
        description: 'Simulating a 10x traffic spike lasting 60 seconds with aggressive scaling',
        config: {
            name: 'Black Friday Spike',
            scaling: {
                ...DEFAULT_SCALING,
                min_replicas: 10,
                max_replicas: 100,
                scale_up_threshold: 50,
                scale_up_step: 10,
                startup_time: 30,
                capacity_per_replica: 40,
            },
            advanced: {
                ...DEFAULT_ADVANCED,
                cooldown_scale_up: 15,
                metric_observation_delay: 5,
            },
            traffic: {
                pattern: 'spike',
                params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 },
            },
        },
    },
    {
        name: 'Gradual Daily Ramp',
        description: 'Traffic linearly increases from morning to peak, simulating a typical workday',
        config: {
            name: 'Gradual Daily Ramp',
            scaling: {
                ...DEFAULT_SCALING,
                min_replicas: 2,
                max_replicas: 30,
                scale_up_threshold: 75,
                capacity_per_replica: 150,
            },
            traffic: {
                pattern: 'gradual',
                params: { start_rps: 50, end_rps: 800 },
            },
        },
    },
    {
        name: 'Noisy Neighbor',
        description: 'Oscillating traffic with random pod failures simulating shared infrastructure',
        config: {
            name: 'Noisy Neighbor',
            scaling: {
                ...DEFAULT_SCALING,
                min_replicas: 3,
                max_replicas: 40,
                scale_up_threshold: 65,
                startup_time: 45,
            },
            traffic: {
                pattern: 'wave',
                params: { base_rps: 300, amplitude: 200, period: 120 },
            },
            chaos: {
                ...DEFAULT_CHAOS,
                pod_failure_rate: 0.5,
            },
        },
    },
    {
        name: 'Step Migration',
        description: 'Traffic increases in discrete steps, simulating a phased rollout',
        config: {
            name: 'Step Migration',
            scaling: {
                ...DEFAULT_SCALING,
                min_replicas: 2,
                max_replicas: 80,
                scale_up_step: 2,
                scale_down_step: 1,
            },
            simulation: {
                ...DEFAULT_SIMULATION,
                duration: 600,
            },
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
];
//# sourceMappingURL=types.js.map