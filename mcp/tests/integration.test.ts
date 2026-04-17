// ============================================================================
// Integration tests — exercise the MCP server via its internal server factory.
// ============================================================================
//
// These tests do NOT boot an HTTP server. They instantiate the McpServer
// directly, register the tools via registerTools(), and make in-process calls
// through the low-level Server API to verify protocol wiring (tool listing,
// tool invocation, error handling) without MCP transport overhead.

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, SERVER_NAME, SERVER_VERSION } from '../server.js';

function makeServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  return server;
}

/** Access the private registry safely for assertions. */
function getRegisteredTools(server: McpServer): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
}

describe('MCP server integration', () => {
  it('exposes correct server name and version metadata', () => {
    assert.equal(SERVER_NAME, 'scalings');
    assert.ok(SERVER_VERSION);
  });

  it('registers exactly 5 tools', () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    const names = Object.keys(tools).sort();
    assert.deepEqual(names, [
      'compare_simulations',
      'describe_parameters',
      'get_simulation_url',
      'list_presets',
      'run_simulation',
    ]);
  });

  it('each tool has a description and callback', () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    for (const [name, entry] of Object.entries(tools)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = entry as any;
      assert.ok(t.description, `tool ${name} missing description`);
      assert.equal(typeof t.handler, 'function', `tool ${name} missing callback`);
    }
  });

  it('run_simulation tool invokes and returns text content', async () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runTool = (tools as any).run_simulation;
    const result = await runTool.handler(
      { config: { simulation: { duration: 10, tick_interval: 1 } } },
      {} as never,
    );
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.run_id);
    assert.equal(parsed.snapshots.length, 10);
  });

  it('run_simulation returns an error result on invalid input', async () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runTool = (tools as any).run_simulation;
    const result = await runTool.handler(
      { config: { service: { max_replicas: 5000 } } },
      {} as never,
    );
    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /max_replicas/i);
  });

  it('list_presets returns all presets as text JSON', async () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listTool = (tools as any).list_presets;
    const result = await listTool.handler({}, {} as never);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(parsed.presets));
    assert.ok(parsed.presets.length > 0);
  });

  it('get_simulation_url returns a proper URL result', async () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const urlTool = (tools as any).get_simulation_url;
    const result = await urlTool.handler({ config: {}, autorun: true }, {} as never);
    const parsed = JSON.parse(result.content[0].text);
    assert.match(parsed.url, /^https:\/\/scalings\.xyz\/#config=.+&autorun=true$/);
  });

  it('describe_parameters returns full schema by default', async () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const descTool = (tools as any).describe_parameters;
    const result = await descTool.handler({}, {} as never);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.sections);
    assert.ok(parsed.sections.service);
    assert.ok(parsed.traffic_patterns);
  });

  it('compare_simulations returns both results and a comparison', async () => {
    const server = makeServer();
    const tools = getRegisteredTools(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmpTool = (tools as any).compare_simulations;
    const result = await cmpTool.handler(
      {
        config_a: { simulation: { duration: 10, tick_interval: 1 } },
        config_b: {
          simulation: { duration: 10, tick_interval: 1 },
          service: { min_replicas: 20 },
        },
      },
      {} as never,
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.a.snapshots);
    assert.ok(parsed.b.snapshots);
    assert.ok(parsed.comparison);
  });
});
