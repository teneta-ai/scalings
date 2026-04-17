// ============================================================================
// Tool: run_simulation
// ============================================================================

import { LocalSimulationService } from '../../src/services/simulation.js';
import { LocalTrafficPatternService } from '../../src/services/traffic.js';
import type { SimulationResult } from '../../src/interfaces/types.js';
import { mergeWithDefaults, validateSimulationConfig, formatErrors } from '../validation.js';
import type { RunSimulationInput } from '../types.js';

const trafficService = new LocalTrafficPatternService();
const simulationService = new LocalSimulationService(trafficService);

export async function runSimulationTool(input: RunSimulationInput): Promise<SimulationResult> {
  const merged = mergeWithDefaults(input.config ?? {});
  const validation = validateSimulationConfig(merged);
  if (!validation.valid) {
    throw new Error(`Invalid simulation config: ${formatErrors(validation.errors)}`);
  }
  return simulationService.run(validation.config);
}
