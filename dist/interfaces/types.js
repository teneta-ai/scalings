// ============================================================================
// scalings.xyz — Type Definitions
// ============================================================================
// --- Default Values ---
export const DEFAULT_SCALING = {
    min_replicas: 2,
    max_replicas: 50,
    scale_up_threshold: 70,
    scale_down_threshold: 30,
    capacity_per_replica: 100,
    startup_time: 30,
    scale_up_step: 1,
    scale_down_step: 1,
};
export const DEFAULT_ADVANCED = {
    metric_observation_delay: 15,
    cooldown_scale_up: 60,
    cooldown_scale_down: 300,
    node_provisioning_time: 120,
    cluster_node_capacity: 20,
    pod_failure_rate: 0,
    graceful_shutdown_time: 10,
    cost_per_replica_hour: 0.05,
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
    traffic: DEFAULT_TRAFFIC,
};
export const PRESET_SCENARIOS = [
    {
        name: 'Black Friday Spike',
        description: 'Simulating a 10x traffic spike lasting 60 seconds with 30s pod startup',
        config: {
            name: 'Black Friday Spike',
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
            traffic: {
                pattern: 'gradual',
                params: { start_rps: 50, end_rps: 800, duration: 600 },
            },
        },
    },
    {
        name: 'Noisy Neighbor',
        description: 'Oscillating traffic with random pod failures simulating shared infrastructure',
        config: {
            name: 'Noisy Neighbor',
            traffic: {
                pattern: 'wave',
                params: { base_rps: 300, amplitude: 200, period: 120 },
            },
            advanced: {
                ...DEFAULT_ADVANCED,
                pod_failure_rate: 0.005,
            },
        },
    },
    {
        name: 'Steady State',
        description: 'Constant traffic to validate baseline scaling config',
        config: {
            name: 'Steady State',
            traffic: {
                pattern: 'steady',
                params: { rps: 500 },
            },
        },
    },
    {
        name: 'Step Migration',
        description: 'Traffic increases in discrete steps, simulating a phased rollout',
        config: {
            name: 'Step Migration',
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