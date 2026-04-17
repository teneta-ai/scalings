# scalings.xyz MCP Server

An MCP (Model Context Protocol) server that lets AI coding tools run
autoscaling simulations programmatically — not just read docs. It wraps the
headless simulation engine from `src/services/` in five tools served over
Streamable HTTP. Stateless, public, no auth.

- **Endpoint**: `https://mcp.scalings.xyz/mcp`
- **Transport**: Streamable HTTP (no SSE, no stdio in prod)
- **Hosted on**: Vercel Serverless Functions (same repo as the site)

## Connecting

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scalings": { "url": "https://mcp.scalings.xyz/mcp" }
  }
}
```

**Cursor** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "scalings": { "url": "https://mcp.scalings.xyz/mcp" }
  }
}
```

**Claude Code** —

```bash
claude mcp add --transport http scalings https://mcp.scalings.xyz/mcp
```

**Generic MCP client** — point it at `https://mcp.scalings.xyz/mcp` over
Streamable HTTP.

## Tools

| Tool | What it does |
|------|--------------|
| `run_simulation` | Run one simulation. Accepts a partial `SimulationConfig`; missing fields fill from defaults. Returns `{ run_id, snapshots, summary }`. |
| `compare_simulations` | Run two configs and return both results plus a delta summary (drops, drop-rate pp, peak pods, cost, recovery time). |
| `list_presets` | List every built-in preset scenario with a fully-merged config ready to feed into `run_simulation`. |
| `get_simulation_url` | Generate a shareable `scalings.xyz/#config=<base64>` URL. Optional `autorun=true` appended. |
| `describe_parameters` | Structured documentation for every parameter: type, default, description, unit, valid range. Start here to learn what knobs exist. |

See [docs.md#mcp-server](https://scalings.xyz/docs.md#mcp-server) or
[llms-full.txt](https://scalings.xyz/llms-full.txt) for full tool schemas and
worked examples.

## Validation

Every tool validates input before executing the simulation. Invalid input
returns an MCP error with a specific message (e.g.
`service.max_replicas (5000): Must be <= 1000.`). Limits:

- `simulation.duration` ∈ (0, 3600]
- `simulation.tick_interval` ∈ [0.5, duration]
- `service.max_replicas` ∈ [1, 1000]
- `min_replicas` ≤ `max_replicas`
- `scale_down_threshold` < `scale_up_threshold`
- All numeric fields finite, non-NaN, non-negative where applicable
- Traffic `params` shape must match `pattern`

## Local development

```bash
npm install
npm run test:mcp          # compile mcp/ and run its test suite
npm run build:mcp         # compile mcp/ → dist-mcp/
npm test                  # site tests + MCP tests
```

The MCP code imports directly from `../src/services/` and `../src/interfaces/`
— there is exactly one simulation engine, and the MCP server uses it.

## Deployment

Deployed on Vercel, same project as the site. `api/mcp.ts` is the serverless
entry point; it wraps `mcp/server.ts` with `mcp-handler`'s `createMcpHandler`.
The `vercel.json` rewrites are host-agnostic, so the endpoint is reachable at
both `https://mcp.scalings.xyz/mcp` (branded URL) and
`https://scalings.xyz/mcp` (stable fallback that keeps working even if the
subdomain is detached, its production deployment is missing, or DNS for the
subdomain breaks). Both paths hit the same function. `maxDuration: 30s` is a
safety cap — simulations run in milliseconds locally.

### Troubleshooting `DEPLOYMENT_NOT_FOUND` on `mcp.scalings.xyz`

This Vercel error means the subdomain isn't attached to a project with a live
production deployment. It's a dashboard-side issue, not a code issue. Check,
in order:

1. The Vercel project still exists and has a green Production deployment.
2. `mcp.scalings.xyz` is listed under exactly one project's Settings → Domains.
3. Git is still connected and the root directory is correct.
4. DNS for the subdomain still resolves to a Vercel CNAME (`dig mcp.scalings.xyz +short`).

Until the subdomain is repaired, clients can point at `https://scalings.xyz/mcp`
— identical function, identical behavior.

## Structure

```
mcp/
  server.ts              # createMcpHandler factory — registers the 5 tools
  validation.ts          # mergeWithDefaults + validateSimulationConfig
  parameter-docs.ts      # canonical parameter metadata
  types.ts               # MCP-specific types (ComparisonSummary, ParameterDoc, tool I/O)
  tools/                 # one file per tool — all thin wrappers over src/services/
  tests/                 # node:test — unit + integration
  tsconfig.json          # separate compilation → ../dist-mcp/
```
