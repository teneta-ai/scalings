// ============================================================================
// Test helpers for MCP tool tests.
// ============================================================================

import {
  DEFAULT_CONFIG,
  DEFAULT_SIMULATION,
  DEFAULT_SERVICE,
  SimulationConfig,
} from '../../src/interfaces/types.js';

/**
 * Build a fully-formed SimulationConfig with sane test defaults applied on top
 * of DEFAULT_CONFIG. Mirrors the makeConfig() helper in src/tests/simulation.test.ts
 * but returns deep overrides merged with defaults.
 */
export function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    simulation: { ...DEFAULT_SIMULATION, duration: 60, tick_interval: 1 },
    service: {
      ...DEFAULT_SERVICE,
      metric_observation_delay: 0,
      cooldown_scale_up: 0,
      cooldown_scale_down: 0,
    },
    ...overrides,
  };
}
