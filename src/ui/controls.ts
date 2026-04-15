// ============================================================================
// scalings.xyz — UI Controls (Form State, Input Bindings)
// ============================================================================

import {
  SimulationConfig,
  Platform,
  TrafficPatternType,
  TrafficConfig,
  ProducerConfig,
  ClientConfig,
  BrokerConfig,
  ServiceConfig,
  GradualParams,
  SpikeParams,
  WaveParams,
  StepParams,
  CustomParams,
  CustomTimePoint,
  GrafanaParams,
  StepEntry,
  FailureEvent,
  RetryStrategy,
  DEFAULT_CONFIG,
  PRESET_SCENARIOS,
} from '../interfaces/types.js';
import { TrafficPatternService } from '../interfaces/types.js';
import { parseGrafanaCSV, detectCsvValueUnit } from '../services/traffic.js';
import { TrafficPreviewRenderer } from './chart.js';

type ChangeCallback = () => void;

export class UIControls {
  private trafficService: TrafficPatternService;
  private previewRenderer: TrafficPreviewRenderer;
  private onChangeCallbacks: ChangeCallback[] = [];
  private currentPattern: TrafficPatternType = 'spike';
  private pendingCsvText: string | null = null;

  constructor(trafficService: TrafficPatternService) {
    this.trafficService = trafficService;
    this.previewRenderer = new TrafficPreviewRenderer();
  }

  init(): void {
    this.bindSliders();
    this.bindPatternSelector();
    this.bindAdvancedToggle();
    this.bindChaosToggle();
    this.bindPresets();
    this.bindPlatformSelector();
    this.bindStepControls();
    this.bindFailureEventControls();
    this.bindBrokerToggle();
    this.bindRetryDelayTooltip();
    this.bindCsvImport();
    this.addRangeHints();
    this.showPatternParams(this.currentPattern);
    this.updatePreview();
  }

  onChange(cb: ChangeCallback): void {
    this.onChangeCallbacks.push(cb);
  }

  private notifyChange(): void {
    for (const cb of this.onChangeCallbacks) cb();
  }

  // --- Read form state into config ---

  getConfig(): SimulationConfig {
    const config: SimulationConfig = {
      version: 2,
      name: this.getInputValue('sim-name') || 'Untitled Simulation',
      platform: this.getSelectValue('platform-select') as Platform,
      simulation: {
        duration: this.getNumericValue('sim-duration', DEFAULT_CONFIG.simulation.duration),
        tick_interval: this.getNumericValue('sim-tick', DEFAULT_CONFIG.simulation.tick_interval),
      },
      producer: this.getProducerConfig(),
      client: this.getClientConfig(),
      broker: this.getBrokerConfig(),
      service: this.getServiceConfig(),
    };

    return config;
  }

  // --- Write config to form ---

  setConfig(config: SimulationConfig): void {
    this.setInputValue('sim-name', config.name);
    this.setSelectValue('platform-select', config.platform);

    // Simulation params
    this.setNumericValue('sim-duration', config.simulation.duration);
    this.setNumericValue('sim-tick', config.simulation.tick_interval);

    // Producer
    this.setProducerConfig(config.producer);

    // Client
    this.setClientConfig(config.client);

    // Broker
    this.setBrokerConfig(config.broker);

    // Service
    this.setServiceConfig(config.service);

    this.updatePreview();
  }

  // --- Producer config helpers ---

  private getProducerConfig(): ProducerConfig {
    return {
      traffic: this.getTrafficConfig(),
    };
  }

  private setProducerConfig(producer: ProducerConfig): void {
    this.setTrafficConfig(producer.traffic);
  }

  // --- Client config helpers ---

  private getClientConfig(): ClientConfig {
    const strategySelect = document.getElementById('param-retry_strategy') as HTMLSelectElement;
    return {
      max_retries: this.getNumericValue('param-max_retries', DEFAULT_CONFIG.client.max_retries),
      retry_delay: this.getNumericValue('param-retry_delay', DEFAULT_CONFIG.client.retry_delay),
      retry_strategy: (strategySelect?.value as RetryStrategy) || DEFAULT_CONFIG.client.retry_strategy,
    };
  }

  private setClientConfig(client: ClientConfig): void {
    this.setNumericValue('param-max_retries', client.max_retries);
    this.setNumericValue('param-retry_delay', client.retry_delay);
    const strategySelect = document.getElementById('param-retry_strategy') as HTMLSelectElement;
    if (strategySelect) strategySelect.value = client.retry_strategy || 'fixed';
  }

  // --- Broker config helpers ---

  private getBrokerConfig(): BrokerConfig {
    const toggle = document.getElementById('broker-enabled') as HTMLInputElement;
    return {
      enabled: toggle ? toggle.checked : false,
      max_size: this.getNumericValue('param-broker_max_size', DEFAULT_CONFIG.broker.max_size),
      request_timeout_ms: this.getNumericValue('param-request_timeout_ms', DEFAULT_CONFIG.broker.request_timeout_ms),
    };
  }

  private setBrokerConfig(broker: BrokerConfig): void {
    const toggle = document.getElementById('broker-enabled') as HTMLInputElement;
    const params = document.getElementById('broker-params');
    if (toggle) {
      toggle.checked = broker.enabled;
      if (params) params.classList.toggle('hidden', !broker.enabled);
    }
    this.setNumericValue('param-broker_max_size', broker.max_size);
    this.setNumericValue('param-request_timeout_ms', broker.request_timeout_ms);
    const maxSizeInput = document.getElementById('param-broker_max_size') as HTMLInputElement;
    if (maxSizeInput) this.updateBrokerSizeUI(maxSizeInput);
  }

  // --- Service config helpers ---

  private getServiceConfig(): ServiceConfig {
    return {
      // Basic scaling
      min_replicas: this.getNumericValue('param-min_replicas', DEFAULT_CONFIG.service.min_replicas),
      max_replicas: this.getNumericValue('param-max_replicas', DEFAULT_CONFIG.service.max_replicas),
      scale_up_threshold: this.getNumericValue('param-scale_up_threshold', DEFAULT_CONFIG.service.scale_up_threshold),
      scale_down_threshold: this.getNumericValue('param-scale_down_threshold', DEFAULT_CONFIG.service.scale_down_threshold),
      capacity_per_replica: this.getNumericValue('param-capacity_per_replica', DEFAULT_CONFIG.service.capacity_per_replica),
      startup_time: this.getNumericValue('param-startup_time', DEFAULT_CONFIG.service.startup_time),
      scale_up_step: this.getNumericValue('param-scale_up_step', DEFAULT_CONFIG.service.scale_up_step),
      scale_down_step: this.getNumericValue('param-scale_down_step', DEFAULT_CONFIG.service.scale_down_step),
      // Advanced
      metric_observation_delay: this.getNumericValue('param-metric_observation_delay', DEFAULT_CONFIG.service.metric_observation_delay),
      cooldown_scale_up: this.getNumericValue('param-cooldown_scale_up', DEFAULT_CONFIG.service.cooldown_scale_up),
      cooldown_scale_down: this.getNumericValue('param-cooldown_scale_down', DEFAULT_CONFIG.service.cooldown_scale_down),
      node_provisioning_time: this.getNumericValue('param-node_provisioning_time', DEFAULT_CONFIG.service.node_provisioning_time),
      cluster_node_capacity: this.getNumericValue('param-cluster_node_capacity', DEFAULT_CONFIG.service.cluster_node_capacity),
      pods_per_node: this.getNumericValue('param-pods_per_node', DEFAULT_CONFIG.service.pods_per_node),
      graceful_shutdown_time: this.getNumericValue('param-graceful_shutdown_time', DEFAULT_CONFIG.service.graceful_shutdown_time),
      cost_per_replica_hour: this.getNumericValue('param-cost_per_replica_hour', DEFAULT_CONFIG.service.cost_per_replica_hour),
      // Saturation
      saturation_threshold: this.getNumericValue('param-saturation_threshold', DEFAULT_CONFIG.service.saturation_threshold),
      max_capacity_reduction: this.getNumericValue('param-max_capacity_reduction', DEFAULT_CONFIG.service.max_capacity_reduction),
      // Chaos
      pod_failure_rate: this.getNumericValue('param-pod_failure_rate', DEFAULT_CONFIG.service.pod_failure_rate),
      random_seed: this.getNumericValue('param-random_seed', DEFAULT_CONFIG.service.random_seed),
      failure_events: this.getFailureEvents(),
    };
  }

  private setServiceConfig(service: ServiceConfig): void {
    // Basic scaling
    this.setNumericValue('param-min_replicas', service.min_replicas);
    this.setNumericValue('param-max_replicas', service.max_replicas);
    this.setNumericValue('param-scale_up_threshold', service.scale_up_threshold);
    this.setNumericValue('param-scale_down_threshold', service.scale_down_threshold);
    this.setNumericValue('param-capacity_per_replica', service.capacity_per_replica);
    this.setNumericValue('param-startup_time', service.startup_time);
    this.setNumericValue('param-scale_up_step', service.scale_up_step);
    this.setNumericValue('param-scale_down_step', service.scale_down_step);
    // Advanced
    this.setNumericValue('param-metric_observation_delay', service.metric_observation_delay);
    this.setNumericValue('param-cooldown_scale_up', service.cooldown_scale_up);
    this.setNumericValue('param-cooldown_scale_down', service.cooldown_scale_down);
    this.setNumericValue('param-node_provisioning_time', service.node_provisioning_time);
    this.setNumericValue('param-cluster_node_capacity', service.cluster_node_capacity);
    this.setNumericValue('param-pods_per_node', service.pods_per_node);
    this.setNumericValue('param-graceful_shutdown_time', service.graceful_shutdown_time);
    this.setNumericValue('param-cost_per_replica_hour', service.cost_per_replica_hour);
    // Saturation
    this.setNumericValue('param-saturation_threshold', service.saturation_threshold);
    this.setNumericValue('param-max_capacity_reduction', service.max_capacity_reduction);
    // Chaos
    this.setNumericValue('param-pod_failure_rate', service.pod_failure_rate);
    this.setNumericValue('param-random_seed', service.random_seed);
    this.setFailureEvents(service.failure_events);
  }

  // --- Traffic config helpers ---

  private getTrafficConfig(): TrafficConfig {
    const pattern = this.currentPattern;
    let params: TrafficConfig['params'];

    switch (pattern) {
      case 'gradual':
        params = {
          start_rps: this.getNumericValue('traffic-gradual-start_rps', 50),
          end_rps: this.getNumericValue('traffic-gradual-end_rps', 800),
        } as GradualParams;
        break;
      case 'spike':
        params = {
          base_rps: this.getNumericValue('traffic-spike-base_rps', 200),
          spike_rps: this.getNumericValue('traffic-spike-spike_rps', 2000),
          spike_start: this.getNumericValue('traffic-spike-spike_start', 120),
          spike_duration: this.getNumericValue('traffic-spike-spike_duration', 60),
        } as SpikeParams;
        break;
      case 'wave':
        params = {
          base_rps: this.getNumericValue('traffic-wave-base_rps', 300),
          amplitude: this.getNumericValue('traffic-wave-amplitude', 200),
          period: this.getNumericValue('traffic-wave-period', 120),
        } as WaveParams;
        break;
      case 'step':
        params = { steps: this.getStepEntries() } as StepParams;
        break;
      case 'custom':
        params = { series: this.getCustomSeries() } as CustomParams;
        break;
      case 'grafana':
        params = this.getGrafanaParams();
        break;
      default:
        params = DEFAULT_CONFIG.producer.traffic.params;
    }

    return { pattern, params };
  }

  private setTrafficConfig(traffic: TrafficConfig): void {
    this.currentPattern = traffic.pattern;

    // Set radio button
    const radio = document.querySelector(`input[name="traffic-pattern"][value="${traffic.pattern}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;

    this.showPatternParams(traffic.pattern);

    switch (traffic.pattern) {
      case 'gradual': {
        const p = traffic.params as GradualParams;
        this.setNumericValue('traffic-gradual-start_rps', p.start_rps);
        this.setNumericValue('traffic-gradual-end_rps', p.end_rps);
        break;
      }
      case 'spike': {
        const p = traffic.params as SpikeParams;
        this.setNumericValue('traffic-spike-base_rps', p.base_rps);
        this.setNumericValue('traffic-spike-spike_rps', p.spike_rps);
        this.setNumericValue('traffic-spike-spike_start', p.spike_start);
        this.setNumericValue('traffic-spike-spike_duration', p.spike_duration);
        break;
      }
      case 'wave': {
        const p = traffic.params as WaveParams;
        this.setNumericValue('traffic-wave-base_rps', p.base_rps);
        this.setNumericValue('traffic-wave-amplitude', p.amplitude);
        this.setNumericValue('traffic-wave-period', p.period);
        break;
      }
      case 'step': {
        const p = traffic.params as StepParams;
        this.setStepEntries(p.steps);
        break;
      }
      case 'custom': {
        const p = traffic.params as CustomParams;
        const textarea = document.getElementById('traffic-custom-series') as HTMLTextAreaElement;
        if (textarea) textarea.value = JSON.stringify(p.series, null, 2);
        break;
      }
      case 'grafana': {
        const p = traffic.params as GrafanaParams;
        const csvTextarea = document.getElementById('grafana-csv-input') as HTMLTextAreaElement;
        if (csvTextarea && p.raw_csv) csvTextarea.value = p.raw_csv;
        this.setCsvValueUnit(p.value_unit || 'rps');
        this.pendingCsvText = p.raw_csv || null;
        break;
      }
    }
  }

  private getStepEntries(): StepEntry[] {
    const container = document.getElementById('steps-container');
    if (!container) return [{ rps: 100, duration: 120 }];

    const entries: StepEntry[] = [];
    const rows = container.querySelectorAll('.step-row');
    rows.forEach(row => {
      const rpsInput = row.querySelector('.step-rps') as HTMLInputElement;
      const durInput = row.querySelector('.step-duration') as HTMLInputElement;
      if (rpsInput && durInput) {
        entries.push({
          rps: parseFloat(rpsInput.value) || 100,
          duration: parseFloat(durInput.value) || 120,
        });
      }
    });

    return entries.length > 0 ? entries : [{ rps: 100, duration: 120 }];
  }

  private setStepEntries(steps: StepEntry[]): void {
    const container = document.getElementById('steps-container');
    if (!container) return;

    container.innerHTML = '';
    for (const step of steps) {
      this.addStepRow(step.rps, step.duration);
    }
  }

  private getCustomSeries(): { t: number; rps: number }[] {
    const textarea = document.getElementById('traffic-custom-series') as HTMLTextAreaElement;
    if (!textarea) return [{ t: 0, rps: 100 }];

    try {
      const parsed = JSON.parse(textarea.value.trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Invalid JSON
    }
    return [{ t: 0, rps: 100 }, { t: 300, rps: 500 }, { t: 600, rps: 100 }];
  }

  private getGrafanaParams(): GrafanaParams {
    const csvText = this.pendingCsvText || '';
    const unit = this.getCsvValueUnit();
    let series: CustomTimePoint[] = [];
    if (csvText) {
      try {
        series = parseGrafanaCSV(csvText, unit);
      } catch {
        // Invalid CSV — empty series
      }
    }
    return { series, raw_csv: csvText, value_unit: unit };
  }

  // --- DOM bindings ---

  private bindSliders(): void {
    // Bind all number inputs in param rows
    const numberInputs = document.querySelectorAll('.param-row input[type="number"]');
    numberInputs.forEach(input => {
      input.addEventListener('input', () => {
        this.notifyChange();
        this.updatePreview();
      });
      input.addEventListener('change', () => {
        const el = input as HTMLInputElement;
        const min = parseFloat(el.min);
        const max = parseFloat(el.max);
        let val = parseFloat(el.value);
        if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
          const clamped = Math.max(min, Math.min(max, val));
          if (clamped !== val) {
            this.showValidationHint(el, val, min, max);
            el.value = clamped.toString();
          }
        }
        this.notifyChange();
        this.updatePreview();
      });
    });

    // Bind select elements in param rows (e.g., retry strategy)
    const paramSelects = document.querySelectorAll('.param-row select');
    paramSelects.forEach(select => {
      select.addEventListener('change', () => {
        this.notifyChange();
      });
    });

    // Also bind standalone number inputs (sim duration, tick interval)
    ['sim-duration', 'sim-tick'].forEach(id => {
      const input = document.getElementById(id) as HTMLInputElement;
      if (input) {
        input.addEventListener('change', () => {
          this.notifyChange();
          this.updatePreview();
        });
      }
    });
  }

  private showValidationHint(el: HTMLInputElement, attempted: number, min: number, max: number): void {
    const row = el.closest('.param-row');
    if (!row) return;

    // Remove any existing hint in this row
    const existing = row.querySelector('.validation-hint');
    if (existing) existing.remove();

    const direction = attempted < min ? 'min' : 'max';
    const limit = direction === 'min' ? min : max;
    const hint = document.createElement('span');
    hint.className = 'validation-hint';
    hint.textContent = `Clamped to ${direction} (${limit})`;
    row.appendChild(hint);

    el.classList.add('input-clamped');
    requestAnimationFrame(() => hint.classList.add('visible'));

    setTimeout(() => {
      hint.classList.remove('visible');
      el.classList.remove('input-clamped');
      setTimeout(() => hint.remove(), 200);
    }, 2000);
  }

  private addRangeHints(): void {
    const numberInputs = document.querySelectorAll('.param-row input[type="number"]');
    numberInputs.forEach(input => {
      const el = input as HTMLInputElement;
      const min = el.min;
      const max = el.max;
      if (min && max) {
        const existing = el.title ? el.title + ' ' : '';
        el.title = `${existing}(${min}–${max})`;
      }
    });
  }

  private bindPatternSelector(): void {
    const radios = document.querySelectorAll('input[name="traffic-pattern"]');
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        this.currentPattern = target.value as TrafficPatternType;
        // Clear raw CSV when leaving grafana pattern — no longer needed
        if (this.currentPattern !== 'grafana') {
          this.pendingCsvText = null;
        }
        this.showPatternParams(this.currentPattern);
        this.notifyChange();
        this.updatePreview();
      });
    });

    // Bind traffic parameter inputs
    const trafficInputs = document.querySelectorAll('[id^="traffic-"] input, [id^="traffic-"] textarea');
    trafficInputs.forEach(input => {
      input.addEventListener('input', () => {
        this.notifyChange();
        this.updatePreview();
      });
    });
  }

  private bindAdvancedToggle(): void {
    this.bindCollapsibleSection('advanced-toggle', 'advanced-content');
  }

  private bindPresets(): void {
    const container = document.getElementById('preset-buttons');
    if (!container) return;

    const buttons = container.querySelectorAll('button[data-preset]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const presetName = (btn as HTMLElement).dataset.preset;
        const preset = PRESET_SCENARIOS.find(p => p.name === presetName);
        if (preset && preset.config) {
          const fullConfig: SimulationConfig = {
            ...DEFAULT_CONFIG,
            ...preset.config,
            simulation: { ...DEFAULT_CONFIG.simulation, ...(preset.config.simulation || {}) },
            producer: { ...DEFAULT_CONFIG.producer, ...(preset.config.producer || {}) },
            client: { ...DEFAULT_CONFIG.client, ...(preset.config.client || {}) },
            broker: { ...DEFAULT_CONFIG.broker, ...(preset.config.broker || {}) },
            service: { ...DEFAULT_CONFIG.service, ...(preset.config.service || {}) },
          };
          this.setConfig(fullConfig);
          this.notifyChange();
        }
      });
    });

    const resetBtn = document.getElementById('btn-reset-defaults');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.setConfig(DEFAULT_CONFIG);
        this.notifyChange();
      });
    }
  }

  private bindPlatformSelector(): void {
    const select = document.getElementById('platform-select') as HTMLSelectElement;
    if (select) {
      select.addEventListener('change', () => {
        this.updatePlatformLabels(select.value as Platform);
        this.notifyChange();
      });
    }
  }

  private bindStepControls(): void {
    const addBtn = document.getElementById('add-step-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.addStepRow(100, 120);
        this.notifyChange();
        this.updatePreview();
      });
    }
  }

  private bindChaosToggle(): void {
    this.bindCollapsibleSection('chaos-toggle', 'chaos-content');
  }

  private bindCollapsibleSection(toggleId: string, contentId: string): void {
    const toggle = document.getElementById(toggleId);
    const content = document.getElementById(contentId);
    if (toggle && content) {
      toggle.addEventListener('click', () => {
        content.classList.toggle('collapsed');
        toggle.classList.toggle('expanded');
        const isExpanded = !content.classList.contains('collapsed');
        toggle.setAttribute('aria-expanded', String(isExpanded));
        const arrow = toggle.querySelector('.toggle-arrow');
        if (arrow) {
          arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
        }
      });
    }
  }

  private bindFailureEventControls(): void {
    const addBtn = document.getElementById('add-failure-event-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.addFailureEventRow(60, 1);
        this.notifyChange();
      });
    }
  }

  private bindBrokerToggle(): void {
    const toggle = document.getElementById('broker-enabled') as HTMLInputElement;
    const params = document.getElementById('broker-params');
    if (toggle && params) {
      toggle.addEventListener('change', () => {
        params.classList.toggle('hidden', !toggle.checked);
        this.notifyChange();
      });
    }

    const maxSizeInput = document.getElementById('param-broker_max_size') as HTMLInputElement;
    const unlimitedBtn = document.getElementById('broker-unlimited-btn');
    if (maxSizeInput) {
      maxSizeInput.addEventListener('input', () => {
        this.updateBrokerSizeUI(maxSizeInput);
        this.notifyChange();
      });
      this.updateBrokerSizeUI(maxSizeInput);
    }
    if (unlimitedBtn && maxSizeInput) {
      unlimitedBtn.addEventListener('click', () => {
        const isUnlimited = parseFloat(maxSizeInput.value) === 0;
        maxSizeInput.value = isUnlimited ? '1000' : '0';
        this.updateBrokerSizeUI(maxSizeInput);
        this.notifyChange();
      });
    }
  }

  private bindRetryDelayTooltip(): void {
    const delayInput = document.getElementById('param-retry_delay') as HTMLInputElement;
    const tickInput = document.getElementById('sim-tick') as HTMLInputElement;
    const tooltipBtn = delayInput?.parentElement?.querySelector('.tooltip-btn') as HTMLElement;
    if (!delayInput || !tickInput || !tooltipBtn) return;

    const update = () => {
      const delay = parseFloat(delayInput.value) || 0;
      const tickInterval = parseFloat(tickInput.value) || 1;
      const ticks = Math.max(1, Math.ceil(delay / tickInterval));
      const tickNote = delay === 0
        ? 'Currently: 1 tick (immediate).'
        : `Currently: ${ticks} tick${ticks > 1 ? 's' : ''} at ${tickInterval}s interval.`;
      tooltipBtn.dataset.tooltip = `Seconds between a request failing and the client retrying it. Models backoff behavior. 0 = retry on the very next tick (aggressive). Higher values spread retries over time, reducing the spike but prolonging the storm. ${tickNote}`;
    };

    delayInput.addEventListener('input', update);
    tickInput.addEventListener('input', update);
    update();
  }

  private getCsvValueUnit(): 'rps' | 'rpm' | 'rph' {
    const select = document.getElementById('csv-value-unit') as HTMLSelectElement;
    const val = select?.value;
    if (val === 'rpm' || val === 'rph') return val;
    return 'rps';
  }

  private setCsvValueUnit(unit: 'rps' | 'rpm' | 'rph'): void {
    const select = document.getElementById('csv-value-unit') as HTMLSelectElement;
    if (select) select.value = unit;
  }

  private bindCsvImport(): void {
    const importBtn = document.getElementById('btn-import-csv');
    const fileInput = document.getElementById('csv-file-input') as HTMLInputElement;
    const csvTextarea = document.getElementById('grafana-csv-input') as HTMLTextAreaElement;
    const unitSelect = document.getElementById('csv-value-unit') as HTMLSelectElement;

    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        if (!fileInput.files?.length) return;
        try {
          const text = await fileInput.files[0].text();
          if (csvTextarea) csvTextarea.value = text;
          this.applyCsvImport(text);
        } catch (err) {
          this.setCsvStatus(err instanceof Error ? err.message : 'Import failed', true);
        }
        fileInput.value = '';
      });
    }

    // Re-parse with new unit when dropdown changes while raw CSV is in memory
    if (unitSelect) {
      unitSelect.addEventListener('change', () => {
        if (this.pendingCsvText) {
          this.reapplyCsvWithUnit(this.getCsvValueUnit());
        }
      });
    }

    // Parse CSV when pasting or typing into the grafana textarea
    if (csvTextarea) {
      const handleCsvInput = () => {
        const content = csvTextarea.value.trim();
        if (!content) {
          this.pendingCsvText = null;
          return;
        }
        try {
          this.applyCsvImport(content);
        } catch {
          // Not valid CSV yet — user may still be typing
        }
      };
      csvTextarea.addEventListener('paste', () => setTimeout(handleCsvInput, 0));
      csvTextarea.addEventListener('change', handleCsvInput);
    }
  }

  private applyCsvImport(csvText: string): void {
    this.pendingCsvText = csvText;

    const guess = detectCsvValueUnit(csvText);
    this.setCsvValueUnit(guess.unit);

    const series = this.applyGrafanaParse(csvText, guess.unit);
    const unitLabel = guess.unit === 'rps' ? '' : ` as ${guess.unit.toUpperCase()}`;
    this.setCsvStatus(`${series.length} points${unitLabel} — ${guess.reason}. Change unit if incorrect.`, false);
  }

  private reapplyCsvWithUnit(unit: 'rps' | 'rpm' | 'rph'): void {
    if (!this.pendingCsvText) return;
    const series = this.applyGrafanaParse(this.pendingCsvText, unit);
    this.setCsvStatus(`Re-converted ${series.length} points as ${unit.toUpperCase()}.`, false);
  }

  private applyGrafanaParse(csvText: string, unit: 'rps' | 'rpm' | 'rph'): CustomTimePoint[] {
    const series = parseGrafanaCSV(csvText, unit);

    // Auto-adjust simulation duration to match the series
    const lastT = series[series.length - 1].t;
    if (lastT > 0) {
      const durationInput = document.getElementById('sim-duration') as HTMLInputElement;
      if (durationInput) durationInput.value = String(lastT);
    }

    this.notifyChange();
    this.updatePreview();
    return series;
  }

  private selectPattern(pattern: TrafficPatternType): void {
    const radio = document.getElementById(`pattern-${pattern}`) as HTMLInputElement;
    if (radio) {
      radio.checked = true;
      this.currentPattern = pattern;
      this.showPatternParams(pattern);
    }
  }

  private setCsvStatus(msg: string, isError: boolean): void {
    const el = document.getElementById('csv-import-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `csv-import-status ${isError ? 'error' : 'success'}`;
    setTimeout(() => { el.textContent = ''; el.className = 'csv-import-status'; }, 5000);
  }

  private updateBrokerSizeUI(input: HTMLInputElement): void {
    const isUnlimited = parseFloat(input.value) === 0;
    const unit = document.getElementById('broker-size-unit');
    if (unit) {
      unit.textContent = isUnlimited ? '= unlimited' : 'req';
    }
    const btn = document.getElementById('broker-unlimited-btn');
    if (btn) {
      btn.classList.toggle('active', isUnlimited);
    }
    input.disabled = isUnlimited;
  }

  private getFailureEvents(): FailureEvent[] {
    const container = document.getElementById('failure-events-container');
    if (!container) return [];

    const events: FailureEvent[] = [];
    const rows = container.querySelectorAll('.failure-event-row');
    rows.forEach(row => {
      const timeInput = row.querySelector('.failure-time') as HTMLInputElement;
      const countInput = row.querySelector('.failure-count') as HTMLInputElement;
      if (timeInput && countInput) {
        events.push({
          time: parseFloat(timeInput.value) || 0,
          count: parseFloat(countInput.value) || 1,
        });
      }
    });

    return events;
  }

  private setFailureEvents(events: FailureEvent[]): void {
    const container = document.getElementById('failure-events-container');
    if (!container) return;

    container.innerHTML = '';
    for (const evt of events) {
      this.addFailureEventRow(evt.time, evt.count);
    }
  }

  addFailureEventRow(time: number = 60, count: number = 1): void {
    const container = document.getElementById('failure-events-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'failure-event-row';
    row.innerHTML = `
      <label>At:</label>
      <input type="number" class="failure-time" value="${time}" min="0" max="86400" aria-label="Failure event time" title="Seconds into the simulation when pods are killed">
      <span class="unit">s</span>
      <label>Kill:</label>
      <input type="number" class="failure-count" value="${count}" min="1" max="100" aria-label="Number of pods to kill" title="Number of running pods to kill at this time">
      <span class="unit">pods</span>
      <button class="remove-step-btn" title="Remove this failure event" aria-label="Remove failure event">&times;</button>
    `;

    const removeBtn = row.querySelector('.remove-step-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        row.remove();
        this.notifyChange();
      });
    }

    row.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => this.notifyChange());
    });

    container.appendChild(row);
  }

  addStepRow(rps: number = 100, duration: number = 120): void {
    const container = document.getElementById('steps-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'step-row';
    row.innerHTML = `
      <label>RPS:</label>
      <input type="number" class="step-rps" value="${rps}" min="0" max="100000" aria-label="Step RPS" title="Requests per second for this step">
      <label>Duration:</label>
      <input type="number" class="step-duration" value="${duration}" min="1" max="3600" aria-label="Step duration in seconds" title="Duration of this step in seconds">
      <span class="unit">s</span>
      <button class="remove-step-btn" title="Remove this step" aria-label="Remove step">&times;</button>
    `;

    const removeBtn = row.querySelector('.remove-step-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        row.remove();
        this.notifyChange();
        this.updatePreview();
      });
    }

    // Bind inputs for live preview
    row.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        this.notifyChange();
        this.updatePreview();
      });
    });

    container.appendChild(row);
  }

  private showPatternParams(pattern: TrafficPatternType): void {
    const allParams = document.querySelectorAll('.pattern-params');
    allParams.forEach(el => (el as HTMLElement).classList.remove('active'));

    const activeParams = document.getElementById(`${pattern}-params`);
    if (activeParams) activeParams.classList.add('active');

    // Update radio button styling
    const labels = document.querySelectorAll('.pattern-label');
    labels.forEach(l => l.classList.remove('active'));
    const activeLabel = document.querySelector(`label[for="pattern-${pattern}"]`);
    if (activeLabel) activeLabel.classList.add('active');
  }

  updatePreview(): void {
    try {
      const traffic = this.getTrafficConfig();
      const duration = this.getNumericValue('sim-duration', DEFAULT_CONFIG.simulation.duration);
      const tick = this.getNumericValue('sim-tick', DEFAULT_CONFIG.simulation.tick_interval);
      const points = Math.ceil(duration / tick);
      const data = this.trafficService.preview(traffic, points);
      this.previewRenderer.render('traffic-preview-canvas', data);
    } catch {
      // Preview failed, non-critical
    }
  }

  private updatePlatformLabels(platform: Platform): void {
    const podLabel = platform === 'kubernetes-hpa' ? 'Pod' : 'Instance';
    const elements = document.querySelectorAll('.pod-label');
    elements.forEach(el => {
      el.textContent = podLabel;
    });
  }

  // --- DOM helpers ---

  private getInputValue(id: string): string {
    const el = document.getElementById(id) as HTMLInputElement;
    return el ? el.value : '';
  }

  private getSelectValue(id: string): string {
    const el = document.getElementById(id) as HTMLSelectElement;
    return el ? el.value : '';
  }

  private getNumericValue(id: string, fallback: number): number {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) {
      const val = parseFloat(el.value);
      return isNaN(val) ? fallback : val;
    }
    return fallback;
  }

  private setInputValue(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) el.value = value;
  }

  private setSelectValue(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLSelectElement;
    if (el) el.value = value;
  }

  private setNumericValue(id: string, value: number): void {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) el.value = value.toString();
  }
}
