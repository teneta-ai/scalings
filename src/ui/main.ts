// ============================================================================
// scalings.xyz — Main Application Entry Point
// ============================================================================

import { createServices, ServiceContainer } from '../factory.js';
import { SimulationConfig, SimulationResult, SimulationSummary, TickSnapshot, LoadTestFramework, LoadTestRequestConfig, HttpMethod } from '../interfaces/types.js';
import { UIControls } from './controls.js';
import { ChartRenderer } from './chart.js';

/** Per-run label colors — matches chart RUN_COLORS order for visual consistency. */
const RUN_LABEL_COLORS = [
  '#84cc16', // lime (chart run 1 capacity)
  '#fbbf24', // amber (chart run 2 capacity)
  '#38bdf8', // sky (chart run 3 capacity)
  '#f472b6', // pink (chart run 4 capacity)
  '#34d399', // emerald (chart run 5 capacity)
];

class App {
  private services: ServiceContainer;
  private controls: UIControls;
  private chart: ChartRenderer;
  private isSimulating: boolean = false;
  private isRecording: boolean = false;
  private recordedRuns: { name: string; result: SimulationResult }[] = [];
  private runCounter: number = 0;
  private lastResult: SimulationResult | null = null;
  private selectedFramework: LoadTestFramework = 'k6';

  constructor() {
    this.services = createServices();
    this.controls = new UIControls(this.services.traffic);
    this.chart = new ChartRenderer();
  }

  init(): void {
    this.controls.init();
    this.bindButtons();
    this.loadState();
    this.checkURLConfig();

    // Auto-save on changes
    this.controls.onChange(() => {
      const config = this.controls.getConfig();
      this.services.config.saveLocal(config);
    });

    // Set animation callback
    this.chart.setAnimationCallback((index, total) => {
      const progress = document.getElementById('sim-progress');
      if (progress) {
        const pct = Math.round((index / total) * 100);
        progress.textContent = index < total ? `${pct}%` : 'Complete';
        progress.style.width = `${pct}%`;
      }
    });
  }

  private bindButtons(): void {
    // Simulate button
    const simBtn = document.getElementById('btn-simulate');
    if (simBtn) {
      simBtn.addEventListener('click', () => this.runSimulation());
    }

    // Record runs toggle
    const recordToggle = document.getElementById('record-runs') as HTMLInputElement;
    const purgeBtn = document.getElementById('btn-purge-runs');
    const exportRunsBtn = document.getElementById('btn-export-runs');
    const importRunsBtn = document.getElementById('btn-import-runs');
    const importRunsInput = document.getElementById('import-runs-input') as HTMLInputElement;
    const runButtons = [purgeBtn, exportRunsBtn];
    if (recordToggle) {
      recordToggle.addEventListener('change', () => {
        this.isRecording = recordToggle.checked;
        for (const btn of runButtons) {
          if (btn) btn.classList.toggle('hidden', !this.isRecording);
        }
        if (!this.isRecording) {
          this.recordedRuns = [];
          this.runCounter = 0;
        }
      });
    }
    if (purgeBtn) {
      purgeBtn.addEventListener('click', () => {
        this.recordedRuns = [];
        this.runCounter = 0;
        this.showToast('All recorded runs cleared', 'success');
      });
    }
    if (exportRunsBtn) {
      exportRunsBtn.addEventListener('click', () => this.exportRuns());
    }
    if (importRunsBtn && importRunsInput) {
      importRunsBtn.addEventListener('click', () => importRunsInput.click());
      importRunsInput.addEventListener('change', (e) => this.importRuns(e));
    }

    // Export source config
    const exportBtn = document.getElementById('btn-export-yaml');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportSourceConfig());
    }

    // Import source config
    const importBtn = document.getElementById('btn-import-yaml');
    const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => this.importSourceConfig(e));
    }

    // Copy share URL
    const urlBtn = document.getElementById('btn-copy-url');
    if (urlBtn) {
      urlBtn.addEventListener('click', () => this.copyShareURL());
    }

    // Generate deployment config
    const deployBtn = document.getElementById('btn-generate-deploy');
    if (deployBtn) {
      deployBtn.addEventListener('click', () => this.generateDeployConfig());
    }

    // Copy export output
    const copyExportBtn = document.getElementById('btn-copy-export');
    if (copyExportBtn) {
      copyExportBtn.addEventListener('click', () => this.copyExportOutput());
    }

    // Load test framework toggles
    const frameworkBtns = document.querySelectorAll('.framework-btn');
    for (const btn of frameworkBtns) {
      btn.addEventListener('click', () => {
        for (const b of frameworkBtns) b.classList.remove('active');
        btn.classList.add('active');
        this.selectedFramework = (btn as HTMLElement).dataset.framework as LoadTestFramework;
      });
    }

    // HTTP method toggle — show/hide body section
    const methodSelect = document.getElementById('loadtest-method') as HTMLSelectElement;
    const bodySection = document.getElementById('loadtest-body-section');
    if (methodSelect && bodySection) {
      const updateBodyVisibility = () => {
        const m = methodSelect.value;
        bodySection.style.display = (m === 'POST' || m === 'PUT' || m === 'PATCH') ? '' : 'none';
      };
      updateBodyVisibility();
      methodSelect.addEventListener('change', updateBodyVisibility);
    }

    // Auto-format JSON in body textarea on blur, paste, and button click.
    // Template variables ($randInt etc.) aren't valid JSON, so we swap them
    // out for safe placeholders before parsing, then restore after formatting.
    const bodyTextarea = document.getElementById('loadtest-body') as HTMLTextAreaElement;
    if (bodyTextarea) {
      const templateVars = ['$randomEmail', '$randString', '$randFloat', '$timestamp', '$randInt', '$uuid'];

      const formatBody = (showError: boolean): void => {
        const raw = bodyTextarea.value.trim();
        if (!raw) return;

        // Strategy: replace each template var with a unique integer so the
        // string becomes valid JSON.  After formatting, swap them back.
        // We use large sentinel numbers (900001, 900002, …) unlikely to
        // collide with real values.
        let safe = raw;
        const restores: [string, string][] = []; // [placeholder-in-output, original-text]
        let sentinel = 900001;

        for (const v of templateVars) {
          if (!safe.includes(v)) continue;

          // Quoted form:  "$var"  →  "PLACEHOLDER_Q"  (stays a string after stringify)
          const qph = `__PH_Q_${sentinel}__`;
          if (safe.includes(`"${v}"`)) {
            safe = safe.split(`"${v}"`).join(`"${qph}"`);
            restores.push([`"${qph}"`, `"${v}"`]);
          }

          // Bare form:  $var  →  sentinel number  (stays a number after stringify)
          const bph = sentinel;
          if (safe.includes(v)) {
            safe = safe.split(v).join(String(bph));
            restores.push([String(bph), v]);
          }

          sentinel++;
        }

        try {
          const parsed = JSON.parse(safe);
          let formatted = JSON.stringify(parsed, null, 2);
          for (const [ph, original] of restores) {
            formatted = formatted.split(ph).join(original);
          }
          bodyTextarea.value = formatted;
          // Auto-resize to fit formatted content
          bodyTextarea.style.height = 'auto';
          bodyTextarea.style.height = bodyTextarea.scrollHeight + 'px';
          if (showError) this.showSuccess('Formatted');
        } catch {
          if (showError) this.showError('Body is not valid JSON — check syntax');
        }
      };

      bodyTextarea.addEventListener('blur', () => formatBody(false));
      bodyTextarea.addEventListener('paste', () => {
        setTimeout(() => formatBody(false), 0);
      });

      const formatBtn = document.getElementById('btn-format-body');
      if (formatBtn) {
        formatBtn.addEventListener('click', () => formatBody(true));
      }
    }

    // Generate load test script
    const genLoadTestBtn = document.getElementById('btn-generate-loadtest');
    if (genLoadTestBtn) {
      genLoadTestBtn.addEventListener('click', () => this.generateLoadTestScript());
    }

    // Copy load test output
    const copyLoadTestBtn = document.getElementById('btn-copy-loadtest');
    if (copyLoadTestBtn) {
      copyLoadTestBtn.addEventListener('click', () => {
        const code = document.getElementById('loadtest-code');
        if (code) {
          navigator.clipboard.writeText(code.textContent || '').then(() => {
            this.showSuccess('Script copied to clipboard!');
          });
        }
      });
    }

    // Download load test script
    const downloadLoadTestBtn = document.getElementById('btn-download-loadtest');
    if (downloadLoadTestBtn) {
      downloadLoadTestBtn.addEventListener('click', () => this.downloadLoadTestScript());
    }

    // Playback speed
    const speedSlider = document.getElementById('playback-speed') as HTMLInputElement;
    const speedValue = document.getElementById('playback-speed-value');
    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        const speed = parseFloat(speedSlider.value);
        this.chart.setPlaybackSpeed(speed);
        if (speedValue) speedValue.textContent = `${speed}x`;
      });
    }

    // Traffic toggle
    const trafficToggle = document.getElementById('traffic-toggle');
    const trafficContent = document.getElementById('traffic-content');
    const trafficPreview = document.querySelector('#traffic-section .traffic-preview');
    const toggleTraffic = () => {
      if (!trafficToggle || !trafficContent) return;
      trafficContent.classList.toggle('collapsed');
      trafficToggle.classList.toggle('expanded');
      const isExpanded = !trafficContent.classList.contains('collapsed');
      trafficToggle.setAttribute('aria-expanded', String(isExpanded));
      const arrow = trafficToggle.querySelector('.toggle-arrow');
      if (arrow) {
        arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
      }
      if (trafficPreview) {
        trafficPreview.classList.toggle('expanded', isExpanded);
      }
    };
    if (trafficToggle) trafficToggle.addEventListener('click', toggleTraffic);
    // Clicking the preview mini-chart also opens the traffic editor
    if (trafficPreview) {
      trafficPreview.addEventListener('click', () => {
        if (trafficContent && trafficContent.classList.contains('collapsed')) {
          toggleTraffic();
        }
      });
    }

    // Docs toggle
    const docsToggle = document.getElementById('docs-toggle');
    const docsContent = document.getElementById('docs-content');
    const expandDocs = () => {
      if (!docsToggle || !docsContent) return;
      docsContent.classList.toggle('collapsed');
      docsToggle.classList.toggle('expanded');
      const isExpanded = !docsContent.classList.contains('collapsed');
      docsToggle.setAttribute('aria-expanded', String(isExpanded));
      const arrow = docsToggle.querySelector('.toggle-arrow');
      if (arrow) {
        arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
      }
    };
    if (docsToggle) docsToggle.addEventListener('click', expandDocs);
    // Header "Docs" button should also expand the docs section
    const headerDocsBtn = document.querySelector('.header-docs-btn');
    if (headerDocsBtn) {
      headerDocsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (docsContent && docsContent.classList.contains('collapsed')) {
          expandDocs();
        }
        document.getElementById('docs')?.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Cost hint → open Advanced Parameters and scroll to cost field
    const costHint = document.getElementById('cost-hint');
    if (costHint) {
      costHint.addEventListener('click', () => {
        const advContent = document.getElementById('advanced-content');
        const advToggle = document.getElementById('advanced-toggle');
        if (advContent && advContent.classList.contains('collapsed')) {
          advToggle?.click();
        }
        const costInput = document.getElementById('param-cost_per_replica_hour');
        if (costInput) {
          costInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          costInput.focus();
          costInput.classList.add('param-highlight');
          costInput.addEventListener('animationend', () => {
            costInput.classList.remove('param-highlight');
          }, { once: true });
        }
      });
    }

    // Log toggle
    const logToggle = document.getElementById('log-toggle');
    const logContent = document.getElementById('log-content');
    if (logToggle && logContent) {
      logToggle.addEventListener('click', () => {
        logContent.classList.toggle('collapsed');
        logToggle.classList.toggle('expanded');
        const isExpanded = !logContent.classList.contains('collapsed');
        logToggle.setAttribute('aria-expanded', String(isExpanded));
        const arrow = logToggle.querySelector('.toggle-arrow');
        if (arrow) arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
      });
    }

    // Log filters
    for (const id of ['log-filter-scale', 'log-filter-lifecycle', 'log-filter-failures', 'log-filter-traffic']) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.applyLogFilters());
    }
    const runFilterEl = document.getElementById('log-run-filter');
    if (runFilterEl) runFilterEl.addEventListener('change', () => this.applyLogFilters());

    // Log copy & download
    const logCopyBtn = document.getElementById('btn-log-copy');
    if (logCopyBtn) {
      logCopyBtn.addEventListener('click', () => {
        const text = this.getLogText();
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => this.showToast('Log copied to clipboard', 'success'));
      });
    }
    const logDownloadBtn = document.getElementById('btn-log-download');
    if (logDownloadBtn) {
      logDownloadBtn.addEventListener('click', () => {
        const text = this.getLogText();
        if (!text) return;
        this.offerDownload(text, 'simulation-log.txt', 'text/plain');
      });
    }

    // Feedback dropdown
    const feedbackBtn = document.querySelector('.header-feedback-btn');
    const feedbackDropdown = document.querySelector('.feedback-dropdown');
    if (feedbackBtn && feedbackDropdown) {
      feedbackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        feedbackDropdown.classList.toggle('open');
      });
      document.addEventListener('click', () => {
        feedbackDropdown.classList.remove('open');
      });
    }

    // Drag and drop for YAML import
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
          this.readAndImportFile(file);
        }
      }
    });
  }

  private async runSimulation(): Promise<void> {
    if (this.isSimulating) return;

    const simBtn = document.getElementById('btn-simulate');
    const outputSection = document.getElementById('output-section');

    try {
      this.isSimulating = true;
      document.body.classList.add('simulating');
      if (simBtn) {
        simBtn.textContent = 'Simulating...';
        simBtn.classList.add('running');
      }

      const config = this.controls.getConfig();
      this.services.config.saveLocal(config);

      const result = await this.services.simulation.run(config);
      this.lastResult = result;

      // Show results, hide placeholder
      const placeholder = document.getElementById('sim-placeholder');
      const resultsContent = document.getElementById('sim-results-content');
      if (placeholder) placeholder.classList.add('hidden');
      if (resultsContent) resultsContent.classList.remove('hidden');
      if (outputSection) {
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      // Render chart
      if (this.isRecording) {
        const runName = `Run ${this.recordedRuns.length + 1}`;
        this.recordedRuns.push({ name: runName, result });
        this.chart.renderMultiRun('sim-chart', this.recordedRuns);
      } else {
        const speed = parseFloat((document.getElementById('playback-speed') as HTMLInputElement)?.value || '5');
        await this.chart.renderAnimated('sim-chart', result, speed);
      }

      this.runCounter++;
      if (this.isRecording) {
        this.renderMultiRunSummary(this.recordedRuns);
        this.renderMultiRunLog(this.recordedRuns);
      } else {
        this.renderSummaryRunId(result.run_id);
        this.renderSummary(result.summary);
        this.renderLog(result.snapshots, result.run_id);
      }

    } catch (err) {
      console.error('Simulation error:', err);
      this.showError('Simulation failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      this.isSimulating = false;
      document.body.classList.remove('simulating');
      if (simBtn) {
        simBtn.textContent = 'Simulate';
        simBtn.classList.remove('running');
      }
    }
  }

  private renderSummaryRunId(runId: string | null, runs?: { name: string; result: SimulationResult }[]): void {
    const el = document.getElementById('summary-run-id');
    if (!el) return;
    if (runs && runs.length > 0) {
      el.innerHTML = runs.map((r, i) => {
        const color = RUN_LABEL_COLORS[i % RUN_LABEL_COLORS.length];
        return `<span style="color:${color};font-weight:600">${r.name}</span>: ${r.result.run_id}`;
      }).join('&nbsp;&nbsp;|&nbsp;&nbsp;');
      el.classList.remove('hidden');
    } else if (runId) {
      el.textContent = `Run ID: ${runId}`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  private renderSummary(summary: SimulationSummary): void {
    this.setSummaryValue('stat-total-requests', this.formatNumber(summary.total_requests));
    this.setSummaryValue('stat-served', this.formatNumber(summary.total_served));
    this.setSummaryValue('stat-dropped', this.formatNumber(summary.total_dropped));
    this.setSummaryValue('stat-drop-rate', `${summary.drop_rate_percent.toFixed(2)}%`);
    this.setSummaryValue('stat-peak-pods', summary.peak_pod_count.toString());

    // Queue stat visibility
    const queueStatCard = document.getElementById('stat-card-peak-queue');
    if (queueStatCard) {
      if (summary.peak_queue_depth > 0) {
        queueStatCard.classList.remove('hidden');
        this.setSummaryValue('stat-peak-queue', this.formatNumber(summary.peak_queue_depth));
      } else {
        queueStatCard.classList.add('hidden');
      }
    }

    // Peak wait time stat
    const waitStatCard = document.getElementById('stat-card-peak-wait');
    if (waitStatCard) {
      if (summary.peak_queue_wait_time_ms > 0) {
        waitStatCard.classList.remove('hidden');
        const waitMs = summary.peak_queue_wait_time_ms;
        this.setSummaryValue('stat-peak-wait', waitMs >= 1000 ? `${(waitMs / 1000).toFixed(1)}s` : `${Math.round(waitMs)}ms`);
      } else {
        waitStatCard.classList.add('hidden');
      }
    }

    // Expired requests stat
    const expiredStatCard = document.getElementById('stat-card-expired');
    if (expiredStatCard) {
      if (summary.total_expired > 0) {
        expiredStatCard.classList.remove('hidden');
        this.setSummaryValue('stat-expired', this.formatNumber(summary.total_expired));
      } else {
        expiredStatCard.classList.add('hidden');
      }
    }

    // Retry traffic stat
    const retriesStatCard = document.getElementById('stat-card-retries');
    if (retriesStatCard) {
      if (summary.total_retries > 0) {
        retriesStatCard.classList.remove('hidden');
        this.setSummaryValue('stat-retries', this.formatNumber(summary.total_retries));
      } else {
        retriesStatCard.classList.add('hidden');
      }
    }
    this.setSummaryValue('stat-underprov-time', `${summary.time_under_provisioned_seconds}s (${summary.time_under_provisioned_percent.toFixed(1)}%)`);
    this.setSummaryValue('stat-recovery-time', summary.time_to_recover_seconds !== null ? `${summary.time_to_recover_seconds}s` : 'N/A');
    this.setSummaryValue('stat-cost', `$${summary.estimated_total_cost.toFixed(4)}`);

    // Highlight drops
    const droppedEl = document.getElementById('stat-dropped');
    if (droppedEl) {
      droppedEl.classList.toggle('danger', summary.total_dropped > 0);
    }
    const dropRateEl = document.getElementById('stat-drop-rate');
    if (dropRateEl) {
      dropRateEl.classList.toggle('danger', summary.drop_rate_percent > 1);
    }
  }

  private renderMultiRunSummary(runs: { name: string; result: SimulationResult }[]): void {
    this.renderSummaryRunId(null, runs);
    const stats: { id: string; extract: (s: SimulationSummary) => string; cardId?: string; showIf?: (s: SimulationSummary) => boolean }[] = [
      { id: 'stat-total-requests', extract: s => this.formatNumber(s.total_requests) },
      { id: 'stat-served', extract: s => this.formatNumber(s.total_served) },
      { id: 'stat-dropped', extract: s => this.formatNumber(s.total_dropped) },
      { id: 'stat-drop-rate', extract: s => `${s.drop_rate_percent.toFixed(2)}%` },
      { id: 'stat-peak-pods', extract: s => s.peak_pod_count.toString() },
      { id: 'stat-peak-queue', cardId: 'stat-card-peak-queue', extract: s => this.formatNumber(s.peak_queue_depth), showIf: s => s.peak_queue_depth > 0 },
      { id: 'stat-peak-wait', cardId: 'stat-card-peak-wait', extract: s => {
        const ms = s.peak_queue_wait_time_ms;
        return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
      }, showIf: s => s.peak_queue_wait_time_ms > 0 },
      { id: 'stat-expired', cardId: 'stat-card-expired', extract: s => this.formatNumber(s.total_expired), showIf: s => s.total_expired > 0 },
      { id: 'stat-retries', cardId: 'stat-card-retries', extract: s => this.formatNumber(s.total_retries), showIf: s => s.total_retries > 0 },
      { id: 'stat-underprov-time', extract: s => `${s.time_under_provisioned_seconds}s (${s.time_under_provisioned_percent.toFixed(1)}%)` },
      { id: 'stat-recovery-time', extract: s => s.time_to_recover_seconds !== null ? `${s.time_to_recover_seconds}s` : 'N/A' },
      { id: 'stat-cost', extract: s => `$${s.estimated_total_cost.toFixed(4)}` },
    ];

    for (const stat of stats) {
      // Show/hide conditional cards
      if (stat.cardId) {
        const card = document.getElementById(stat.cardId);
        if (card) {
          const anyVisible = runs.some(r => stat.showIf!(r.result.summary));
          card.classList.toggle('hidden', !anyVisible);
          if (!anyVisible) continue;
        }
      }

      const el = document.getElementById(stat.id);
      if (!el) continue;

      const lines = runs.map((r, i) => {
        const color = RUN_LABEL_COLORS[i % RUN_LABEL_COLORS.length];
        return `<span class="stat-run-line"><span class="stat-run-label" style="color:${color}">${r.name}:</span> ${stat.extract(r.result.summary)}</span>`;
      });
      el.innerHTML = lines.join('');
    }

    // Highlight drops based on latest run
    const latest = runs[runs.length - 1].result.summary;
    const droppedEl = document.getElementById('stat-dropped');
    if (droppedEl) droppedEl.classList.toggle('danger', latest.total_dropped > 0);
    const dropRateEl = document.getElementById('stat-drop-rate');
    if (dropRateEl) dropRateEl.classList.toggle('danger', latest.drop_rate_percent > 1);
  }

  // --- Decision Log ---

  private classifyLog(msg: string): { type: string; category: string } {
    if (msg.startsWith('Scaled up')) return { type: 'scale-up', category: 'scale' };
    if (msg.startsWith('Scaled down')) return { type: 'scale-down', category: 'scale' };
    if (msg.startsWith('Scale-up needed but cooldown')) return { type: 'cooldown', category: 'scale' };
    if (msg.startsWith('At max replicas')) return { type: 'max-replicas', category: 'scale' };
    if (msg.startsWith('Already at min replicas')) return { type: 'min-replicas', category: 'scale' };
    if (msg.includes('finished starting')) return { type: 'ready', category: 'lifecycle' };
    if (msg.includes('graceful shutdown')) return { type: 'shutdown', category: 'lifecycle' };
    if (msg.includes('failure') || msg.includes('killed')) return { type: 'failure', category: 'failures' };
    if (msg.startsWith('Dropping')) return { type: 'drop', category: 'traffic' };
    if (msg.startsWith('Recovered')) return { type: 'recover', category: 'traffic' };
    if (msg.startsWith('Expired')) return { type: 'expired', category: 'traffic' };
    if (msg.startsWith('Saturation')) return { type: 'backpressure', category: 'traffic' };
    if (msg.includes('will retry')) return { type: 'retry', category: 'traffic' };
    return { type: 'info', category: 'scale' };
  }

  private renderLog(snapshots: TickSnapshot[], runId: string | null): void {
    const container = document.getElementById('log-entries');
    const countEl = document.getElementById('log-count');
    if (!container) return;

    container.innerHTML = '';
    this.updateRunFilter([]);
    let eventCount = 0;

    for (const snap of snapshots) {
      if (snap.log_entries.length === 0) continue;
      for (const msg of snap.log_entries) {
        eventCount++;
        this.appendLogLine(container, snap.time, msg, null, runId);
      }
    }

    if (countEl) countEl.textContent = `${eventCount} events`;
    this.applyLogFilters();
  }

  private renderMultiRunLog(runs: { name: string; result: SimulationResult }[]): void {
    const container = document.getElementById('log-entries');
    const countEl = document.getElementById('log-count');
    if (!container) return;

    container.innerHTML = '';
    const runNames = runs.map(r => r.name);
    this.updateRunFilter(runNames);
    let eventCount = 0;

    runs.forEach((run, i) => {
      for (const snap of run.result.snapshots) {
        if (snap.log_entries.length === 0) continue;
        for (const msg of snap.log_entries) {
          eventCount++;
          this.appendLogLine(container, snap.time, msg, run.name, run.result.run_id, i);
        }
      }
    });

    if (countEl) countEl.textContent = `${eventCount} events`;
    this.applyLogFilters();
  }

  private appendLogLine(container: HTMLElement, time: number, msg: string, runLabel: string | null, runId: string | null = null, runIndex: number = -1): void {
    const { type, category } = this.classifyLog(msg);
    const line = document.createElement('div');
    line.className = 'log-line';
    line.dataset.type = type;
    line.dataset.category = category;
    if (runLabel) line.dataset.run = runLabel;
    if (runId) line.dataset.runId = runId;

    const timeStr = time >= 3600
      ? `${Math.floor(time / 3600)}h${Math.floor((time % 3600) / 60).toString().padStart(2, '0')}m${(time % 60).toString().padStart(2, '0')}s`
      : time >= 60
        ? `${Math.floor(time / 60)}m${(time % 60).toString().padStart(2, '0')}s`
        : `${time}s`;

    let runCol = '';
    if (runLabel) {
      const colorStyle = runIndex >= 0 ? ` style="color:${RUN_LABEL_COLORS[runIndex % RUN_LABEL_COLORS.length]}"` : '';
      runCol = `<span class="log-run"${colorStyle}>${runLabel}</span>`;
    }
    const idCol = runId ? `<span class="log-run-id">${runId}</span>` : '';
    line.innerHTML = `${runCol}${idCol}<span class="log-time">${timeStr}</span><span class="log-msg">${msg}</span>`;
    container.appendChild(line);
  }

  private updateRunFilter(runNames: string[]): void {
    const filterContainer = document.getElementById('log-run-filter-container');
    const select = document.getElementById('log-run-filter') as HTMLSelectElement;
    if (!filterContainer || !select) return;

    if (runNames.length <= 1) {
      filterContainer.classList.add('hidden');
      select.innerHTML = '<option value="all">All Runs</option>';
      return;
    }

    filterContainer.classList.remove('hidden');
    select.innerHTML = '<option value="all">All Runs</option>';
    runNames.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      opt.style.color = RUN_LABEL_COLORS[i % RUN_LABEL_COLORS.length];
      select.appendChild(opt);
    });
  }

  private applyLogFilters(): void {
    const filters: Record<string, boolean> = {
      scale: (document.getElementById('log-filter-scale') as HTMLInputElement)?.checked ?? true,
      lifecycle: (document.getElementById('log-filter-lifecycle') as HTMLInputElement)?.checked ?? true,
      failures: (document.getElementById('log-filter-failures') as HTMLInputElement)?.checked ?? true,
      traffic: (document.getElementById('log-filter-traffic') as HTMLInputElement)?.checked ?? true,
    };

    const runFilter = (document.getElementById('log-run-filter') as HTMLSelectElement)?.value || 'all';

    const lines = document.querySelectorAll('.log-line');
    for (const line of lines) {
      const el = line as HTMLElement;
      const cat = el.dataset.category || 'scale';
      const run = el.dataset.run || '';
      const categoryMatch = filters[cat];
      const runMatch = runFilter === 'all' || run === runFilter;
      el.style.display = (categoryMatch && runMatch) ? '' : 'none';
    }
  }

  private getLogText(): string {
    const lines = document.querySelectorAll('.log-line');
    const parts: string[] = [];
    for (const line of lines) {
      const el = line as HTMLElement;
      if (el.style.display === 'none') continue;
      const run = el.querySelector('.log-run')?.textContent || '';
      const runId = el.querySelector('.log-run-id')?.textContent || '';
      const time = el.querySelector('.log-time')?.textContent || '';
      const msg = el.querySelector('.log-msg')?.textContent || '';
      const prefix = run ? `[${run}] ` : '';
      const idPrefix = runId ? `[${runId}] ` : '';
      parts.push(`${prefix}${idPrefix}[${time}] ${msg}`);
    }
    return parts.join('\n');
  }

  // --- Export / Import ---

  private exportSourceConfig(): void {
    const config = this.controls.getConfig();
    const yaml = this.services.config.export(config);
    this.showExportOutput(yaml, 'simulation.scalings.yaml');
    this.offerDownload(yaml, 'simulation.scalings.yaml', 'text/yaml');
  }

  private async importSourceConfig(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    await this.readAndImportFile(file);
    input.value = ''; // Reset for re-upload
  }

  private async readAndImportFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const config = this.services.config.import(text);
      this.controls.setConfig(config);
      this.services.config.saveLocal(config);
      this.showSuccess('Configuration imported successfully!');
    } catch (err) {
      this.showError('Import failed: ' + (err instanceof Error ? err.message : 'Invalid YAML'));
    }
  }

  private copyShareURL(): void {
    const config = this.controls.getConfig();
    const hash = this.services.config.toURL(config);
    const url = window.location.origin + window.location.pathname + hash;
    navigator.clipboard.writeText(url).then(() => {
      this.showSuccess('Share URL copied to clipboard!');
    }).catch(() => {
      // Fallback: show in export area
      this.showExportOutput(url, 'Share URL');
    });
  }

  private generateDeployConfig(): void {
    const config = this.controls.getConfig();
    const target = this.services.export.generate(config);
    this.showExportOutput(target.content, `${config.platform}-config`);
  }

  private parseHeaders(raw: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (key) headers[key] = value;
      }
    }
    return headers;
  }

  private generateLoadTestScript(): void {
    const config = this.controls.getConfig();
    const targetUrl = (document.getElementById('loadtest-target-url') as HTMLInputElement)?.value || 'https://api.example.com/endpoint';
    const avgResponseTimeMs = parseFloat((document.getElementById('loadtest-avg-response') as HTMLInputElement)?.value || '100');
    const method = ((document.getElementById('loadtest-method') as HTMLSelectElement)?.value || 'GET') as HttpMethod;
    const headersRaw = (document.getElementById('loadtest-headers') as HTMLTextAreaElement)?.value || '';
    const body = (document.getElementById('loadtest-body') as HTMLTextAreaElement)?.value || '';

    const request: LoadTestRequestConfig = {
      method,
      headers: this.parseHeaders(headersRaw),
      body,
    };

    // Run validation
    const validation = this.services.loadTestExport.validate(config, this.selectedFramework);
    const warningsEl = document.getElementById('loadtest-warnings');
    if (warningsEl) {
      if (validation.warnings.length > 0) {
        warningsEl.innerHTML = validation.warnings
          .map(w => `<div class="loadtest-warning-item">\u26A0 ${w}</div>`)
          .join('');
        warningsEl.classList.remove('hidden');
      } else {
        warningsEl.classList.add('hidden');
      }
    }

    if (!validation.valid) {
      this.showError('Cannot generate: ' + validation.errors.join('; '));
      return;
    }

    const script = this.services.loadTestExport.generate(config, {
      framework: this.selectedFramework,
      targetUrl,
      avgResponseTimeMs,
      request,
    }, this.lastResult || undefined);

    // Show output
    const container = document.getElementById('loadtest-output');
    const code = document.getElementById('loadtest-code');
    const label = document.getElementById('loadtest-label');
    const exporter = this.services.loadTestExport.getExporter(this.selectedFramework);

    if (container) container.classList.remove('hidden');
    if (code) code.textContent = script;
    if (label) label.textContent = `${exporter.name} script`;
  }

  private downloadLoadTestScript(): void {
    const code = document.getElementById('loadtest-code');
    if (!code || !code.textContent) return;

    const exporter = this.services.loadTestExport.getExporter(this.selectedFramework);
    const filenames: Record<string, string> = {
      k6: 'scalings-loadtest.js',
      gatling: 'ScalingsSimulation.java',
      locust: 'scalings_loadtest.py',
      jmeter: 'scalings-loadtest.jmx',
      artillery: 'scalings-loadtest.yml',
    };
    const mimeTypes: Record<string, string> = {
      k6: 'application/javascript',
      gatling: 'text/x-java-source',
      locust: 'text/x-python',
      jmeter: 'application/xml',
      artillery: 'text/yaml',
    };

    const filename = filenames[this.selectedFramework] || `scalings-loadtest.${exporter.extension}`;
    const mimeType = mimeTypes[this.selectedFramework] || 'text/plain';
    this.offerDownload(code.textContent, filename, mimeType);
  }

  private copyExportOutput(): void {
    const output = document.getElementById('export-code');
    if (output) {
      navigator.clipboard.writeText(output.textContent || '').then(() => {
        this.showSuccess('Copied to clipboard!');
      });
    }
  }

  private showExportOutput(content: string, title: string): void {
    const container = document.getElementById('export-output');
    const code = document.getElementById('export-code');
    const label = document.getElementById('export-label');

    if (container) container.classList.remove('hidden');
    if (code) code.textContent = content;
    if (label) label.textContent = title;
  }

  // --- Run export / import ---

  private exportRuns(): void {
    if (this.recordedRuns.length === 0) {
      this.showError('No recorded runs to export');
      return;
    }
    const json = JSON.stringify(this.recordedRuns, null, 2);
    this.offerDownload(json, 'simulation-runs.json', 'application/json');
    this.showToast(`Exported ${this.recordedRuns.length} run(s)`, 'success');
  }

  private async importRuns(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;

    try {
      const text = await input.files[0].text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('File must contain a non-empty array of runs');
      }
      // Validate shape: each entry needs name + result with snapshots and summary
      for (const run of parsed) {
        if (!run.name || !run.result?.snapshots || !run.result?.summary) {
          throw new Error('Invalid run format: each entry needs name, result.snapshots, result.summary');
        }
      }

      // Enable recording mode if not already
      const recordToggle = document.getElementById('record-runs') as HTMLInputElement;
      if (recordToggle && !recordToggle.checked) {
        recordToggle.checked = true;
        recordToggle.dispatchEvent(new Event('change'));
      }

      // Append imported runs
      this.recordedRuns = parsed;
      this.runCounter = parsed.length;

      // Re-render chart, summary, and log
      this.chart.renderMultiRun('sim-chart', this.recordedRuns);
      this.renderMultiRunSummary(this.recordedRuns);
      this.renderMultiRunLog(this.recordedRuns);

      // Show results section
      const placeholder = document.getElementById('sim-placeholder');
      const resultsContent = document.getElementById('sim-results-content');
      if (placeholder) placeholder.classList.add('hidden');
      if (resultsContent) resultsContent.classList.remove('hidden');

      this.showToast(`Imported ${parsed.length} run(s)`, 'success');
    } catch (err) {
      this.showError('Import failed: ' + (err instanceof Error ? err.message : 'Invalid JSON'));
    }
    input.value = ''; // Reset for re-upload
  }

  // --- State management ---

  private loadState(): void {
    const saved = this.services.config.loadLocal();
    if (saved) {
      this.controls.setConfig(saved);
    }
  }

  private checkURLConfig(): void {
    const hash = window.location.hash;
    if (hash && hash.includes('config=')) {
      try {
        const config = this.services.config.fromURL(hash);
        this.controls.setConfig(config);
        this.services.config.saveLocal(config);
        this.showSuccess('Configuration loaded from URL!');

        // Auto-run if specified
        if (hash.includes('autorun=true')) {
          setTimeout(() => this.runSimulation(), 500);
        }
      } catch (err) {
        this.showError('Failed to load configuration from URL');
      }
    }
  }

  // --- UI helpers ---

  private setSummaryValue(id: string, value: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return Math.round(n).toLocaleString();
  }

  private offerDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private showSuccess(message: string): void {
    this.showToast(message, 'success');
  }

  private showError(message: string): void {
    this.showToast(message, 'error');
  }

  private showToast(message: string, type: 'success' | 'error'): void {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// --- Bootstrap ---
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
