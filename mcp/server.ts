// ============================================================================
// scalings.xyz MCP — Server Setup
// ============================================================================
//
// registerTools(server): attach all 5 simulation tools to a passed-in McpServer.
// Exported separately so integration tests can instantiate the server in-process
// without standing up an HTTP transport.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runSimulationTool } from './tools/run-simulation.js';
import { compareSimulationsTool } from './tools/compare.js';
import { listPresetsTool } from './tools/presets.js';
import { getSimulationUrlTool } from './tools/url.js';
import { describeParametersTool } from './tools/parameters.js';

export const SERVER_NAME = 'scalings';
export const SERVER_VERSION = '1.0.0';

// Permissive config schema: accepts any shape; validation is performed inside
// each tool handler against the full type-aware validator. This keeps the MCP
// JSON Schema small while still giving callers precise error messages.
const configSchema = z
  .record(z.any())
  .describe('Partial or full SimulationConfig. Missing fields inherit from DEFAULT_CONFIG. See describe_parameters for the full schema.');

function asText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function asError(message: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

// Wraps a tool handler so that thrown errors become isError MCP responses
// with descriptive text — giving callers actionable feedback instead of opaque
// protocol-level failures.
async function safeInvoke<T>(fn: () => Promise<T>): Promise<ReturnType<typeof asText> | ReturnType<typeof asError>> {
  try {
    const result = await fn();
    return asText(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return asError(message);
  }
}

export function registerTools(server: McpServer): void {
  server.tool(
    'run_simulation',
    'Run an autoscaling simulation with the given configuration. Returns per-tick snapshots and an aggregate summary (total requests, drops, peak pods, cost, recovery time). Accepts partial configs — missing fields inherit from DEFAULT_CONFIG.',
    { config: configSchema },
    async (args) => safeInvoke(() => runSimulationTool({ config: args.config as Record<string, unknown> })),
  );

  server.tool(
    'compare_simulations',
    'Run two simulations with different configurations side-by-side. Returns both full SimulationResults plus a ComparisonSummary of key metric deltas (b - a): dropped, drop_rate_pp, peak_pods, cost, recovery time.',
    {
      config_a: configSchema,
      config_b: configSchema,
      labels: z
        .object({ a: z.string().optional(), b: z.string().optional() })
        .partial()
        .optional()
        .describe('Optional human-readable names for each config (default: "a", "b").'),
    },
    async (args) =>
      safeInvoke(() =>
        compareSimulationsTool({
          config_a: args.config_a as Record<string, unknown>,
          config_b: args.config_b as Record<string, unknown>,
          labels: args.labels,
        }),
      ),
  );

  server.tool(
    'list_presets',
    'List all available preset simulation scenarios (e.g. Black Friday Spike, Gradual Daily Ramp). Each preset includes a name, description, and full SimulationConfig merged with defaults — ready to feed into run_simulation.',
    {},
    async () => safeInvoke(() => listPresetsTool()),
  );

  server.tool(
    'get_simulation_url',
    'Generate a shareable scalings.xyz URL that opens the simulator pre-loaded with the given config. Set autorun=true to start the simulation immediately on page load.',
    {
      config: configSchema,
      autorun: z.boolean().optional().describe('If true, append &autorun=true so the simulator runs on load.'),
    },
    async (args) =>
      safeInvoke(() =>
        getSimulationUrlTool({
          config: args.config as Record<string, unknown>,
          autorun: args.autorun,
        }),
      ),
  );

  server.tool(
    'describe_parameters',
    'Describe every available simulation parameter: name, type, default, description, valid range, unit. Use this to learn what knobs exist before constructing a config. Optional section filter narrows output to a single config group.',
    {
      section: z
        .enum(['service', 'producer', 'client', 'broker', 'simulation'])
        .optional()
        .describe('Limit output to one config section. Omit for the full schema.'),
    },
    async (args) => safeInvoke(() => describeParametersTool({ section: args.section })),
  );
}
