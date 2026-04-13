# scalings.xyz Documentation

## What is scalings.xyz?

scalings.xyz is an interactive, fully client-side autoscaling simulator. It lets engineers configure autoscaling parameters, select a traffic pattern, and run a discrete-time simulation to visualize whether their scaling policy can handle the load. Once you've found a config that works, export deployment manifests for your platform and load test scripts to validate against real infrastructure.

## When to use it

- **Prioritize optimizations** — Is it worth cutting pod startup time from 30s to 10s? Would faster metric delivery help more? Or is simply overprovisioning cheaper? Change one parameter, compare runs, and see exactly how many dropped requests each option saves you.
- **Set optimization targets** — Don't guess what your startup time or cooldown "should" be. Simulate a range of values against your actual traffic pattern and pick the one that balances cost vs. reliability.
- **Validate before deploying** — Test a new HPA config, ASG policy, or MIG setup against realistic traffic patterns before it hits production.
- **Post-incident analysis** — Replay a traffic spike that caused an outage. Tweak the scaling config until the sim shows zero drops, then export the fix.
- **Capacity planning** — Model upcoming events (product launches, seasonal traffic) to figure out min replicas, max replicas, and cost ahead of time.
- **Chaos engineering** — Schedule pod failures at specific times to test how your scaling policy recovers from node outages or AZ failures during load.
- **Load test generation** — Export ready-to-run load test scripts (k6, Gatling, Locust, JMeter, Artillery) that reproduce your simulated traffic pattern against a real endpoint. Validate that your infrastructure handles the load before going live.

## Supported Platforms

- **Kubernetes HPA** — Horizontal Pod Autoscaler
- **AWS ASG** — Auto Scaling Group
- **GCP MIG** — Managed Instance Group
- **Custom / Generic** — Any autoscaler

## Parameters Reference

### Basic Parameters

| Parameter | Description | Type | Default | Range |
|-----------|-------------|------|---------|-------|
| `min_replicas` | Floor for scale-down. The autoscaler will never scale below this count. | integer | 1 | >= 1 |
| `max_replicas` | Ceiling for scale-up. The autoscaler will never scale above this count. | integer | 50 | >= min_replicas |
| `scale_up_threshold` | Utilization percentage that triggers a scale-up event. | number | 80 | 0-100 |
| `scale_down_threshold` | Utilization percentage that triggers a scale-down event. | number | 30 | 0-100 |
| `startup_time` | Seconds for a new pod/instance to become ready and start serving traffic. | number | 30 | >= 0 |
| `capacity_per_replica` | Maximum requests per second a single pod/instance can handle. | number | 100 | > 0 |

### Scaling Step Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `scale_up_step` | Number of pods/instances to add per scale-up event. | integer | 4 |
| `scale_down_step` | Number of pods/instances to remove per scale-down event. | integer | 1 |

### Advanced Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `metric_observation_delay` | Seconds of lag before the autoscaler detects utilization changes. Models the real-world delay in metrics pipelines. | number | 15 |
| `cooldown_scale_up` | Minimum seconds between consecutive scale-up events (stabilization window). | number | 15 |
| `cooldown_scale_down` | Minimum seconds between consecutive scale-down events (stabilization window). | number | 60 |
| `node_provisioning_time` | Seconds to provision a new node when all existing nodes are full. 0 means nodes are pre-provisioned. | number | 120 |
| `cluster_node_capacity` | Maximum number of nodes in the cluster. | integer | 20 |
| `pods_per_node` | Maximum pods that fit on a single node. | integer | 10 |
| `graceful_shutdown_time` | Seconds a terminating pod keeps serving requests before fully shutting down. | number | 30 |
| `cost_per_replica_hour` | USD cost per pod-hour, used for cost estimation in simulation results. | number | 0.05 |

### Saturation Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `saturation_threshold` | Utilization percentage at which pod capacity starts degrading. 0 disables saturation modeling. | number | 0 |
| `max_capacity_reduction` | Maximum fraction of capacity lost at full saturation (0-1). For example, 0.4 means a pod loses up to 40% of its capacity. | number | 0 |

### Client Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `max_retries` | Maximum retry attempts per failed request. 0 means no retries. Models retry storms. | integer | 0 |
| `retry_delay` | Seconds to wait between failure and retry. 0 means retry on the next tick. | number | 0 |
| `retry_strategy` | Retry backoff strategy: `fixed`, `exponential`, or `exponential-jitter`. | string | "fixed" |

### Broker Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `enabled` | Toggle the message broker on/off. When off, excess requests beyond capacity are dropped immediately. | boolean | false |
| `max_size` | Maximum number of requests the broker can queue. 0 means unlimited. | integer | 1000 |
| `request_timeout_ms` | Maximum milliseconds a request waits in the queue before expiring. 0 means no timeout. | integer | 0 |

### Chaos Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `pod_failure_rate` | Percentage probability (0-100) that any running pod fails on each tick. | number | 0 |
| `random_seed` | Seed for the pseudo-random number generator. 0 means non-deterministic. Use a fixed seed for reproducible chaos. | integer | 0 |
| `failure_events` | Array of scheduled pod kills: `[{time, count}]`. `time` is seconds into the simulation, `count` is number of running pods to kill. | array | [] |

### Simulation Parameters

| Parameter | Description | Type | Default |
|-----------|-------------|------|---------|
| `duration` | Total simulation length in seconds. | number | 600 |
| `tick_interval` | Seconds per simulation tick. Each tick processes traffic, scaling decisions, and state changes. | number | 1 |

## Traffic Patterns

### Steady

Constant RPS throughout the simulation.

- **Pattern key**: `steady`
- **Parameters**: `rps` (number) — requests per second

### Gradual Ramp

Linear ramp from start to end RPS over the simulation duration.

- **Pattern key**: `gradual`
- **Parameters**: `start_rps` (number), `end_rps` (number)

### Spike

Base RPS with a sudden jump to spike RPS at a specified time.

- **Pattern key**: `spike`
- **Parameters**: `base_rps` (number), `spike_rps` (number), `spike_start` (seconds), `spike_duration` (seconds)

### Wave

Sinusoidal oscillation around a base RPS.

- **Pattern key**: `wave`
- **Parameters**: `base_rps` (number), `amplitude` (number), `period` (seconds)
- **Formula**: `base_rps + amplitude * sin(2 * pi * t / period)`

### Step Function

Discrete steps that hold at each RPS level for a specified duration. After the final step, the last RPS value is held.

- **Pattern key**: `step`
- **Parameters**: `steps` — array of `{rps, duration}` objects

### Custom

User-defined time series with linear interpolation between points.

- **Pattern key**: `custom`
- **Parameters**: `series` — array of `{t, rps}` objects where `t` is seconds

## YAML Config Schema

```yaml
# scalings.xyz simulator config v2
version: 2
name: "My Simulation"
platform: kubernetes-hpa

simulation:
  duration: 600
  tick_interval: 1

producer:
  traffic:
    pattern: spike
    params:
      base_rps: 200
      spike_rps: 2000
      spike_start: 120
      spike_duration: 60

client:
  max_retries: 0
  retry_delay: 0
  retry_strategy: fixed

broker:
  enabled: false
  max_size: 1000
  request_timeout_ms: 0

service:
  min_replicas: 1
  max_replicas: 50
  scale_up_threshold: 80
  scale_down_threshold: 30
  capacity_per_replica: 100
  startup_time: 30
  scale_up_step: 4
  scale_down_step: 1
  metric_observation_delay: 15
  cooldown_scale_up: 15
  cooldown_scale_down: 60
  node_provisioning_time: 120
  cluster_node_capacity: 20
  pods_per_node: 10
  graceful_shutdown_time: 30
  cost_per_replica_hour: 0.05
  saturation_threshold: 0
  max_capacity_reduction: 0
  pod_failure_rate: 0
  random_seed: 0
  failure_events: []
```

## URL Hash API

Share a pre-configured simulation via URL:

```
scalings.xyz/#config=<base64-encoded-json>
```

The `config` parameter is a base64-encoded JSON object matching the `SimulationConfig` schema. Add `&autorun=true` to auto-run the simulation on page load.

AI agents and scripts can construct these URLs programmatically to link users directly to a pre-configured simulation.

## Built-in Presets

| Preset | Description |
|--------|-------------|
| **Black Friday Spike** | 10x traffic spike (200 to 2000 RPS) lasting 60s with aggressive scaling (min: 10, max: 100, step: 10, threshold: 50%) |
| **Gradual Daily Ramp** | Traffic linearly increases from 50 to 800 RPS over 600s, simulating a typical workday |
| **Noisy Neighbor** | Wave traffic (300 +/- 200 RPS, period 120s) with 0.5% random pod failures simulating shared infrastructure |
| **Step Migration** | Traffic in discrete steps (100, 300, 600, 1000, 500 RPS at 120s each), simulating a phased rollout |
| **Bottomless Queue** | Spike traffic with an unlimited broker — no requests dropped, backlog drains as capacity catches up |
| **Death Spiral (OLTP)** | Pod saturation (85% threshold, 40% reduction) + retries (3 max, 2s delay) cause cascading failure without a broker |
| **Death Spiral (Queued)** | Same as OLTP but with a bounded broker (5000 max, 10s timeout) — queue fills, requests expire, retries amplify |

## Export Types

### Source Config Export

Saves and shares the full simulation scenario as YAML. Use for version control and sharing with teammates.

### Target Config Export

Generates a deployable manifest for your platform:

- **Kubernetes HPA YAML** — HPA manifest with minReplicas, maxReplicas, scale-up/down behavior, metrics, and cooldowns
- **AWS CloudFormation** — ASG with min/max size, launch template, scaling policies, and CloudWatch alarms
- **GCP Terraform** — Compute autoscaler, instance group manager, and health check resources

### Load Test Export

Generates a ready-to-run load test script that reproduces your simulated traffic pattern against a real endpoint. Supported frameworks:

- **k6** — Modern JavaScript-based load testing by Grafana. Uses `constant-arrival-rate` or `ramping-arrival-rate` scenarios.
- **Gatling** — JVM-based load testing. Generates a Java simulation class with injection profiles.
- **Locust** — Python-based load testing. Generates a `HttpUser` class with optional `LoadTestShape` for non-steady patterns.
- **JMeter** — Apache JMeter JMX format. Uses standard Thread Groups for steady traffic and the Ultimate Thread Group plugin for dynamic patterns (spike, wave, step, custom).
- **Artillery** — Node.js YAML-based load testing. Maps traffic patterns to Artillery phases.

Generated scripts include the simulation share URL as a comment, so recipients can trace back to the original scalings.xyz scenario. Configure the target URL, HTTP method, headers, and request body before generating. Template variables (`$randInt`, `$randString`, `$uuid`, `$timestamp`, `$randFloat`, `$randomEmail`) are translated to each framework's native random-data idioms.
