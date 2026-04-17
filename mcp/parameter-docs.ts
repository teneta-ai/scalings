// ============================================================================
// scalings.xyz MCP — Parameter Documentation
// ============================================================================
//
// Canonical metadata for every simulation parameter. Defaults here MUST match
// DEFAULT_* constants in src/interfaces/types.ts — enforced by a test.

import {
  DEFAULT_SIMULATION,
  DEFAULT_SERVICE,
  DEFAULT_CLIENT,
  DEFAULT_BROKER,
  DEFAULT_TRAFFIC,
} from '../src/interfaces/types.js';
import type {
  ParameterDoc,
  TrafficPatternDoc,
  ParametersResponse,
} from './types.js';

const PLATFORMS = ['kubernetes-hpa', 'aws-asg', 'gcp-mig', 'custom'] as const;
const TRAFFIC_PATTERNS = ['steady', 'gradual', 'spike', 'wave', 'step', 'custom', 'grafana'] as const;
const RETRY_STRATEGIES = ['fixed', 'exponential', 'exponential-jitter'] as const;

const SIMULATION_PARAMS: ParameterDoc[] = [
  {
    name: 'duration',
    path: 'simulation.duration',
    type: 'number',
    default: DEFAULT_SIMULATION.duration,
    description: 'Total length of the simulation in seconds.',
    unit: 'seconds',
    min: 1,
    max: 3600,
  },
  {
    name: 'tick_interval',
    path: 'simulation.tick_interval',
    type: 'number',
    default: DEFAULT_SIMULATION.tick_interval,
    description: 'Granularity of each simulation step. Smaller = more detail, more snapshots.',
    unit: 'seconds',
    min: 0.5,
    max: 60,
  },
];

const SERVICE_PARAMS: ParameterDoc[] = [
  { name: 'min_replicas', path: 'service.min_replicas', type: 'integer', default: DEFAULT_SERVICE.min_replicas, description: 'Minimum number of pods the autoscaler will keep running.', min: 0 },
  { name: 'max_replicas', path: 'service.max_replicas', type: 'integer', default: DEFAULT_SERVICE.max_replicas, description: 'Upper bound on pod count — even under overload the autoscaler will not exceed this.', min: 1, max: 1000 },
  { name: 'scale_up_threshold', path: 'service.scale_up_threshold', type: 'number', default: DEFAULT_SERVICE.scale_up_threshold, description: 'Observed capacity utilization (%) above which the autoscaler adds pods.', unit: 'percent', min: 0, max: 100 },
  { name: 'scale_down_threshold', path: 'service.scale_down_threshold', type: 'number', default: DEFAULT_SERVICE.scale_down_threshold, description: 'Observed capacity utilization (%) below which the autoscaler removes pods. Must be < scale_up_threshold.', unit: 'percent', min: 0, max: 100 },
  { name: 'capacity_per_replica', path: 'service.capacity_per_replica', type: 'number', default: DEFAULT_SERVICE.capacity_per_replica, description: 'Maximum requests per second a single pod can serve.', unit: 'rps', min: 0 },
  { name: 'startup_time', path: 'service.startup_time', type: 'number', default: DEFAULT_SERVICE.startup_time, description: 'Seconds from pod creation until it becomes ready to serve traffic.', unit: 'seconds', min: 0 },
  { name: 'scale_up_step', path: 'service.scale_up_step', type: 'integer', default: DEFAULT_SERVICE.scale_up_step, description: 'Maximum pods added in a single scale-up event.', min: 1 },
  { name: 'scale_down_step', path: 'service.scale_down_step', type: 'integer', default: DEFAULT_SERVICE.scale_down_step, description: 'Maximum pods removed in a single scale-down event.', min: 1 },
  { name: 'metric_observation_delay', path: 'service.metric_observation_delay', type: 'number', default: DEFAULT_SERVICE.metric_observation_delay, description: 'Delay (seconds) between a utilization change and the autoscaler observing it.', unit: 'seconds', min: 0 },
  { name: 'cooldown_scale_up', path: 'service.cooldown_scale_up', type: 'number', default: DEFAULT_SERVICE.cooldown_scale_up, description: 'Minimum seconds between scale-up events.', unit: 'seconds', min: 0 },
  { name: 'cooldown_scale_down', path: 'service.cooldown_scale_down', type: 'number', default: DEFAULT_SERVICE.cooldown_scale_down, description: 'Minimum seconds between scale-down events.', unit: 'seconds', min: 0 },
  { name: 'node_provisioning_time', path: 'service.node_provisioning_time', type: 'number', default: DEFAULT_SERVICE.node_provisioning_time, description: 'Extra seconds when spinning up a new node. 0 = pre-provisioned cluster.', unit: 'seconds', min: 0 },
  { name: 'cluster_node_capacity', path: 'service.cluster_node_capacity', type: 'integer', default: DEFAULT_SERVICE.cluster_node_capacity, description: 'Maximum number of nodes the cluster can have.', min: 1 },
  { name: 'pods_per_node', path: 'service.pods_per_node', type: 'integer', default: DEFAULT_SERVICE.pods_per_node, description: 'Maximum pods that fit on a single node.', min: 1 },
  { name: 'graceful_shutdown_time', path: 'service.graceful_shutdown_time', type: 'number', default: DEFAULT_SERVICE.graceful_shutdown_time, description: 'Seconds a pod keeps serving traffic while shutting down.', unit: 'seconds', min: 0 },
  { name: 'cost_per_replica_hour', path: 'service.cost_per_replica_hour', type: 'number', default: DEFAULT_SERVICE.cost_per_replica_hour, description: 'USD per pod per hour — used for cost summary.', unit: 'USD/hour', min: 0 },
  { name: 'saturation_threshold', path: 'service.saturation_threshold', type: 'number', default: DEFAULT_SERVICE.saturation_threshold, description: 'Utilization % above which capacity starts to degrade. 0 = disabled.', unit: 'percent', min: 0, max: 100 },
  { name: 'max_capacity_reduction', path: 'service.max_capacity_reduction', type: 'number', default: DEFAULT_SERVICE.max_capacity_reduction, description: 'Fraction of capacity lost when fully saturated (0-1).', min: 0, max: 1 },
  { name: 'pod_failure_rate', path: 'service.pod_failure_rate', type: 'number', default: DEFAULT_SERVICE.pod_failure_rate, description: 'Per-tick probability (%) that each running pod is randomly killed.', unit: 'percent', min: 0, max: 100 },
  { name: 'random_seed', path: 'service.random_seed', type: 'integer', default: DEFAULT_SERVICE.random_seed, description: 'Seed for the deterministic PRNG. 0 = non-deterministic (Math.random).', min: 0 },
  { name: 'failure_events', path: 'service.failure_events', type: 'array', default: DEFAULT_SERVICE.failure_events, description: 'Scheduled pod kills. Array of { time: seconds, count: pods }.' },
];

const CLIENT_PARAMS: ParameterDoc[] = [
  { name: 'max_retries', path: 'client.max_retries', type: 'integer', default: DEFAULT_CLIENT.max_retries, description: 'Maximum retry attempts per failed request. 0 = no retries.', min: 0 },
  { name: 'retry_delay', path: 'client.retry_delay', type: 'number', default: DEFAULT_CLIENT.retry_delay, description: 'Base delay between a failure and its retry. 0 = retry next tick.', unit: 'seconds', min: 0 },
  { name: 'retry_strategy', path: 'client.retry_strategy', type: 'enum', default: DEFAULT_CLIENT.retry_strategy, description: 'How retry delay scales with attempt number.', enum_values: RETRY_STRATEGIES },
];

const BROKER_PARAMS: ParameterDoc[] = [
  { name: 'enabled', path: 'broker.enabled', type: 'boolean', default: DEFAULT_BROKER.enabled, description: 'If true, excess traffic is queued instead of dropped immediately (e.g. Kafka in front of service).' },
  { name: 'max_size', path: 'broker.max_size', type: 'integer', default: DEFAULT_BROKER.max_size, description: 'Maximum queued requests. 0 = unlimited (bottomless queue).', min: 0 },
  { name: 'request_timeout_ms', path: 'broker.request_timeout_ms', type: 'integer', default: DEFAULT_BROKER.request_timeout_ms, description: 'Milliseconds a request can wait before expiring. 0 = no timeout.', unit: 'milliseconds', min: 0 },
];

const PRODUCER_PARAMS: ParameterDoc[] = [
  { name: 'traffic.pattern', path: 'producer.traffic.pattern', type: 'enum', default: DEFAULT_TRAFFIC.pattern, description: 'Shape of the traffic curve over time.', enum_values: TRAFFIC_PATTERNS },
  { name: 'traffic.params', path: 'producer.traffic.params', type: 'object', default: DEFAULT_TRAFFIC.params, description: 'Pattern-specific parameters. See traffic_patterns for the shape matching each pattern.' },
];

const TRAFFIC_PATTERN_DOCS: TrafficPatternDoc[] = [
  {
    pattern: 'steady',
    description: 'Constant RPS for the entire simulation.',
    params: [
      { name: 'rps', path: 'producer.traffic.params.rps', type: 'number', default: 100, description: 'Constant requests per second.', unit: 'rps', min: 0 },
    ],
  },
  {
    pattern: 'gradual',
    description: 'Linear ramp from start_rps to end_rps across the whole duration.',
    params: [
      { name: 'start_rps', path: 'producer.traffic.params.start_rps', type: 'number', default: 50, description: 'RPS at t=0.', unit: 'rps', min: 0 },
      { name: 'end_rps', path: 'producer.traffic.params.end_rps', type: 'number', default: 800, description: 'RPS at t=duration.', unit: 'rps', min: 0 },
    ],
  },
  {
    pattern: 'spike',
    description: 'Base RPS with a single high-RPS spike of configurable start/length.',
    params: [
      { name: 'base_rps', path: 'producer.traffic.params.base_rps', type: 'number', default: 200, description: 'Baseline RPS outside the spike window.', unit: 'rps', min: 0 },
      { name: 'spike_rps', path: 'producer.traffic.params.spike_rps', type: 'number', default: 2000, description: 'RPS during the spike window.', unit: 'rps', min: 0 },
      { name: 'spike_start', path: 'producer.traffic.params.spike_start', type: 'number', default: 120, description: 'Seconds into simulation when the spike starts.', unit: 'seconds', min: 0 },
      { name: 'spike_duration', path: 'producer.traffic.params.spike_duration', type: 'number', default: 60, description: 'Spike length in seconds.', unit: 'seconds', min: 0 },
    ],
  },
  {
    pattern: 'wave',
    description: 'Sinusoidal oscillation: base_rps + amplitude * sin(2*pi*t / period).',
    params: [
      { name: 'base_rps', path: 'producer.traffic.params.base_rps', type: 'number', default: 300, description: 'Centerline RPS.', unit: 'rps', min: 0 },
      { name: 'amplitude', path: 'producer.traffic.params.amplitude', type: 'number', default: 200, description: 'Peak deviation from base_rps.', unit: 'rps', min: 0 },
      { name: 'period', path: 'producer.traffic.params.period', type: 'number', default: 120, description: 'Period of one full oscillation.', unit: 'seconds', min: 1 },
    ],
  },
  {
    pattern: 'step',
    description: 'Piecewise-constant RPS: hold each step for its duration, then jump to the next.',
    params: [
      { name: 'steps', path: 'producer.traffic.params.steps', type: 'array', default: [], description: 'Array of { rps, duration } segments. After the last, the RPS holds.' },
    ],
  },
  {
    pattern: 'custom',
    description: 'Linear interpolation between user-supplied (t, rps) points.',
    params: [
      { name: 'series', path: 'producer.traffic.params.series', type: 'array', default: [], description: 'Array of { t, rps } points sorted by time.' },
    ],
  },
  {
    pattern: 'grafana',
    description: 'Same as custom, but sourced from a Grafana CSV export (raw CSV kept for re-parsing).',
    params: [
      { name: 'series', path: 'producer.traffic.params.series', type: 'array', default: [], description: 'Parsed (t, rps) points after unit conversion.' },
      { name: 'raw_csv', path: 'producer.traffic.params.raw_csv', type: 'string', default: '', description: 'Original CSV text.' },
      { name: 'value_unit', path: 'producer.traffic.params.value_unit', type: 'enum', default: 'rps', description: 'Unit of the CSV value column.', enum_values: ['rps', 'rpm', 'rph'] },
    ],
  },
];

export const ALL_SECTIONS: Record<string, ParameterDoc[]> = {
  simulation: SIMULATION_PARAMS,
  service: SERVICE_PARAMS,
  client: CLIENT_PARAMS,
  broker: BROKER_PARAMS,
  producer: PRODUCER_PARAMS,
};

export function buildParametersResponse(section?: string): ParametersResponse {
  if (section && ALL_SECTIONS[section]) {
    return { sections: { [section]: ALL_SECTIONS[section] } };
  }
  return {
    sections: ALL_SECTIONS,
    traffic_patterns: TRAFFIC_PATTERN_DOCS,
    enums: {
      Platform: PLATFORMS,
      TrafficPatternType: TRAFFIC_PATTERNS,
      RetryStrategy: RETRY_STRATEGIES,
    },
  };
}

export const PARAMETER_DOCS_INTERNAL = {
  SIMULATION_PARAMS,
  SERVICE_PARAMS,
  CLIENT_PARAMS,
  BROKER_PARAMS,
  PRODUCER_PARAMS,
  TRAFFIC_PATTERN_DOCS,
};
