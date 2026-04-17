# CLAUDE.md — Development Guidelines for scalings.xyz

## Project Overview

Autoscaling simulator (Kubernetes HPA, AWS ASG, GCP MIG). Pure TypeScript, no frameworks, no UI dependencies in the simulation engine. All services are composable and testable via dependency injection.

**Two surfaces, one engine**:
- **Browser UI** at `scalings.xyz` — runs 100% client-side. No backend, no API calls, no telemetry. Configs share via URL hash.
- **MCP server** at `mcp.scalings.xyz/mcp` (or `scalings.xyz/mcp` as a fallback) — for AI tools (Claude Desktop, Cursor, Claude Code, etc.). Streamable HTTP, stateless, no auth. Tool calls execute on a Vercel serverless function (`api/mcp.ts`) — the only server-side execution path. The host-agnostic rewrite in `vercel.json` serves `/mcp` on any attached domain, so the endpoint keeps working even if the subdomain is detached or its production deployment is missing.

Both surfaces import `LocalSimulationService` from `src/services/`; the engine has zero DOM dependencies, so it works identically in either context.

**This app is designed to be usable by LLMs.** An LLM with code execution can run simulations via the service layer; an LLM with MCP tooling can call `mcp.scalings.xyz`; an LLM that can see/interact with the page can use the UI directly.

### How an LLM can run a simulation (no browser needed)

```ts
import { LocalSimulationService } from './services/simulation.js';
import { LocalTrafficPatternService } from './services/traffic.js';
import { DEFAULT_CONFIG } from './interfaces/types.js';

const traffic = new LocalTrafficPatternService();
const sim = new LocalSimulationService(traffic);

const config = {
  ...DEFAULT_CONFIG,
  service: { ...DEFAULT_CONFIG.service, min_replicas: 5, max_replicas: 50 },
  producer: {
    traffic: { pattern: 'spike', params: { base_rps: 200, spike_rps: 2000, spike_start: 60, spike_duration: 30 } },
  },
  client: { max_retries: 0, retry_delay: 0 },
  broker: { enabled: true, max_size: 0, request_timeout_ms: 0 },  // unlimited broker
};

const result = await sim.run(config);
console.log(result.summary);       // { total_requests, total_dropped, peak_queue_depth, ... }
console.log(result.snapshots[0]);  // per-tick data: traffic_rps, capacity_rps, queue_depth, ...
```

The config service can also generate shareable URLs and YAML without a browser:
```ts
import { LocalConfigService } from './services/config.js';
const cfgSvc = new LocalConfigService();
const yaml = cfgSvc.export(config);   // human-readable YAML
const url = cfgSvc.toURL(config);     // #config=<base64> hash
```

## LLM Usability Principles

- **Headless-first services**: Simulation, config, traffic, and export services have zero DOM dependencies. They can be imported and used in Node.js, test harnesses, or by an LLM with code execution. Only `ui/` touches the DOM.
- **Descriptive labels and tooltips**: Every input should have a `title` or tooltip that explains what the parameter does in concrete terms (units, valid ranges, what 0 or edge values mean). An LLM reading the page should understand each control without needing external docs.
- **Structured results**: Summary stats use distinct IDs (`stat-total-requests`, `stat-drop-rate`, etc.). The decision log classifies entries by type (`scale-up`, `failure`, `drop`, `recover`). Chart datasets have descriptive labels (`Traffic (RPS)`, `Queue Depth`). Keep these machine-parseable.
- **Shareable state**: The URL hash encoding (`#config=<base64>`) and YAML export mean an LLM can generate, share, or reproduce any simulation scenario without interacting with the DOM.
- **Presets as examples**: Preset scenarios serve as worked examples an LLM can reference to understand parameter relationships. When adding presets, write the description so it explains *why* the parameter choices make sense for that scenario.
- **Self-explanatory output**: Summary stats, log entries, and chart labels should use plain language. Avoid abbreviations or codes that require context to interpret.

## Build & Test

```bash
npm install        # install dependencies (first time)
npm run build      # compile TypeScript
npm test           # build + run all tests (node:test)
npm run check:docs # verify LLM docs match source of truth
```

Tests AND doc checks must pass before committing. CI runs both.

**LLM doc sync rule**: Any change to parameters, defaults, traffic patterns, presets, or platforms in `src/interfaces/types.ts` MUST be reflected in `llms-full.txt` and `docs.md`. The `npm run check:docs` script validates this automatically — it extracts every field name from `DEFAULT_SERVICE`, `DEFAULT_CLIENT`, `DEFAULT_BROKER`, `DEFAULT_SIMULATION`, every traffic pattern from `TrafficPatternType`, every preset from `PRESET_SCENARIOS`, and every platform from `Platform`, then verifies each one appears in both doc files. CI will block merges if docs are stale.

## Architecture

```
src/
  interfaces/types.ts    # All type definitions, service interfaces, defaults
  services/              # Business logic (simulation, config, traffic, export)
  ui/                    # DOM controllers (controls, chart, main)
  factory.ts             # DI container — wires implementations to interfaces
mcp/
  server.ts              # MCP server setup — registers 5 tools on an McpServer
  validation.ts          # mergeWithDefaults + validateSimulationConfig
  parameter-docs.ts      # Structured parameter metadata for describe_parameters
  tools/                 # One file per tool — imports LocalSimulationService etc.
  tests/                 # node:test suite for tool handlers + validation + integration
  tsconfig.json          # Separate build → dist-mcp/ (site build stays in dist/)
api/
  mcp.ts                 # Vercel serverless entry — wraps mcp/server.ts with mcp-handler
```

**Dependency direction**: `ui/ → factory → services/ → interfaces/`. Never import UI from services.

**MCP server**: `api/mcp.ts → mcp/server.ts → mcp/tools/* → src/services/* → src/interfaces/types.ts`. The MCP layer never duplicates simulation logic — it imports `LocalSimulationService`, `LocalTrafficPatternService`, and `LocalConfigService` directly. Deployed on Vercel as a serverless function reachable at `/mcp` on any attached domain (`mcp.scalings.xyz/mcp` and `scalings.xyz/mcp` both resolve to the same function via `vercel.json` rewrites).

**Service interfaces** are defined in `types.ts`. Implementations are in `services/`. The factory wires them — swap an implementation there, nothing else changes.

## Key Design Principles

### Interface Separation
- Define service contracts as interfaces in `types.ts`, implement in `services/`
- UI depends on interfaces, not concrete classes
- Config is organized around four entities: `ProducerConfig` (traffic), `ClientConfig` (retries/resilience), `BrokerConfig` (optional queue middleware), `ServiceConfig` (pod fleet, scaling, saturation, chaos)

### Simulation Extensibility
- The simulation loop processes one tick at a time: failures → state updates → capacity → autoscaler → overflow → cost → snapshot
- Overflow resolution (OLTP drop vs queue buffer) is extracted into `resolveOverflow()` — add new strategies there
- New per-tick metrics go into `TickSnapshot`, aggregates into `SimulationSummary`

### Chart Rendering
- Shared building blocks: `buildScales()`, `buildPlugins()`, `buildDatasets()`
- Dataset access uses label-based lookup (`getDatasetByLabel()`), not array indices
- Conditionally include datasets (e.g., queue depth only when queue data exists)
- Exported helpers `formatTime()` and `formatTooltipLabel()` handle display formatting and are tested independently of Chart.js/DOM
- Both simulation chart and traffic preview show hover tooltips with time (M:SS) and formatted values

### UI Controls
- `getConfig()` / `setConfig()` symmetry — every field readable and writable
- Reusable helpers: `bindCollapsibleSection()` for toggle sections, `getNumericValue()`/`setNumericValue()` for form fields
- Presets merge with `{ ...DEFAULT_CONFIG, ...preset.config, service: { ...DEFAULT_CONFIG.service, ...preset.config.service } }` — always include all config sections

### Config Serialization
- Every new config section needs: YAML serialization in `toYAML()`, validation in `validateX()`, and the section registered in `validateConfig()`
- URL encoding uses JSON→base64, so new fields are automatically included
- YAML parser is hand-written for our specific schema — add array-valued keys to the parser's array detection list if needed

## Adding a New Feature (Checklist)

1. **types.ts**: Add fields to `ProducerConfig`, `ClientConfig`, `BrokerConfig`, or `ServiceConfig` as appropriate. Add fields to `TickSnapshot`/`SimulationSummary` if needed. Update defaults.
2. **simulation.ts**: Add logic to the tick loop or extract into a private method
3. **index.html**: Add UI controls (inputs, toggles)
4. **controls.ts**: Add `get`/`set` methods, bind events, include in `getConfig()`/`setConfig()`
5. **config.ts**: Add validation method, YAML serialization, register in `validateConfig()`
6. **chart.ts**: Add to `buildDatasets()` if it needs visualization
7. **main.ts**: Add to `renderSummary()` if it has a summary stat
8. **tests**: Add tests for simulation behavior, config round-trip, and edge cases
9. **presets**: Update preset merging in `bindPresets()` if adding a new config section
10. **LLM docs** (MANDATORY — CI will fail if skipped): Update all three files when adding/changing parameters, traffic patterns, presets, or platforms:
    - `llms-full.txt`: Add the new parameter to the Parameters Reference table, update JSON schema, update worked examples if relevant
    - `docs.md`: Add the new parameter to the appropriate Parameters table, update YAML schema if relevant
    - `llms.txt`: Update if adding a major new capability (new platform, new export type, etc.)
    - Run `npm run check:docs` locally to verify — this same check runs in CI and will block the PR if docs are stale
11. **README.md**: Update feature list, config entity descriptions, and preset table if changed

## Testing Conventions

- Use `node:test` (`describe`/`it`) with `node:assert/strict`
- Test files in `src/tests/*.test.ts`
- Use `makeConfig()` helper with partial overrides for test configs
- Test both the behavior and the invariants (e.g., `queue_depth <= max_size` for every tick)
- Config tests: YAML round-trip, URL round-trip, defaults for missing sections
