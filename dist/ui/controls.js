// ============================================================================
// scalings.xyz — UI Controls (Form State, Input Bindings)
// ============================================================================
import { DEFAULT_CONFIG, PRESET_SCENARIOS, } from '../interfaces/types.js';
import { TrafficPreviewRenderer } from './chart.js';
export class UIControls {
    constructor(trafficService) {
        this.onChangeCallbacks = [];
        this.currentPattern = 'spike';
        this.trafficService = trafficService;
        this.previewRenderer = new TrafficPreviewRenderer();
    }
    init() {
        this.bindSliders();
        this.bindPatternSelector();
        this.bindAdvancedToggle();
        this.bindChaosToggle();
        this.bindPresets();
        this.bindPlatformSelector();
        this.bindStepControls();
        this.bindFailureEventControls();
        this.showPatternParams(this.currentPattern);
        this.updatePreview();
    }
    onChange(cb) {
        this.onChangeCallbacks.push(cb);
    }
    notifyChange() {
        for (const cb of this.onChangeCallbacks)
            cb();
    }
    // --- Read form state into config ---
    getConfig() {
        const config = {
            version: 1,
            name: this.getInputValue('sim-name') || 'Untitled Simulation',
            platform: this.getSelectValue('platform-select'),
            simulation: {
                duration: this.getNumericValue('sim-duration', DEFAULT_CONFIG.simulation.duration),
                tick_interval: this.getNumericValue('sim-tick', DEFAULT_CONFIG.simulation.tick_interval),
            },
            scaling: {
                min_replicas: this.getNumericValue('param-min_replicas', DEFAULT_CONFIG.scaling.min_replicas),
                max_replicas: this.getNumericValue('param-max_replicas', DEFAULT_CONFIG.scaling.max_replicas),
                scale_up_threshold: this.getNumericValue('param-scale_up_threshold', DEFAULT_CONFIG.scaling.scale_up_threshold),
                scale_down_threshold: this.getNumericValue('param-scale_down_threshold', DEFAULT_CONFIG.scaling.scale_down_threshold),
                capacity_per_replica: this.getNumericValue('param-capacity_per_replica', DEFAULT_CONFIG.scaling.capacity_per_replica),
                startup_time: this.getNumericValue('param-startup_time', DEFAULT_CONFIG.scaling.startup_time),
                scale_up_step: this.getNumericValue('param-scale_up_step', DEFAULT_CONFIG.scaling.scale_up_step),
                scale_down_step: this.getNumericValue('param-scale_down_step', DEFAULT_CONFIG.scaling.scale_down_step),
            },
            advanced: {
                metric_observation_delay: this.getNumericValue('param-metric_observation_delay', DEFAULT_CONFIG.advanced.metric_observation_delay),
                cooldown_scale_up: this.getNumericValue('param-cooldown_scale_up', DEFAULT_CONFIG.advanced.cooldown_scale_up),
                cooldown_scale_down: this.getNumericValue('param-cooldown_scale_down', DEFAULT_CONFIG.advanced.cooldown_scale_down),
                node_provisioning_time: this.getNumericValue('param-node_provisioning_time', DEFAULT_CONFIG.advanced.node_provisioning_time),
                cluster_node_capacity: this.getNumericValue('param-cluster_node_capacity', DEFAULT_CONFIG.advanced.cluster_node_capacity),
                pods_per_node: this.getNumericValue('param-pods_per_node', DEFAULT_CONFIG.advanced.pods_per_node),
                graceful_shutdown_time: this.getNumericValue('param-graceful_shutdown_time', DEFAULT_CONFIG.advanced.graceful_shutdown_time),
                cost_per_replica_hour: this.getNumericValue('param-cost_per_replica_hour', DEFAULT_CONFIG.advanced.cost_per_replica_hour),
            },
            chaos: {
                pod_failure_rate: this.getNumericValue('param-pod_failure_rate', DEFAULT_CONFIG.chaos.pod_failure_rate),
                random_seed: this.getNumericValue('param-random_seed', DEFAULT_CONFIG.chaos.random_seed),
                failure_events: this.getFailureEvents(),
            },
            traffic: this.getTrafficConfig(),
        };
        return config;
    }
    // --- Write config to form ---
    setConfig(config) {
        this.setInputValue('sim-name', config.name);
        this.setSelectValue('platform-select', config.platform);
        // Simulation params
        this.setNumericValue('sim-duration', config.simulation.duration);
        this.setNumericValue('sim-tick', config.simulation.tick_interval);
        // Scaling params
        this.setNumericValue('param-min_replicas', config.scaling.min_replicas);
        this.setNumericValue('param-max_replicas', config.scaling.max_replicas);
        this.setNumericValue('param-scale_up_threshold', config.scaling.scale_up_threshold);
        this.setNumericValue('param-scale_down_threshold', config.scaling.scale_down_threshold);
        this.setNumericValue('param-capacity_per_replica', config.scaling.capacity_per_replica);
        this.setNumericValue('param-startup_time', config.scaling.startup_time);
        this.setNumericValue('param-scale_up_step', config.scaling.scale_up_step);
        this.setNumericValue('param-scale_down_step', config.scaling.scale_down_step);
        // Advanced params
        this.setNumericValue('param-metric_observation_delay', config.advanced.metric_observation_delay);
        this.setNumericValue('param-cooldown_scale_up', config.advanced.cooldown_scale_up);
        this.setNumericValue('param-cooldown_scale_down', config.advanced.cooldown_scale_down);
        this.setNumericValue('param-node_provisioning_time', config.advanced.node_provisioning_time);
        this.setNumericValue('param-cluster_node_capacity', config.advanced.cluster_node_capacity);
        this.setNumericValue('param-pods_per_node', config.advanced.pods_per_node);
        this.setNumericValue('param-graceful_shutdown_time', config.advanced.graceful_shutdown_time);
        this.setNumericValue('param-cost_per_replica_hour', config.advanced.cost_per_replica_hour);
        // Chaos
        this.setNumericValue('param-pod_failure_rate', config.chaos.pod_failure_rate);
        this.setNumericValue('param-random_seed', config.chaos.random_seed);
        this.setFailureEvents(config.chaos.failure_events);
        // Traffic
        this.setTrafficConfig(config.traffic);
        this.updatePreview();
    }
    // --- Traffic config helpers ---
    getTrafficConfig() {
        const pattern = this.currentPattern;
        let params;
        switch (pattern) {
            case 'gradual':
                params = {
                    start_rps: this.getNumericValue('traffic-gradual-start_rps', 50),
                    end_rps: this.getNumericValue('traffic-gradual-end_rps', 800),
                };
                break;
            case 'spike':
                params = {
                    base_rps: this.getNumericValue('traffic-spike-base_rps', 200),
                    spike_rps: this.getNumericValue('traffic-spike-spike_rps', 2000),
                    spike_start: this.getNumericValue('traffic-spike-spike_start', 120),
                    spike_duration: this.getNumericValue('traffic-spike-spike_duration', 60),
                };
                break;
            case 'wave':
                params = {
                    base_rps: this.getNumericValue('traffic-wave-base_rps', 300),
                    amplitude: this.getNumericValue('traffic-wave-amplitude', 200),
                    period: this.getNumericValue('traffic-wave-period', 120),
                };
                break;
            case 'step':
                params = { steps: this.getStepEntries() };
                break;
            case 'custom':
                params = { series: this.getCustomSeries() };
                break;
            default:
                params = DEFAULT_CONFIG.traffic.params;
        }
        return { pattern, params };
    }
    setTrafficConfig(traffic) {
        this.currentPattern = traffic.pattern;
        // Set radio button
        const radio = document.querySelector(`input[name="traffic-pattern"][value="${traffic.pattern}"]`);
        if (radio)
            radio.checked = true;
        this.showPatternParams(traffic.pattern);
        switch (traffic.pattern) {
            case 'gradual': {
                const p = traffic.params;
                this.setNumericValue('traffic-gradual-start_rps', p.start_rps);
                this.setNumericValue('traffic-gradual-end_rps', p.end_rps);
                break;
            }
            case 'spike': {
                const p = traffic.params;
                this.setNumericValue('traffic-spike-base_rps', p.base_rps);
                this.setNumericValue('traffic-spike-spike_rps', p.spike_rps);
                this.setNumericValue('traffic-spike-spike_start', p.spike_start);
                this.setNumericValue('traffic-spike-spike_duration', p.spike_duration);
                break;
            }
            case 'wave': {
                const p = traffic.params;
                this.setNumericValue('traffic-wave-base_rps', p.base_rps);
                this.setNumericValue('traffic-wave-amplitude', p.amplitude);
                this.setNumericValue('traffic-wave-period', p.period);
                break;
            }
            case 'step': {
                const p = traffic.params;
                this.setStepEntries(p.steps);
                break;
            }
            case 'custom': {
                const p = traffic.params;
                const textarea = document.getElementById('traffic-custom-series');
                if (textarea)
                    textarea.value = JSON.stringify(p.series, null, 2);
                break;
            }
        }
    }
    getStepEntries() {
        const container = document.getElementById('steps-container');
        if (!container)
            return [{ rps: 100, duration: 120 }];
        const entries = [];
        const rows = container.querySelectorAll('.step-row');
        rows.forEach(row => {
            const rpsInput = row.querySelector('.step-rps');
            const durInput = row.querySelector('.step-duration');
            if (rpsInput && durInput) {
                entries.push({
                    rps: parseFloat(rpsInput.value) || 100,
                    duration: parseFloat(durInput.value) || 120,
                });
            }
        });
        return entries.length > 0 ? entries : [{ rps: 100, duration: 120 }];
    }
    setStepEntries(steps) {
        const container = document.getElementById('steps-container');
        if (!container)
            return;
        container.innerHTML = '';
        for (const step of steps) {
            this.addStepRow(step.rps, step.duration);
        }
    }
    getCustomSeries() {
        const textarea = document.getElementById('traffic-custom-series');
        if (!textarea)
            return [{ t: 0, rps: 100 }];
        try {
            const parsed = JSON.parse(textarea.value);
            if (Array.isArray(parsed))
                return parsed;
        }
        catch {
            // Try line-by-line format
        }
        return [{ t: 0, rps: 100 }, { t: 300, rps: 500 }, { t: 600, rps: 100 }];
    }
    // --- DOM bindings ---
    bindSliders() {
        // Bind all number inputs in param rows
        const numberInputs = document.querySelectorAll('.param-row input[type="number"]');
        numberInputs.forEach(input => {
            input.addEventListener('input', () => {
                this.notifyChange();
                this.updatePreview();
            });
            input.addEventListener('change', () => {
                const el = input;
                const min = parseFloat(el.min);
                const max = parseFloat(el.max);
                let val = parseFloat(el.value);
                if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
                    val = Math.max(min, Math.min(max, val));
                    el.value = val.toString();
                }
                this.notifyChange();
                this.updatePreview();
            });
        });
        // Also bind standalone number inputs (sim duration, tick interval)
        ['sim-duration', 'sim-tick'].forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('change', () => {
                    this.notifyChange();
                    this.updatePreview();
                });
            }
        });
    }
    bindPatternSelector() {
        const radios = document.querySelectorAll('input[name="traffic-pattern"]');
        radios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const target = e.target;
                this.currentPattern = target.value;
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
    bindAdvancedToggle() {
        const toggle = document.getElementById('advanced-toggle');
        const content = document.getElementById('advanced-content');
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
    bindPresets() {
        const container = document.getElementById('preset-buttons');
        if (!container)
            return;
        const buttons = container.querySelectorAll('button[data-preset]');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const presetName = btn.dataset.preset;
                const preset = PRESET_SCENARIOS.find(p => p.name === presetName);
                if (preset && preset.config) {
                    const fullConfig = {
                        ...DEFAULT_CONFIG,
                        ...preset.config,
                        scaling: { ...DEFAULT_CONFIG.scaling, ...(preset.config.scaling || {}) },
                        advanced: { ...DEFAULT_CONFIG.advanced, ...(preset.config.advanced || {}) },
                        chaos: { ...DEFAULT_CONFIG.chaos, ...(preset.config.chaos || {}) },
                        simulation: { ...DEFAULT_CONFIG.simulation, ...(preset.config.simulation || {}) },
                        traffic: preset.config.traffic || DEFAULT_CONFIG.traffic,
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
    bindPlatformSelector() {
        const select = document.getElementById('platform-select');
        if (select) {
            select.addEventListener('change', () => {
                this.updatePlatformLabels(select.value);
                this.notifyChange();
            });
        }
    }
    bindStepControls() {
        const addBtn = document.getElementById('add-step-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.addStepRow(100, 120);
                this.notifyChange();
                this.updatePreview();
            });
        }
    }
    bindChaosToggle() {
        const toggle = document.getElementById('chaos-toggle');
        const content = document.getElementById('chaos-content');
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
    bindFailureEventControls() {
        const addBtn = document.getElementById('add-failure-event-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.addFailureEventRow(60, 1);
                this.notifyChange();
            });
        }
    }
    getFailureEvents() {
        const container = document.getElementById('failure-events-container');
        if (!container)
            return [];
        const events = [];
        const rows = container.querySelectorAll('.failure-event-row');
        rows.forEach(row => {
            const timeInput = row.querySelector('.failure-time');
            const countInput = row.querySelector('.failure-count');
            if (timeInput && countInput) {
                events.push({
                    time: parseFloat(timeInput.value) || 0,
                    count: parseFloat(countInput.value) || 1,
                });
            }
        });
        return events;
    }
    setFailureEvents(events) {
        const container = document.getElementById('failure-events-container');
        if (!container)
            return;
        container.innerHTML = '';
        for (const evt of events) {
            this.addFailureEventRow(evt.time, evt.count);
        }
    }
    addFailureEventRow(time = 60, count = 1) {
        const container = document.getElementById('failure-events-container');
        if (!container)
            return;
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
    addStepRow(rps = 100, duration = 120) {
        const container = document.getElementById('steps-container');
        if (!container)
            return;
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
    showPatternParams(pattern) {
        const allParams = document.querySelectorAll('.pattern-params');
        allParams.forEach(el => el.classList.remove('active'));
        const activeParams = document.getElementById(`${pattern}-params`);
        if (activeParams)
            activeParams.classList.add('active');
        // Update radio button styling
        const labels = document.querySelectorAll('.pattern-label');
        labels.forEach(l => l.classList.remove('active'));
        const activeLabel = document.querySelector(`label[for="pattern-${pattern}"]`);
        if (activeLabel)
            activeLabel.classList.add('active');
    }
    updatePreview() {
        try {
            const traffic = this.getTrafficConfig();
            const data = this.trafficService.preview(traffic, 100);
            this.previewRenderer.render('traffic-preview-canvas', data);
        }
        catch {
            // Preview failed, non-critical
        }
    }
    updatePlatformLabels(platform) {
        const podLabel = platform === 'kubernetes-hpa' ? 'Pod' : 'Instance';
        const elements = document.querySelectorAll('.pod-label');
        elements.forEach(el => {
            el.textContent = podLabel;
        });
    }
    // --- DOM helpers ---
    getInputValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }
    getSelectValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }
    getNumericValue(id, fallback) {
        const el = document.getElementById(id);
        if (el) {
            const val = parseFloat(el.value);
            return isNaN(val) ? fallback : val;
        }
        return fallback;
    }
    setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el)
            el.value = value;
    }
    setSelectValue(id, value) {
        const el = document.getElementById(id);
        if (el)
            el.value = value;
    }
    setNumericValue(id, value) {
        const el = document.getElementById(id);
        if (el)
            el.value = value.toString();
    }
}
//# sourceMappingURL=controls.js.map