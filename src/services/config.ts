// ============================================================================
// scalings.xyz — Config Service (Import/Export/URL/localStorage)
// ============================================================================

import {
  ConfigService,
  SimulationConfig,
  DEFAULT_CONFIG,
  Platform,
  TrafficPatternType,
  ProducerConfig,
  ClientConfig,
  BrokerConfig,
  ServiceConfig,
  FailureEvent,
  SimulationParams,
  TrafficConfig,
  SteadyParams,
  GradualParams,
  SpikeParams,
  WaveParams,
  StepParams,
  CustomParams,
} from '../interfaces/types.js';

const LOCAL_STORAGE_KEY = 'scalings_xyz_config';

export class LocalConfigService implements ConfigService {

  export(config: SimulationConfig): string {
    return this.toYAML(config);
  }

  import(yaml: string): SimulationConfig {
    return this.fromYAML(yaml);
  }

  toURL(config: SimulationConfig): string {
    const json = JSON.stringify(config);
    const encoded = btoa(unescape(encodeURIComponent(json)));
    return `#config=${encoded}`;
  }

  fromURL(hash: string): SimulationConfig {
    const match = hash.match(/config=([^&]+)/);
    if (!match) throw new Error('No config found in URL hash');
    const json = decodeURIComponent(escape(atob(match[1])));
    const parsed = JSON.parse(json);
    return this.validateConfig(parsed);
  }

  saveLocal(config: SimulationConfig): void {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    } catch {
      // localStorage might be unavailable
    }
  }

  loadLocal(): SimulationConfig | null {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return this.validateConfig(parsed);
    } catch {
      return null;
    }
  }

  private validateConfig(obj: Record<string, unknown>): SimulationConfig {
    const config = { ...DEFAULT_CONFIG };

    if (typeof obj.version === 'number') config.version = obj.version;
    if (typeof obj.name === 'string') config.name = obj.name;
    if (typeof obj.description === 'string') config.description = obj.description;

    const validPlatforms: Platform[] = ['kubernetes-hpa', 'aws-asg', 'gcp-mig', 'custom'];
    if (validPlatforms.includes(obj.platform as Platform)) {
      config.platform = obj.platform as Platform;
    }

    if (obj.simulation && typeof obj.simulation === 'object') {
      config.simulation = this.validateSimulation(obj.simulation as Record<string, unknown>);
    }
    if (obj.producer && typeof obj.producer === 'object') {
      config.producer = this.validateProducer(obj.producer as Record<string, unknown>);
    }
    if (obj.client && typeof obj.client === 'object') {
      config.client = this.validateClient(obj.client as Record<string, unknown>);
    }
    if (obj.broker && typeof obj.broker === 'object') {
      config.broker = this.validateBroker(obj.broker as Record<string, unknown>);
    }
    if (obj.service && typeof obj.service === 'object') {
      config.service = this.validateService(obj.service as Record<string, unknown>);
    }

    return config;
  }

  private validateSimulation(obj: Record<string, unknown>): SimulationParams {
    return {
      duration: this.num(obj.duration, DEFAULT_CONFIG.simulation.duration),
      tick_interval: this.num(obj.tick_interval, DEFAULT_CONFIG.simulation.tick_interval),
    };
  }

  private validateProducer(obj: Record<string, unknown>): ProducerConfig {
    const d = DEFAULT_CONFIG.producer;
    return {
      traffic: (obj.traffic && typeof obj.traffic === 'object')
        ? this.validateTraffic(obj.traffic as Record<string, unknown>)
        : d.traffic,
    };
  }

  private validateClient(obj: Record<string, unknown>): ClientConfig {
    const d = DEFAULT_CONFIG.client;
    return {
      max_retries: this.num(obj.max_retries, d.max_retries),
    };
  }

  private validateBroker(obj: Record<string, unknown>): BrokerConfig {
    const d = DEFAULT_CONFIG.broker;
    return {
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : d.enabled,
      max_size: this.num(obj.max_size, d.max_size),
      request_timeout_ms: this.num(obj.request_timeout_ms, d.request_timeout_ms),
    };
  }

  private validateService(obj: Record<string, unknown>): ServiceConfig {
    const d = DEFAULT_CONFIG.service;
    const events: FailureEvent[] = [];
    if (Array.isArray(obj.failure_events)) {
      for (const item of obj.failure_events) {
        if (item && typeof item === 'object') {
          const e = item as Record<string, unknown>;
          events.push({
            time: this.num(e.time, 0),
            count: this.num(e.count, 1),
          });
        }
      }
    }
    return {
      // Basic scaling
      min_replicas: this.num(obj.min_replicas, d.min_replicas),
      max_replicas: this.num(obj.max_replicas, d.max_replicas),
      scale_up_threshold: this.num(obj.scale_up_threshold, d.scale_up_threshold),
      scale_down_threshold: this.num(obj.scale_down_threshold, d.scale_down_threshold),
      capacity_per_replica: this.num(obj.capacity_per_replica, d.capacity_per_replica),
      startup_time: this.num(obj.startup_time, d.startup_time),
      scale_up_step: this.num(obj.scale_up_step, d.scale_up_step),
      scale_down_step: this.num(obj.scale_down_step, d.scale_down_step),
      // Advanced
      metric_observation_delay: this.num(obj.metric_observation_delay, d.metric_observation_delay),
      cooldown_scale_up: this.num(obj.cooldown_scale_up, d.cooldown_scale_up),
      cooldown_scale_down: this.num(obj.cooldown_scale_down, d.cooldown_scale_down),
      node_provisioning_time: this.num(obj.node_provisioning_time, d.node_provisioning_time),
      cluster_node_capacity: this.num(obj.cluster_node_capacity, d.cluster_node_capacity),
      pods_per_node: this.num(obj.pods_per_node, d.pods_per_node),
      graceful_shutdown_time: this.num(obj.graceful_shutdown_time, d.graceful_shutdown_time),
      cost_per_replica_hour: this.num(obj.cost_per_replica_hour, d.cost_per_replica_hour),
      // Saturation
      saturation_threshold: this.num(obj.saturation_threshold, d.saturation_threshold),
      max_capacity_reduction: this.num(obj.max_capacity_reduction, d.max_capacity_reduction),
      // Chaos
      pod_failure_rate: this.num(obj.pod_failure_rate, d.pod_failure_rate),
      random_seed: this.num(obj.random_seed, d.random_seed),
      failure_events: events,
    };
  }

  private validateTraffic(obj: Record<string, unknown>): TrafficConfig {
    const validPatterns: TrafficPatternType[] = ['steady', 'gradual', 'spike', 'wave', 'step', 'custom'];
    const pattern = validPatterns.includes(obj.pattern as TrafficPatternType)
      ? obj.pattern as TrafficPatternType
      : DEFAULT_CONFIG.producer.traffic.pattern;

    return {
      pattern,
      params: (obj.params && typeof obj.params === 'object') ? obj.params as TrafficConfig['params'] : DEFAULT_CONFIG.producer.traffic.params,
    };
  }

  private num(val: unknown, fallback: number): number {
    return typeof val === 'number' && !isNaN(val) ? val : fallback;
  }

  // --- Simple YAML serializer (no external dependencies) ---

  private toYAML(config: SimulationConfig): string {
    const lines: string[] = [
      '# scalings.xyz simulator config v2',
      `version: ${config.version}`,
      `name: "${this.escapeYAMLString(config.name)}"`,
    ];

    if (config.description) {
      lines.push(`description: "${this.escapeYAMLString(config.description)}"`);
    }

    lines.push(`platform: ${config.platform}`);
    lines.push('');
    lines.push('simulation:');
    lines.push(`  duration: ${config.simulation.duration}`);
    lines.push(`  tick_interval: ${config.simulation.tick_interval}`);
    lines.push('');
    lines.push('producer:');
    lines.push('  traffic:');
    lines.push(`    pattern: ${config.producer.traffic.pattern}`);
    lines.push('    params:');
    this.serializeTrafficParams(config.producer.traffic, lines);
    lines.push('');
    lines.push('client:');
    lines.push(`  max_retries: ${config.client.max_retries}`);
    lines.push('');
    lines.push('broker:');
    lines.push(`  enabled: ${config.broker.enabled}`);
    lines.push(`  max_size: ${config.broker.max_size}`);
    lines.push(`  request_timeout_ms: ${config.broker.request_timeout_ms}`);
    lines.push('');
    lines.push('service:');
    lines.push(`  min_replicas: ${config.service.min_replicas}`);
    lines.push(`  max_replicas: ${config.service.max_replicas}`);
    lines.push(`  scale_up_threshold: ${config.service.scale_up_threshold}`);
    lines.push(`  scale_down_threshold: ${config.service.scale_down_threshold}`);
    lines.push(`  capacity_per_replica: ${config.service.capacity_per_replica}`);
    lines.push(`  startup_time: ${config.service.startup_time}`);
    lines.push(`  scale_up_step: ${config.service.scale_up_step}`);
    lines.push(`  scale_down_step: ${config.service.scale_down_step}`);
    lines.push(`  metric_observation_delay: ${config.service.metric_observation_delay}`);
    lines.push(`  cooldown_scale_up: ${config.service.cooldown_scale_up}`);
    lines.push(`  cooldown_scale_down: ${config.service.cooldown_scale_down}`);
    lines.push(`  node_provisioning_time: ${config.service.node_provisioning_time}`);
    lines.push(`  cluster_node_capacity: ${config.service.cluster_node_capacity}`);
    lines.push(`  pods_per_node: ${config.service.pods_per_node}`);
    lines.push(`  graceful_shutdown_time: ${config.service.graceful_shutdown_time}`);
    lines.push(`  cost_per_replica_hour: ${config.service.cost_per_replica_hour}`);
    lines.push(`  saturation_threshold: ${config.service.saturation_threshold}`);
    lines.push(`  max_capacity_reduction: ${config.service.max_capacity_reduction}`);
    lines.push(`  pod_failure_rate: ${config.service.pod_failure_rate}`);
    lines.push(`  random_seed: ${config.service.random_seed}`);
    if (config.service.failure_events.length > 0) {
      lines.push('  failure_events:');
      for (const evt of config.service.failure_events) {
        lines.push(`    - { time: ${evt.time}, count: ${evt.count} }`);
      }
    } else {
      lines.push('  failure_events: []');
    }

    return lines.join('\n') + '\n';
  }

  private serializeTrafficParams(traffic: TrafficConfig, lines: string[]): void {
    const params = traffic.params;
    switch (traffic.pattern) {
      case 'steady': {
        const p = params as SteadyParams;
        lines.push(`      rps: ${p.rps}`);
        break;
      }
      case 'gradual': {
        const p = params as GradualParams;
        lines.push(`      start_rps: ${p.start_rps}`);
        lines.push(`      end_rps: ${p.end_rps}`);
        break;
      }
      case 'spike': {
        const p = params as SpikeParams;
        lines.push(`      base_rps: ${p.base_rps}`);
        lines.push(`      spike_rps: ${p.spike_rps}`);
        lines.push(`      spike_start: ${p.spike_start}`);
        lines.push(`      spike_duration: ${p.spike_duration}`);
        break;
      }
      case 'wave': {
        const p = params as WaveParams;
        lines.push(`      base_rps: ${p.base_rps}`);
        lines.push(`      amplitude: ${p.amplitude}`);
        lines.push(`      period: ${p.period}`);
        break;
      }
      case 'step': {
        const p = params as StepParams;
        lines.push('      steps:');
        for (const step of p.steps) {
          lines.push(`        - rps: ${step.rps}`);
          lines.push(`          duration: ${step.duration}`);
        }
        break;
      }
      case 'custom': {
        const p = params as CustomParams;
        lines.push('      series:');
        for (const point of p.series) {
          lines.push(`        - { t: ${point.t}, rps: ${point.rps} }`);
        }
        break;
      }
    }
  }

  // --- Simple YAML parser (handles our specific schema) ---

  private fromYAML(yaml: string): SimulationConfig {
    const obj = this.parseYAML(yaml);
    return this.validateConfig(obj);
  }

  private parseYAML(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    const stack: { obj: Record<string, unknown>; indent: number }[] = [{ obj: result, indent: -1 }];
    let currentArray: unknown[] | null = null;
    let currentArrayKey = '';
    let currentArrayIndent = 0;

    for (const rawLine of lines) {
      // Skip comments and blank lines
      const trimmed = rawLine.replace(/#.*$/, '').trimEnd();
      if (!trimmed || trimmed.trim() === '') continue;

      const indent = rawLine.search(/\S/);
      const content = trimmed.trim();

      // Handle array items
      if (content.startsWith('- ')) {
        if (currentArray !== null) {
          const item = content.substring(2).trim();
          // Handle inline object: { t: 0, rps: 100 }
          if (item.startsWith('{') && item.endsWith('}')) {
            const inner = item.slice(1, -1);
            const obj: Record<string, unknown> = {};
            for (const pair of inner.split(',')) {
              const [k, v] = pair.split(':').map(s => s.trim());
              if (k && v !== undefined) {
                obj[k] = this.parseValue(v);
              }
            }
            currentArray.push(obj);
          } else {
            // Handle key: value on same line as dash
            const colonIdx = item.indexOf(':');
            if (colonIdx > 0) {
              const obj: Record<string, unknown> = {};
              obj[item.substring(0, colonIdx).trim()] = this.parseValue(item.substring(colonIdx + 1).trim());
              currentArray.push(obj);
              // Might have more keys on following indented lines
              const lastItem = currentArray[currentArray.length - 1] as Record<string, unknown>;
              stack.push({ obj: lastItem, indent: indent });
            } else {
              currentArray.push(this.parseValue(item));
            }
          }
          continue;
        }
      }

      // Handle regular key: value
      const colonIdx = content.indexOf(':');
      if (colonIdx <= 0) continue;

      const key = content.substring(0, colonIdx).trim();
      const value = content.substring(colonIdx + 1).trim();

      // Pop stack to find parent
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;

      if (value === '' || value === undefined) {
        // Nested object or array
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ obj: child, indent: indent });
        currentArray = null;
        currentArrayKey = key;
      } else {
        const parsedValue = this.parseValue(value);
        parent[key] = parsedValue;

        // Check if this starts an array context
        if (key === 'steps' || key === 'series' || key === 'failure_events') {
          const arr: unknown[] = [];
          parent[key] = arr;
          currentArray = arr;
          currentArrayKey = key;
          currentArrayIndent = indent;
        } else {
          if (currentArray !== null && indent <= currentArrayIndent) {
            currentArray = null;
          }
        }
      }

      // Handle array-valued keys
      if ((key === 'steps' || key === 'series' || key === 'failure_events') && value === '') {
        const arr: unknown[] = [];
        parent[key] = arr;
        currentArray = arr;
        currentArrayKey = key;
        currentArrayIndent = indent;
      }
    }

    return result;
  }

  private parseValue(str: string): string | number | boolean {
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'null') return 0;

    // Remove surrounding quotes
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      return str.slice(1, -1);
    }

    const num = Number(str);
    if (!isNaN(num) && str !== '') return num;

    return str;
  }

  private escapeYAMLString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
