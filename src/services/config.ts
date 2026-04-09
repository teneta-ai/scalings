// ============================================================================
// scalings.xyz — Config Service (Import/Export/URL/localStorage)
// ============================================================================

import {
  ConfigService,
  SimulationConfig,
  DEFAULT_CONFIG,
  Platform,
  TrafficPatternType,
  ScalingParams,
  AdvancedParams,
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
    if (obj.scaling && typeof obj.scaling === 'object') {
      config.scaling = this.validateScaling(obj.scaling as Record<string, unknown>);
    }
    if (obj.advanced && typeof obj.advanced === 'object') {
      config.advanced = this.validateAdvanced(obj.advanced as Record<string, unknown>);
    }
    if (obj.traffic && typeof obj.traffic === 'object') {
      config.traffic = this.validateTraffic(obj.traffic as Record<string, unknown>);
    }

    return config;
  }

  private validateSimulation(obj: Record<string, unknown>): SimulationParams {
    return {
      duration: this.num(obj.duration, DEFAULT_CONFIG.simulation.duration),
      tick_interval: this.num(obj.tick_interval, DEFAULT_CONFIG.simulation.tick_interval),
    };
  }

  private validateScaling(obj: Record<string, unknown>): ScalingParams {
    const d = DEFAULT_CONFIG.scaling;
    return {
      min_replicas: this.num(obj.min_replicas, d.min_replicas),
      max_replicas: this.num(obj.max_replicas, d.max_replicas),
      scale_up_threshold: this.num(obj.scale_up_threshold, d.scale_up_threshold),
      scale_down_threshold: this.num(obj.scale_down_threshold, d.scale_down_threshold),
      capacity_per_replica: this.num(obj.capacity_per_replica, d.capacity_per_replica),
      startup_time: this.num(obj.startup_time, d.startup_time),
      scale_up_step: this.num(obj.scale_up_step, d.scale_up_step),
      scale_down_step: this.num(obj.scale_down_step, d.scale_down_step),
    };
  }

  private validateAdvanced(obj: Record<string, unknown>): AdvancedParams {
    const d = DEFAULT_CONFIG.advanced;
    return {
      metric_observation_delay: this.num(obj.metric_observation_delay, d.metric_observation_delay),
      cooldown_scale_up: this.num(obj.cooldown_scale_up, d.cooldown_scale_up),
      cooldown_scale_down: this.num(obj.cooldown_scale_down, d.cooldown_scale_down),
      node_provisioning_time: this.num(obj.node_provisioning_time, d.node_provisioning_time),
      cluster_node_capacity: this.num(obj.cluster_node_capacity, d.cluster_node_capacity),
      pod_failure_rate: this.num(obj.pod_failure_rate, d.pod_failure_rate),
      graceful_shutdown_time: this.num(obj.graceful_shutdown_time, d.graceful_shutdown_time),
      cost_per_replica_hour: this.num(obj.cost_per_replica_hour, d.cost_per_replica_hour),
    };
  }

  private validateTraffic(obj: Record<string, unknown>): TrafficConfig {
    const validPatterns: TrafficPatternType[] = ['steady', 'gradual', 'spike', 'wave', 'step', 'custom'];
    const pattern = validPatterns.includes(obj.pattern as TrafficPatternType)
      ? obj.pattern as TrafficPatternType
      : DEFAULT_CONFIG.traffic.pattern;

    return {
      pattern,
      params: (obj.params && typeof obj.params === 'object') ? obj.params as TrafficConfig['params'] : DEFAULT_CONFIG.traffic.params,
    };
  }

  private num(val: unknown, fallback: number): number {
    return typeof val === 'number' && !isNaN(val) ? val : fallback;
  }

  // --- Simple YAML serializer (no external dependencies) ---

  private toYAML(config: SimulationConfig): string {
    const lines: string[] = [
      '# scalings.xyz simulator config v1',
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
    lines.push('scaling:');
    lines.push(`  min_replicas: ${config.scaling.min_replicas}`);
    lines.push(`  max_replicas: ${config.scaling.max_replicas}`);
    lines.push(`  scale_up_threshold: ${config.scaling.scale_up_threshold}`);
    lines.push(`  scale_down_threshold: ${config.scaling.scale_down_threshold}`);
    lines.push(`  capacity_per_replica: ${config.scaling.capacity_per_replica}`);
    lines.push(`  startup_time: ${config.scaling.startup_time}`);
    lines.push(`  scale_up_step: ${config.scaling.scale_up_step}`);
    lines.push(`  scale_down_step: ${config.scaling.scale_down_step}`);
    lines.push('');
    lines.push('advanced:');
    lines.push(`  metric_observation_delay: ${config.advanced.metric_observation_delay}`);
    lines.push(`  cooldown_scale_up: ${config.advanced.cooldown_scale_up}`);
    lines.push(`  cooldown_scale_down: ${config.advanced.cooldown_scale_down}`);
    lines.push(`  node_provisioning_time: ${config.advanced.node_provisioning_time}`);
    lines.push(`  cluster_node_capacity: ${config.advanced.cluster_node_capacity}`);
    lines.push(`  pod_failure_rate: ${config.advanced.pod_failure_rate}`);
    lines.push(`  graceful_shutdown_time: ${config.advanced.graceful_shutdown_time}`);
    lines.push(`  cost_per_replica_hour: ${config.advanced.cost_per_replica_hour}`);
    lines.push('');
    lines.push('traffic:');
    lines.push(`  pattern: ${config.traffic.pattern}`);
    lines.push('  params:');

    this.serializeTrafficParams(config.traffic, lines);

    return lines.join('\n') + '\n';
  }

  private serializeTrafficParams(traffic: TrafficConfig, lines: string[]): void {
    const params = traffic.params;
    switch (traffic.pattern) {
      case 'steady': {
        const p = params as SteadyParams;
        lines.push(`    rps: ${p.rps}`);
        break;
      }
      case 'gradual': {
        const p = params as GradualParams;
        lines.push(`    start_rps: ${p.start_rps}`);
        lines.push(`    end_rps: ${p.end_rps}`);
        lines.push(`    duration: ${p.duration}`);
        break;
      }
      case 'spike': {
        const p = params as SpikeParams;
        lines.push(`    base_rps: ${p.base_rps}`);
        lines.push(`    spike_rps: ${p.spike_rps}`);
        lines.push(`    spike_start: ${p.spike_start}`);
        lines.push(`    spike_duration: ${p.spike_duration}`);
        break;
      }
      case 'wave': {
        const p = params as WaveParams;
        lines.push(`    base_rps: ${p.base_rps}`);
        lines.push(`    amplitude: ${p.amplitude}`);
        lines.push(`    period: ${p.period}`);
        break;
      }
      case 'step': {
        const p = params as StepParams;
        lines.push('    steps:');
        for (const step of p.steps) {
          lines.push(`      - rps: ${step.rps}`);
          lines.push(`        duration: ${step.duration}`);
        }
        break;
      }
      case 'custom': {
        const p = params as CustomParams;
        lines.push('    series:');
        for (const point of p.series) {
          lines.push(`      - { t: ${point.t}, rps: ${point.rps} }`);
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
        if (key === 'steps' || key === 'series') {
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
      if ((key === 'steps' || key === 'series') && value === '') {
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
