// ============================================================================
// Tool: compare_simulations
// ============================================================================

import { LocalSimulationService } from '../../src/services/simulation.js';
import { LocalTrafficPatternService } from '../../src/services/traffic.js';
import { mergeWithDefaults, validateSimulationConfig, formatErrors } from '../validation.js';
import type {
  CompareSimulationsInput,
  CompareSimulationsOutput,
  ComparisonSummary,
  SimulationResult,
} from '../types.js';

const trafficService = new LocalTrafficPatternService();
const simulationService = new LocalSimulationService(trafficService);

export async function compareSimulationsTool(input: CompareSimulationsInput): Promise<CompareSimulationsOutput> {
  const labels = {
    a: input.labels?.a ?? 'a',
    b: input.labels?.b ?? 'b',
  };

  const mergedA = mergeWithDefaults(input.config_a ?? {});
  const mergedB = mergeWithDefaults(input.config_b ?? {});

  const valA = validateSimulationConfig(mergedA);
  if (!valA.valid) {
    throw new Error(`Invalid config_a: ${formatErrors(valA.errors)}`);
  }
  const valB = validateSimulationConfig(mergedB);
  if (!valB.valid) {
    throw new Error(`Invalid config_b: ${formatErrors(valB.errors)}`);
  }

  const [a, b] = await Promise.all([
    simulationService.run(valA.config),
    simulationService.run(valB.config),
  ]);

  const comparison = buildComparison(a, b, labels);
  return { a, b, comparison };
}

function buildComparison(
  a: SimulationResult,
  b: SimulationResult,
  labels: { a: string; b: string },
): ComparisonSummary {
  const recoverA = a.summary.time_to_recover_seconds;
  const recoverB = b.summary.time_to_recover_seconds;
  const recoverDelta =
    recoverA === null || recoverB === null ? null : recoverB - recoverA;

  return {
    labels,
    total_requests_delta: b.summary.total_requests - a.summary.total_requests,
    total_dropped_delta: b.summary.total_dropped - a.summary.total_dropped,
    drop_rate_delta_pp: b.summary.drop_rate_percent - a.summary.drop_rate_percent,
    peak_pods_delta: b.summary.peak_pod_count - a.summary.peak_pod_count,
    peak_queue_depth_delta: b.summary.peak_queue_depth - a.summary.peak_queue_depth,
    time_to_recover_delta_seconds: recoverDelta,
    estimated_total_cost_delta: b.summary.estimated_total_cost - a.summary.estimated_total_cost,
  };
}
