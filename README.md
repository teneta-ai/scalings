# scalings.xyz

An interactive autoscaling simulator for Kubernetes HPA, AWS ASG, and GCP MIG. Iterate on your scaling config in seconds, not hours.

**[Try it live at scalings.xyz](https://scalings.xyz/)**

## What it does

Configure autoscaling parameters, pick a traffic pattern, and run a time-series simulation to see if your scaling policy handles the load — before it costs real money.

Supported platforms:

- Kubernetes Horizontal Pod Autoscaler (HPA)
- AWS Auto Scaling Group (ASG)
- GCP Managed Instance Group (MIG)
- Custom / Generic autoscaler

## Features

- **Traffic patterns** — steady, gradual ramp, spike, sinusoidal wave, discrete steps, or custom time-series
- **Message broker** — optional queue between producer and service (like SQS/Kafka), with configurable size and request timeout
- **Saturation modeling** — capacity degradation under high pod utilization, request expiry via TTL, retry storm amplification
- **Chaos engineering** — random pod failure rates and scheduled pod kill events with seeded PRNG for reproducible runs
- **Real-world delays** — metric observation lag, cooldown periods, node provisioning time, graceful shutdown
- **Cost estimation** — per-replica-hour cost tracking across the simulation
- **Comparison mode** — record multiple runs, view per-run breakdown in summary stats and decision log, filter by run
- **Import/Export runs** — save multi-run comparison data as JSON for sharing or later analysis
- **Export** — generate deployable manifests (Kubernetes HPA YAML, AWS CloudFormation, GCP Terraform, gcloud CLI)
- **Shareable URLs** — encode your full config in the URL hash for easy sharing

## Built-in presets

| Preset | Description |
|---|---|
| Black Friday Spike | 10x traffic spike to stress-test scale-up speed |
| Gradual Daily Ramp | Workday traffic pattern with linear ramp |
| Noisy Neighbor | Sinusoidal traffic + random pod failures |
| Step Migration | Phased rollout with discrete traffic steps |
| Bottomless Queue | Unlimited broker — no drops, backlog drains as capacity catches up |
| Death Spiral (OLTP) | Pod saturation + retries cause cascading failure, no broker |
| Death Spiral (Queued) | Same with a bounded broker — queue fills, requests expire |

## Development

### Prerequisites

- Node.js 20+

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

Tests use the Node.js native test runner against the compiled output in `dist/tests/`.

### Project structure

```
src/
├── interfaces/
│   └── types.ts            # Type definitions (SimulationConfig, TickSnapshot, etc.)
├── services/
│   ├── config.ts           # Config serialization (YAML, URL hash, localStorage)
│   ├── export.ts           # Export to deployment formats
│   ├── simulation.ts       # Core simulation engine
│   └── traffic.ts          # Traffic pattern generation
├── tests/                  # Unit tests
├── ui/
│   ├── main.ts             # App entry point and orchestration
│   ├── controls.ts         # Form controls and parameter UI
│   └── chart.ts            # Chart.js visualization
└── factory.ts              # Service factory / DI container
```

### Config structure

The config is organized around four entities:

- **Producer** — traffic pattern (steady, spike, wave, etc.)
- **Client** — resilience behavior (max retries, retry delay)
- **Broker** — optional message queue (enabled/disabled, max size, request timeout)
- **Service** — pod fleet with scaling, cooldowns, saturation, chaos, cost

See [llms.txt](https://scalings.xyz/llms.txt) for full schema details.

## Programmatic usage

Construct a URL to load a pre-configured simulation:

```
https://scalings.xyz/#config=<base64-encoded-json>&autorun=true
```

The config parameter is a base64-encoded JSON object matching the `SimulationConfig` schema. See [llms.txt](https://scalings.xyz/llms.txt) for full schema details.

## License

[MIT](LICENSE)
