// ============================================================================
// Tool: get_simulation_url
// ============================================================================

import { LocalConfigService } from '../../src/services/config.js';
import { mergeWithDefaults, validateSimulationConfig, formatErrors } from '../validation.js';
import type { GetSimulationUrlInput, GetSimulationUrlOutput } from '../types.js';

const configService = new LocalConfigService();
const SITE_BASE = 'https://scalings.xyz/';

export async function getSimulationUrlTool(input: GetSimulationUrlInput): Promise<GetSimulationUrlOutput> {
  const merged = mergeWithDefaults(input.config ?? {});
  const validation = validateSimulationConfig(merged);
  if (!validation.valid) {
    throw new Error(`Invalid config: ${formatErrors(validation.errors)}`);
  }
  const hash = configService.toURL(validation.config); // returns "#config=<base64>"
  const autorun = input.autorun === true ? '&autorun=true' : '';
  return { url: `${SITE_BASE}${hash}${autorun}` };
}
