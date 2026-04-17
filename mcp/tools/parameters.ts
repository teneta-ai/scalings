// ============================================================================
// Tool: describe_parameters
// ============================================================================

import { buildParametersResponse } from '../parameter-docs.js';
import type { DescribeParametersInput, ParametersResponse } from '../types.js';

export async function describeParametersTool(input: DescribeParametersInput): Promise<ParametersResponse> {
  return buildParametersResponse(input.section);
}
