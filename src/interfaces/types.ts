// ============================================================================
// scalings.xyz — Type Definitions
// ============================================================================

// --- Platform Types ---

export type Platform = 'kubernetes-hpa' | 'aws-asg' | 'gcp-mig' | 'custom';

export type TargetFormat = 'kubernetes-yaml' | 'cloudformation' | 'terraform' | 'gcloud-cli';

export type TrafficPatternType = 'steady' | 'gradual' | 'spike' | 'wave' | 'step' | 'custom';

// --- Simulation Parameters ---

export interface SimulationParams {
  duration: number;       // seconds
  tick_interval: number;  // seconds
}

export interface ScalingParams {
  min_replicas: number;
  max_replicas: number;
  scale_up_threshold: number;     // capacity utilization percent (0-100)
  scale_down_threshold: number;   // capacity utilization percent (0-100)
  capacity_per_replica: number;   // max requests/second per pod
  startup_time: number;           // seconds
  scale_up_step: number;
  scale_down_step: number;
}

export interface AdvancedParams {
  metric_observation_delay: number;   // seconds
  cooldown_scale_up: number;          // seconds
  cooldown_scale_down: number;        // seconds
  node_provisioning_time: number;     // seconds (0 = pre-provisioned)
  cluster_node_capacity: number;      // max pods before new node needed
  pod_failure_rate: number;           // 0-1 probability per tick
  graceful_shutdown_time: number;     // seconds
  cost_per_replica_hour: number;      // USD
}

// --- Traffic Patterns ---

export interface SteadyParams {
  rps: number;
}

export interface GradualParams {
  start_rps: number;
  end_rps: number;
  duration: number;
}

export interface SpikeParams {
  base_rps: number;
  spike_rps: number;
  spike_start: number;     // seconds into simulation
  spike_duration: number;  // seconds
}

export interface WaveParams {
  base_rps: number;
  amplitude: number;
  period: number;          // seconds
}

export interface StepEntry {
  rps: number;
  duration: number;
}

export interface StepParams {
  steps: StepEntry[];
}

export interface CustomTimePoint {
  t: number;
  rps: number;
}

export interface CustomParams {
  series: CustomTimePoint[];
}

export type PatternParams = SteadyParams | GradualParams | SpikeParams | WaveParams | StepParams | CustomParams;

export interface TrafficConfig {
  pattern: TrafficPatternType;
  params: PatternParams;
}

// --- Source Config: defines the simulation scenario ---

export interface SimulationConfig {
  version: number;
  name: string;
  description?: string;
  platform: Platform;
  simulation: SimulationParams;
  scaling: ScalingParams;
  advanced: AdvancedParams;
  traffic: TrafficConfig;
}

// --- Target Config: the deployable output ---

export interface TargetConfig {
  platform: Platform;
  format: TargetFormat;
  content: string;
}

// --- Simulation State & Results ---

export type PodState = 'starting' | 'running' | 'shutting_down';

export interface Pod {
  id: number;
  state: PodState;
  stateTimer: number;         // ticks remaining in current state
  needsNodeProvisioning: boolean;
}

export interface TickSnapshot {
  time: number;                // seconds
  traffic_rps: number;         // incoming RPS
  capacity_rps: number;        // total serving capacity
  running_pods: number;        // pods actively serving
  total_pods: number;          // all pods including starting/shutting down
  starting_pods: number;       // pods in startup
  shutting_down_pods: number;  // pods gracefully shutting down
  served_requests: number;     // requests served this tick
  dropped_requests: number;    // requests dropped this tick
  utilization: number;         // 0-1 capacity utilization
  delayed_utilization: number; // utilization the autoscaler sees (with delay)
  estimated_cost: number;      // cumulative cost in USD
  scale_event: 'up' | 'down' | null;
  response_time_ms: number;    // estimated response time
}

export interface SimulationResult {
  snapshots: TickSnapshot[];
  summary: SimulationSummary;
}

export interface SimulationSummary {
  total_requests: number;
  total_served: number;
  total_dropped: number;
  drop_rate_percent: number;
  peak_pod_count: number;
  min_pod_count: number;
  time_under_provisioned_seconds: number;
  time_under_provisioned_percent: number;
  time_to_recover_seconds: number | null;  // null if no spike or never recovered
  estimated_total_cost: number;
  max_response_time_ms: number;
  avg_response_time_ms: number;
}

// --- Service Interfaces ---

export interface SimulationService {
  run(config: SimulationConfig): Promise<SimulationResult>;
}

export interface ConfigService {
  export(config: SimulationConfig): string;
  import(yaml: string): SimulationConfig;
  toURL(config: SimulationConfig): string;
  fromURL(hash: string): SimulationConfig;
  saveLocal(config: SimulationConfig): void;
  loadLocal(): SimulationConfig | null;
}

export interface ExportService {
  generate(config: SimulationConfig): TargetConfig;
}

export interface TrafficPatternService {
  generate(pattern: TrafficConfig, duration: number, tickInterval: number): number[];
  preview(pattern: TrafficConfig, points?: number): number[];
}

// --- Preset Scenarios ---

export interface PresetScenario {
  name: string;
  description: string;
  config: Partial<SimulationConfig>;
}

// --- Default Values ---

export const DEFAULT_SCALING: ScalingParams = {
  min_replicas: 2,
  max_replicas: 50,
  scale_up_threshold: 70,
  scale_down_threshold: 30,
  capacity_per_replica: 100,
  startup_time: 30,
  scale_up_step: 1,
  scale_down_step: 1,
};

export const DEFAULT_ADVANCED: AdvancedParams = {
  metric_observation_delay: 15,
  cooldown_scale_up: 60,
  cooldown_scale_down: 300,
  node_provisioning_time: 120,
  cluster_node_capacity: 20,
  pod_failure_rate: 0,
  graceful_shutdown_time: 10,
  cost_per_replica_hour: 0.05,
};

export const DEFAULT_SIMULATION: SimulationParams = {
  duration: 600,
  tick_interval: 1,
};

export const DEFAULT_TRAFFIC: TrafficConfig = {
  pattern: 'spike',
  params: {
    base_rps: 200,
    spike_rps: 2000,
    spike_start: 120,
    spike_duration: 60,
  } as SpikeParams,
};

export const DEFAULT_CONFIG: SimulationConfig = {
  version: 1,
  name: 'Untitled Simulation',
  platform: 'kubernetes-hpa',
  simulation: DEFAULT_SIMULATION,
  scaling: DEFAULT_SCALING,
  advanced: DEFAULT_ADVANCED,
  traffic: DEFAULT_TRAFFIC,
};

export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    name: 'Black Friday Spike',
    description: 'Simulating a 10x traffic spike lasting 60 seconds with aggressive scaling',
    config: {
      name: 'Black Friday Spike',
      scaling: {
        ...DEFAULT_SCALING,
        min_replicas: 3,
        max_replicas: 100,
        scale_up_threshold: 60,
        scale_up_step: 3,
        startup_time: 30,
      },
      advanced: {
        ...DEFAULT_ADVANCED,
        cooldown_scale_up: 30,
      },
      traffic: {
        pattern: 'spike',
        params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
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
        params: { start_rps: 50, end_rps: 800, duration: 600 } as GradualParams,
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
        params: { base_rps: 300, amplitude: 200, period: 120 } as WaveParams,
      },
      advanced: {
        ...DEFAULT_ADVANCED,
        pod_failure_rate: 0.005,
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
        } as StepParams,
      },
    },
  },
];
