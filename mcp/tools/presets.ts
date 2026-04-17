// ============================================================================
// Tool: list_presets
// ============================================================================

import { PRESET_SCENARIOS } from '../../src/interfaces/types.js';
import { mergeWithDefaults } from '../validation.js';
import type { ListPresetsOutput } from '../types.js';

export async function listPresetsTool(): Promise<ListPresetsOutput> {
  return {
    presets: PRESET_SCENARIOS.map(p => ({
      name: p.name,
      description: p.description,
      config: mergeWithDefaults(p.config),
    })),
  };
}
