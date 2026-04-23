// ============================================================================
// scalings.xyz — Type Definitions
// ============================================================================

// --- Platform Types ---

export type Platform = 'kubernetes-hpa' | 'aws-asg' | 'gcp-mig' | 'custom';

export type TargetFormat = 'kubernetes-yaml' | 'cloudformation' | 'terraform' | 'gcloud-cli';

export type TrafficPatternType = 'steady' | 'gradual' | 'spike' | 'wave' | 'step' | 'custom' | 'grafana';

// --- Simulation Parameters ---

export interface SimulationParams {
  duration: number;       // seconds
  tick_interval: number;  // seconds
}

// --- Producer: generates traffic ---

export interface ProducerConfig {
  traffic: TrafficConfig;
}

// --- Client: resilience behavior (retries, etc.) ---

export type RetryStrategy = 'fixed' | 'exponential' | 'exponential-jitter';

export interface ClientConfig {
  max_retries: number;        // max retry attempts per request (0 = no retries)
  retry_delay: number;        // base seconds between failure and retry (0 = next tick)
  retry_strategy: RetryStrategy; // how delay scales with attempt number
}

// --- Broker: optional message queue between producer and service ---

export interface BrokerConfig {
  enabled: boolean;
  max_size: number;           // max queued requests (0 = unlimited)
  request_timeout_ms: number; // max wait time before request expires from queue (0 = no timeout)
}

// --- Service: pod fleet, scaling, degradation, chaos ---

export interface ServiceConfig {
  // Basic scaling
  min_replicas: number;
  max_replicas: number;
  scale_up_threshold: number;     // capacity utilization percent (0-100)
  scale_down_threshold: number;   // capacity utilization percent (0-100)
  capacity_per_replica: number;   // max requests/second per pod
  startup_time: number;           // seconds
  scale_up_step: number;
  scale_down_step: number;
  // Advanced
  metric_observation_delay: number;   // seconds
  cooldown_scale_up: number;          // seconds
  cooldown_scale_down: number;        // seconds
  node_provisioning_time: number;     // seconds (0 = pre-provisioned)
  cluster_node_capacity: number;      // max nodes in the cluster
  pods_per_node: number;              // max pods that fit on one node
  graceful_shutdown_time: number;     // seconds
  cost_per_replica_hour: number;      // USD
  // Saturation (service degrades under high utilization)
  saturation_threshold: number;       // utilization % at which capacity starts degrading (0 = disabled)
  max_capacity_reduction: number;     // 0-1 fraction, max capacity loss from saturation
  // Chaos
  pod_failure_rate: number;           // 0-100 percent probability per tick
  random_seed: number;                // 0 = non-deterministic, >0 = seeded PRNG
  failure_events: FailureEvent[];     // scheduled pod kills at specific times
}

export interface FailureEvent {
  time: number;       // seconds into the simulation
  count: number;      // number of running pods to kill
}

// --- Traffic Patterns ---

export interface SteadyParams {
  rps: number;
}

export interface GradualParams {
  start_rps: number;
  end_rps: number;
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

export interface GrafanaParams {
  series: CustomTimePoint[];   // parsed time-series (in RPS after conversion)
  raw_csv: string;             // original CSV text for re-parsing with different unit
  value_unit: 'rps' | 'rpm' | 'rph';  // unit used for conversion
}

export type PatternParams = SteadyParams | GradualParams | SpikeParams | WaveParams | StepParams | CustomParams | GrafanaParams;

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
  producer: ProducerConfig;
  client: ClientConfig;
  broker: BrokerConfig;
  service: ServiceConfig;
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
  queue_depth: number;         // requests waiting in queue
  queue_wait_time_ms: number;  // estimated avg wait time for queued requests
  expired_requests: number;    // requests expired from queue this tick (timeout)
  retry_requests: number;      // retry traffic injected this tick
  effective_capacity_rps: number; // capacity after saturation reduction
  utilization: number;         // 0-1 capacity utilization
  delayed_utilization: number; // utilization the autoscaler sees (with delay)
  estimated_cost: number;      // cumulative cost in USD
  scale_event: 'up' | 'down' | null;
  log_entries: string[];
}

export interface SimulationResult {
  run_id: string;
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
  peak_queue_depth: number;
  avg_queue_wait_time_ms: number;
  peak_queue_wait_time_ms: number;
  total_expired: number;
  total_retries: number;
  time_under_provisioned_seconds: number;
  time_under_provisioned_percent: number;
  time_to_recover_seconds: number | null;  // null if no drops or never recovered
  estimated_total_cost: number;
}

// --- Load Test Export Types ---

export type LoadTestFramework = 'k6' | 'gatling' | 'locust' | 'jmeter' | 'artillery';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Template variables available in body and header values.
 * Each exporter maps these to framework-native syntax.
 *
 *   $randInt        — random integer 0–10000
 *   $randString     — random alphanumeric string (10 chars)
 *   $uuid           — UUID v4
 *   $timestamp      — current Unix timestamp (ms)
 *   $randFloat      — random float 0.0–1.0
 *   $randomEmail    — random email address
 */
export const LOAD_TEST_TEMPLATE_VARS = [
  '$randInt',
  '$randString',
  '$uuid',
  '$timestamp',
  '$randFloat',
  '$randomEmail',
] as const;

export type LoadTestTemplateVar = typeof LOAD_TEST_TEMPLATE_VARS[number];

export interface LoadTestRequestConfig {
  method: HttpMethod;
  headers: Record<string, string>;   // header-name → value (may contain template vars)
  body: string;                       // raw body string (may contain template vars)
}

export interface LoadTestValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface LoadTestExporter {
  /** Framework identifier */
  readonly id: LoadTestFramework;
  /** Human-readable framework name */
  readonly name: string;
  /** File extension for the exported script */
  readonly extension: string;
  /** Generate the load test script from simulation config */
  generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, request: LoadTestRequestConfig, results?: SimulationResult): string;
  /** Validate that the config can be exported to this framework */
  validate(config: SimulationConfig): LoadTestValidationResult;
}

export interface LoadTestExportOptions {
  framework: LoadTestFramework;
  targetUrl: string;
  avgResponseTimeMs: number;
  request: LoadTestRequestConfig;
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

/** Identity of the current user. All fields optional so anonymous or partially-known users are representable. */
export interface UserContext {
  id?: string;
  email?: string;
  team?: string;
}

/**
 * Reads the current user identity. Enables future team- and permission-scoping
 * without changing callers. The default implementation returns null (anonymous);
 * swap for an auth-backed implementation in factory.ts when sign-in lands.
 */
export interface UserContextService {
  getCurrentUser(): UserContext | null;
}

export interface LoadTestExportService {
  getExporter(framework: LoadTestFramework): LoadTestExporter;
  getAvailableFrameworks(): { id: LoadTestFramework; name: string }[];
  generate(config: SimulationConfig, options: LoadTestExportOptions, results?: SimulationResult): string;
  validate(config: SimulationConfig, framework: LoadTestFramework): LoadTestValidationResult;
}

export const DEFAULT_LOAD_TEST_REQUEST: LoadTestRequestConfig = {
  method: 'GET',
  headers: {},
  body: '',
};

// --- Preset Scenarios ---

export interface PresetScenario {
  name: string;
  description: string;
  config: Partial<SimulationConfig>;
}

// --- Default Values ---

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

export const DEFAULT_PRODUCER: ProducerConfig = {
  traffic: DEFAULT_TRAFFIC,
};

export const DEFAULT_CLIENT: ClientConfig = {
  max_retries: 0,
  retry_delay: 0,
  retry_strategy: 'fixed',
};

export const DEFAULT_BROKER: BrokerConfig = {
  enabled: false,
  max_size: 1000,
  request_timeout_ms: 0,
};

export const DEFAULT_SERVICE: ServiceConfig = {
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

export const DEFAULT_CONFIG: SimulationConfig = {
  version: 2,
  name: 'Untitled Simulation',
  platform: 'kubernetes-hpa',
  simulation: DEFAULT_SIMULATION,
  producer: DEFAULT_PRODUCER,
  client: DEFAULT_CLIENT,
  broker: DEFAULT_BROKER,
  service: DEFAULT_SERVICE,
};

export const PRESET_SCENARIOS: PresetScenario[] = [
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
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
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
          params: { start_rps: 50, end_rps: 800 } as GradualParams,
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
          params: { base_rps: 300, amplitude: 200, period: 120 } as WaveParams,
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
          } as StepParams,
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
          params: { base_rps: 200, spike_rps: 2000, spike_start: 60, spike_duration: 90 } as SpikeParams,
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
          params: { base_rps: 200, spike_rps: 1500, spike_start: 30, spike_duration: 60 } as SpikeParams,
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
          params: { base_rps: 200, spike_rps: 1500, spike_start: 30, spike_duration: 60 } as SpikeParams,
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
