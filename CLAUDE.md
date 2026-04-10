# CLAUDE.md — Development Guidelines for scalings.xyz

## Project Overview

Browser-based autoscaling simulator (Kubernetes HPA, AWS ASG, GCP MIG). Pure TypeScript, no frameworks, runs 100% in the browser. All services are composable and testable via dependency injection.

## Build & Test

```bash
npm install        # install dependencies (first time)
npm run build      # compile TypeScript
npm test           # build + run all tests (node:test)
```

Tests must pass before committing. Currently 101 tests across simulation, config, export, and traffic services.

## Architecture

```
src/
  interfaces/types.ts    # All type definitions, service interfaces, defaults
  services/              # Business logic (simulation, config, traffic, export)
  ui/                    # DOM controllers (controls, chart, main)
  factory.ts             # DI container — wires implementations to interfaces
```

**Dependency direction**: `ui/ → factory → services/ → interfaces/`. Never import UI from services.

**Service interfaces** are defined in `types.ts`. Implementations are in `services/`. The factory wires them — swap an implementation there, nothing else changes.

## Key Design Principles

### Interface Separation
- Define service contracts as interfaces in `types.ts`, implement in `services/`
- UI depends on interfaces, not concrete classes
- New features get their own config type (like `QueueConfig`), added to `SimulationConfig`

### Simulation Extensibility
- The simulation loop processes one tick at a time: failures → state updates → capacity → autoscaler → overflow → cost → snapshot
- Overflow resolution (OLTP drop vs queue buffer) is extracted into `resolveOverflow()` — add new strategies there
- New per-tick metrics go into `TickSnapshot`, aggregates into `SimulationSummary`

### Chart Rendering
- Shared building blocks: `buildScales()`, `buildPlugins()`, `buildDatasets()`
- Dataset access uses label-based lookup (`getDatasetByLabel()`), not array indices
- Conditionally include datasets (e.g., queue depth only when queue data exists)

### UI Controls
- `getConfig()` / `setConfig()` symmetry — every field readable and writable
- Reusable helpers: `bindCollapsibleSection()` for toggle sections, `getNumericValue()`/`setNumericValue()` for form fields
- Presets merge with `{ ...DEFAULT_CONFIG, ...preset.config, section: { ...DEFAULT_CONFIG.section, ...preset.config.section } }` — always include all config sections

### Config Serialization
- Every new config section needs: YAML serialization in `toYAML()`, validation in `validateX()`, and the section registered in `validateConfig()`
- URL encoding uses JSON→base64, so new fields are automatically included
- YAML parser is hand-written for our specific schema — add array-valued keys to the parser's array detection list if needed

## Adding a New Feature (Checklist)

1. **types.ts**: Add config interface, add fields to `TickSnapshot`/`SimulationSummary` if needed, add defaults, update `SimulationConfig`
2. **simulation.ts**: Add logic to the tick loop or extract into a private method
3. **index.html**: Add UI controls (inputs, toggles)
4. **controls.ts**: Add `get`/`set` methods, bind events, include in `getConfig()`/`setConfig()`
5. **config.ts**: Add validation method, YAML serialization, register in `validateConfig()`
6. **chart.ts**: Add to `buildDatasets()` if it needs visualization
7. **main.ts**: Add to `renderSummary()` if it has a summary stat
8. **tests**: Add tests for simulation behavior, config round-trip, and edge cases
9. **presets**: Update preset merging in `bindPresets()` if adding a new config section

## Testing Conventions

- Use `node:test` (`describe`/`it`) with `node:assert/strict`
- Test files in `src/tests/*.test.ts`
- Use `makeConfig()` helper with partial overrides for test configs
- Test both the behavior and the invariants (e.g., `queue_depth <= max_size` for every tick)
- Config tests: YAML round-trip, URL round-trip, defaults for missing sections
