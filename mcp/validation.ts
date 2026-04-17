// ============================================================================
// scalings.xyz MCP — Config Merging + Validation
// ============================================================================
//
// mergeWithDefaults:  deep-merges a partial SimulationConfig with DEFAULT_CONFIG,
//                     producing a fully-formed SimulationConfig.
// validateSimulationConfig:  runs structural + semantic checks and returns a
//                     structured ValidationResult with field-level errors.

import {
  DEFAULT_CONFIG,
  DEFAULT_SERVICE,
  DEFAULT_CLIENT,
  DEFAULT_BROKER,
  DEFAULT_SIMULATION,
  DEFAULT_TRAFFIC,
  SimulationConfig,
  Platform,
  TrafficPatternType,
  RetryStrategy,
  SpikeParams,
  GradualParams,
  WaveParams,
  StepParams,
  CustomParams,
  GrafanaParams,
  SteadyParams,
} from '../src/interfaces/types.js';
import type { DeepPartial, ValidationError, ValidationResult } from './types.js';

const VALID_PLATFORMS: readonly Platform[] = ['kubernetes-hpa', 'aws-asg', 'gcp-mig', 'custom'];
const VALID_PATTERNS: readonly TrafficPatternType[] = ['steady', 'gradual', 'spike', 'wave', 'step', 'custom', 'grafana'];
const VALID_RETRY_STRATEGIES: readonly RetryStrategy[] = ['fixed', 'exponential', 'exponential-jitter'];

const MAX_DURATION = 3600;
const MIN_TICK_INTERVAL = 0.5;
const MAX_REPLICAS_CAP = 1000;

// ---------------------------------------------------------------------------
// Deep merge: partial → full SimulationConfig using DEFAULT_CONFIG.
// Each section is merged independently so partial overrides compose cleanly.
// ---------------------------------------------------------------------------
export function mergeWithDefaults(partial: DeepPartial<SimulationConfig>): SimulationConfig {
  const p = (partial ?? {}) as DeepPartial<SimulationConfig>;

  return {
    version: (p.version as number) ?? DEFAULT_CONFIG.version,
    name: (p.name as string) ?? DEFAULT_CONFIG.name,
    description: p.description as string | undefined ?? DEFAULT_CONFIG.description,
    platform: (p.platform as Platform) ?? DEFAULT_CONFIG.platform,
    simulation: { ...DEFAULT_SIMULATION, ...(p.simulation ?? {}) } as SimulationConfig['simulation'],
    producer: {
      traffic: p.producer?.traffic
        ? {
            pattern: (p.producer.traffic.pattern as TrafficPatternType) ?? DEFAULT_TRAFFIC.pattern,
            params: (p.producer.traffic.params as SimulationConfig['producer']['traffic']['params']) ?? DEFAULT_TRAFFIC.params,
          }
        : DEFAULT_CONFIG.producer.traffic,
    },
    client: { ...DEFAULT_CLIENT, ...(p.client ?? {}) } as SimulationConfig['client'],
    broker: { ...DEFAULT_BROKER, ...(p.broker ?? {}) } as SimulationConfig['broker'],
    service: {
      ...DEFAULT_SERVICE,
      ...(p.service ?? {}),
      failure_events: (p.service?.failure_events as SimulationConfig['service']['failure_events']) ?? DEFAULT_SERVICE.failure_events,
    } as SimulationConfig['service'],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateSimulationConfig(config: SimulationConfig): ValidationResult {
  const errors: ValidationError[] = [];

  validatePlatform(config, errors);
  validateSimulation(config, errors);
  validateService(config, errors);
  validateClient(config, errors);
  validateBroker(config, errors);
  validateTraffic(config, errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, config };
}

function validatePlatform(config: SimulationConfig, errors: ValidationError[]): void {
  if (!VALID_PLATFORMS.includes(config.platform)) {
    errors.push({
      field: 'platform',
      message: `Unknown platform. Expected one of: ${VALID_PLATFORMS.join(', ')}.`,
      value: config.platform,
    });
  }
}

function validateSimulation(config: SimulationConfig, errors: ValidationError[]): void {
  const sim = config.simulation;
  if (!isFiniteNumber(sim.duration) || sim.duration <= 0) {
    errors.push({ field: 'simulation.duration', message: 'Must be a positive, finite number.', value: sim.duration });
  } else if (sim.duration > MAX_DURATION) {
    errors.push({ field: 'simulation.duration', message: `Must be <= ${MAX_DURATION}s (serverless safety cap).`, value: sim.duration });
  }
  if (!isFiniteNumber(sim.tick_interval) || sim.tick_interval <= 0) {
    errors.push({ field: 'simulation.tick_interval', message: 'Must be a positive, finite number.', value: sim.tick_interval });
  } else if (sim.tick_interval < MIN_TICK_INTERVAL) {
    errors.push({ field: 'simulation.tick_interval', message: `Must be >= ${MIN_TICK_INTERVAL}s (minimum granularity).`, value: sim.tick_interval });
  } else if (sim.tick_interval > sim.duration) {
    errors.push({ field: 'simulation.tick_interval', message: 'Must be <= simulation.duration.', value: sim.tick_interval });
  }
}

function validateService(config: SimulationConfig, errors: ValidationError[]): void {
  const s = config.service;
  const numericFields: Array<{ key: keyof typeof s; nonNegative: boolean; min?: number; max?: number }> = [
    { key: 'min_replicas', nonNegative: true },
    { key: 'max_replicas', nonNegative: true, min: 1, max: MAX_REPLICAS_CAP },
    { key: 'scale_up_threshold', nonNegative: true, min: 0, max: 100 },
    { key: 'scale_down_threshold', nonNegative: true, min: 0, max: 100 },
    { key: 'capacity_per_replica', nonNegative: true },
    { key: 'startup_time', nonNegative: true },
    { key: 'scale_up_step', nonNegative: true, min: 1 },
    { key: 'scale_down_step', nonNegative: true, min: 1 },
    { key: 'metric_observation_delay', nonNegative: true },
    { key: 'cooldown_scale_up', nonNegative: true },
    { key: 'cooldown_scale_down', nonNegative: true },
    { key: 'node_provisioning_time', nonNegative: true },
    { key: 'cluster_node_capacity', nonNegative: true, min: 1 },
    { key: 'pods_per_node', nonNegative: true, min: 1 },
    { key: 'graceful_shutdown_time', nonNegative: true },
    { key: 'cost_per_replica_hour', nonNegative: true },
    { key: 'saturation_threshold', nonNegative: true, min: 0, max: 100 },
    { key: 'max_capacity_reduction', nonNegative: true, min: 0, max: 1 },
    { key: 'pod_failure_rate', nonNegative: true, min: 0, max: 100 },
    { key: 'random_seed', nonNegative: true },
  ];

  for (const f of numericFields) {
    const v = s[f.key] as number;
    const field = `service.${String(f.key)}`;
    if (!isFiniteNumber(v)) {
      errors.push({ field, message: 'Must be a finite number.', value: v });
      continue;
    }
    if (f.nonNegative && v < 0) {
      errors.push({ field, message: 'Must be non-negative.', value: v });
    }
    if (f.min !== undefined && v < f.min) {
      errors.push({ field, message: `Must be >= ${f.min}.`, value: v });
    }
    if (f.max !== undefined && v > f.max) {
      errors.push({ field, message: `Must be <= ${f.max}.`, value: v });
    }
  }

  if (isFiniteNumber(s.min_replicas) && isFiniteNumber(s.max_replicas) && s.min_replicas > s.max_replicas) {
    errors.push({
      field: 'service.min_replicas',
      message: `min_replicas (${s.min_replicas}) must be <= max_replicas (${s.max_replicas}).`,
      value: s.min_replicas,
    });
  }

  if (isFiniteNumber(s.scale_up_threshold) && isFiniteNumber(s.scale_down_threshold) && s.scale_down_threshold >= s.scale_up_threshold) {
    errors.push({
      field: 'service.scale_down_threshold',
      message: `scale_down_threshold (${s.scale_down_threshold}) must be < scale_up_threshold (${s.scale_up_threshold}).`,
      value: s.scale_down_threshold,
    });
  }

  // failure_events: timestamps must fall within [0, duration]
  if (Array.isArray(s.failure_events)) {
    for (let i = 0; i < s.failure_events.length; i++) {
      const evt = s.failure_events[i];
      if (!isFiniteNumber(evt.time) || evt.time < 0) {
        errors.push({ field: `service.failure_events[${i}].time`, message: 'Must be a non-negative finite number.', value: evt.time });
      } else if (evt.time > config.simulation.duration) {
        errors.push({
          field: `service.failure_events[${i}].time`,
          message: `Time (${evt.time}s) exceeds simulation.duration (${config.simulation.duration}s).`,
          value: evt.time,
        });
      }
      if (!isFiniteNumber(evt.count) || evt.count < 0) {
        errors.push({ field: `service.failure_events[${i}].count`, message: 'Must be a non-negative finite number.', value: evt.count });
      }
    }
  }
}

function validateClient(config: SimulationConfig, errors: ValidationError[]): void {
  const c = config.client;
  if (!isFiniteNumber(c.max_retries) || c.max_retries < 0) {
    errors.push({ field: 'client.max_retries', message: 'Must be a non-negative finite number.', value: c.max_retries });
  }
  if (!isFiniteNumber(c.retry_delay) || c.retry_delay < 0) {
    errors.push({ field: 'client.retry_delay', message: 'Must be a non-negative finite number.', value: c.retry_delay });
  }
  if (!VALID_RETRY_STRATEGIES.includes(c.retry_strategy)) {
    errors.push({
      field: 'client.retry_strategy',
      message: `Must be one of: ${VALID_RETRY_STRATEGIES.join(', ')}.`,
      value: c.retry_strategy,
    });
  }
}

function validateBroker(config: SimulationConfig, errors: ValidationError[]): void {
  const b = config.broker;
  if (typeof b.enabled !== 'boolean') {
    errors.push({ field: 'broker.enabled', message: 'Must be a boolean.', value: b.enabled });
  }
  if (!isFiniteNumber(b.max_size) || b.max_size < 0) {
    errors.push({ field: 'broker.max_size', message: 'Must be a non-negative finite number.', value: b.max_size });
  }
  if (!isFiniteNumber(b.request_timeout_ms) || b.request_timeout_ms < 0) {
    errors.push({ field: 'broker.request_timeout_ms', message: 'Must be a non-negative finite number.', value: b.request_timeout_ms });
  }
}

function validateTraffic(config: SimulationConfig, errors: ValidationError[]): void {
  const t = config.producer.traffic;
  if (!VALID_PATTERNS.includes(t.pattern)) {
    errors.push({
      field: 'producer.traffic.pattern',
      message: `Must be one of: ${VALID_PATTERNS.join(', ')}.`,
      value: t.pattern,
    });
    return;
  }
  if (!t.params || typeof t.params !== 'object') {
    errors.push({ field: 'producer.traffic.params', message: 'Must be an object matching the declared pattern.', value: t.params });
    return;
  }

  const p = t.params as unknown as Record<string, unknown>;
  switch (t.pattern) {
    case 'steady':
      requireNumber(p, 'rps', 'producer.traffic.params.rps', errors);
      break;
    case 'gradual':
      requireNumber(p, 'start_rps', 'producer.traffic.params.start_rps', errors);
      requireNumber(p, 'end_rps', 'producer.traffic.params.end_rps', errors);
      break;
    case 'spike':
      requireNumber(p, 'base_rps', 'producer.traffic.params.base_rps', errors);
      requireNumber(p, 'spike_rps', 'producer.traffic.params.spike_rps', errors);
      requireNumber(p, 'spike_start', 'producer.traffic.params.spike_start', errors);
      requireNumber(p, 'spike_duration', 'producer.traffic.params.spike_duration', errors);
      break;
    case 'wave':
      requireNumber(p, 'base_rps', 'producer.traffic.params.base_rps', errors);
      requireNumber(p, 'amplitude', 'producer.traffic.params.amplitude', errors);
      requireNumber(p, 'period', 'producer.traffic.params.period', errors);
      break;
    case 'step':
      if (!Array.isArray(p.steps)) {
        errors.push({ field: 'producer.traffic.params.steps', message: 'Must be an array of { rps, duration } entries.', value: p.steps });
      }
      break;
    case 'custom':
    case 'grafana':
      if (!Array.isArray(p.series)) {
        errors.push({ field: 'producer.traffic.params.series', message: 'Must be an array of { t, rps } entries.', value: p.series });
      }
      break;
  }
  // Silence unused-type imports on strict builds.
  void (null as unknown as SpikeParams | GradualParams | WaveParams | StepParams | CustomParams | GrafanaParams | SteadyParams);
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  field: string,
  errors: ValidationError[],
): void {
  const v = obj[key];
  if (typeof v !== 'number' || !isFiniteNumber(v)) {
    errors.push({ field, message: 'Required numeric field for this traffic pattern.', value: v });
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Format ValidationError[] as a human-readable message (safe to surface to LLMs).
 */
export function formatErrors(errors: ValidationError[]): string {
  return errors.map(e => {
    if (e.value !== undefined) {
      const valueStr = typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value);
      return `${e.field} (${valueStr}): ${e.message}`;
    }
    return `${e.field}: ${e.message}`;
  }).join('; ');
}
