// ============================================================================
// scalings.xyz MCP — Types
// ============================================================================
//
// Re-exports simulation types from the core package and declares MCP-specific
// types (comparison summaries, parameter docs, validation errors, tool I/O).
// No type duplication: any field that also exists in src/interfaces/types.ts
// is imported from there.

import type {
  SimulationConfig,
  SimulationResult,
  PresetScenario,
  TrafficPatternType,
  RetryStrategy,
  Platform,
} from '../src/interfaces/types.js';

export type {
  SimulationConfig,
  SimulationResult,
  PresetScenario,
  TrafficPatternType,
  RetryStrategy,
  Platform,
};

// --- DeepPartial for accepting partial configs ---

export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

// --- Validation result ---

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export type ValidationResult =
  | { valid: true; config: SimulationConfig }
  | { valid: false; errors: ValidationError[] };

// --- Comparison summary (b - a deltas) ---

export interface ComparisonSummary {
  labels: { a: string; b: string };
  total_requests_delta: number;
  total_dropped_delta: number;
  drop_rate_delta_pp: number;          // percentage points
  peak_pods_delta: number;
  peak_queue_depth_delta: number;
  time_to_recover_delta_seconds: number | null;
  estimated_total_cost_delta: number;
}

// --- Parameter documentation ---

export type ParameterType =
  | 'number'
  | 'integer'
  | 'boolean'
  | 'string'
  | 'enum'
  | 'array'
  | 'object';

export interface ParameterDoc {
  name: string;
  path: string;                         // dotted path e.g. "service.max_replicas"
  type: ParameterType;
  default: unknown;
  description: string;
  unit?: string;                        // seconds, rps, %, USD/hour, etc.
  min?: number;
  max?: number;
  enum_values?: readonly string[];
}

export interface TrafficPatternDoc {
  pattern: TrafficPatternType;
  description: string;
  params: ParameterDoc[];
}

export interface ParametersResponse {
  sections?: Record<string, ParameterDoc[]>;
  traffic_patterns?: TrafficPatternDoc[];
  enums?: Record<string, readonly string[]>;
}

// --- MCP tool I/O shapes ---

export interface RunSimulationInput {
  config: DeepPartial<SimulationConfig>;
}

export interface CompareSimulationsInput {
  config_a: DeepPartial<SimulationConfig>;
  config_b: DeepPartial<SimulationConfig>;
  labels?: { a?: string; b?: string };
}

export interface CompareSimulationsOutput {
  a: SimulationResult;
  b: SimulationResult;
  comparison: ComparisonSummary;
}

export interface ListPresetsOutput {
  presets: Array<{
    name: string;
    description: string;
    config: SimulationConfig;           // fully merged with defaults
  }>;
}

export interface GetSimulationUrlInput {
  config: DeepPartial<SimulationConfig>;
  autorun?: boolean;
}

export interface GetSimulationUrlOutput {
  url: string;
}

export interface DescribeParametersInput {
  section?: 'service' | 'producer' | 'client' | 'broker' | 'simulation';
}
