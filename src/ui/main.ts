// ============================================================================
// scalings.xyz — Main Application Entry Point
// ============================================================================

import { createServices, ServiceContainer } from '../factory.js';
import { SimulationConfig, SimulationResult, SimulationSummary } from '../interfaces/types.js';
import { UIControls } from './controls.js';
import { ChartRenderer } from './chart.js';

class App {
  private services: ServiceContainer;
  private controls: UIControls;
  private chart: ChartRenderer;
  private lastResult: SimulationResult | null = null;
  private compareResult: SimulationResult | null = null;
  private isCompareMode: boolean = false;
  private isSimulating: boolean = false;

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

    // Compare mode toggle
    const compareToggle = document.getElementById('compare-mode') as HTMLInputElement;
    if (compareToggle) {
      compareToggle.addEventListener('change', () => {
        this.isCompareMode = compareToggle.checked;
        this.updateCompareUI();
      });
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
        document.getElementById('param-cost_per_replica_hour')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('param-cost_per_replica_hour')?.focus();
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

      if (this.isCompareMode && this.lastResult) {
        // Store previous result for comparison
        this.compareResult = this.lastResult;
      }

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
      if (this.isCompareMode && this.compareResult) {
        this.chart.renderCompare('sim-chart', this.compareResult, result);
        this.renderCompareSummary(this.compareResult.summary, result.summary);
      } else {
        const speed = parseFloat((document.getElementById('playback-speed') as HTMLInputElement)?.value || '5');
        await this.chart.renderAnimated('sim-chart', result, speed);
      }

      this.renderSummary(result.summary);

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

  private renderSummary(summary: SimulationSummary): void {
    this.setSummaryValue('stat-total-requests', this.formatNumber(summary.total_requests));
    this.setSummaryValue('stat-served', this.formatNumber(summary.total_served));
    this.setSummaryValue('stat-dropped', this.formatNumber(summary.total_dropped));
    this.setSummaryValue('stat-drop-rate', `${summary.drop_rate_percent.toFixed(2)}%`);
    this.setSummaryValue('stat-peak-pods', summary.peak_pod_count.toString());
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

  private renderCompareSummary(summaryA: SimulationSummary, summaryB: SimulationSummary): void {
    const container = document.getElementById('compare-results');
    if (!container) return;

    container.classList.remove('hidden');
    container.innerHTML = `
      <h3 class="section-heading">Comparison Results</h3>
      <div class="compare-grid">
        <div class="compare-header"><span></span><span>Config A</span><span>Config B</span><span>Diff</span></div>
        ${this.compareRow('Drop Rate', `${summaryA.drop_rate_percent.toFixed(2)}%`, `${summaryB.drop_rate_percent.toFixed(2)}%`, summaryB.drop_rate_percent - summaryA.drop_rate_percent, '%', true)}
        ${this.compareRow('Peak Pods', summaryA.peak_pod_count.toString(), summaryB.peak_pod_count.toString(), summaryB.peak_pod_count - summaryA.peak_pod_count)}
        ${this.compareRow('Dropped', this.formatNumber(summaryA.total_dropped), this.formatNumber(summaryB.total_dropped), summaryB.total_dropped - summaryA.total_dropped, '', true)}
        ${this.compareRow('Cost*', `$${summaryA.estimated_total_cost.toFixed(4)}`, `$${summaryB.estimated_total_cost.toFixed(4)}`, summaryB.estimated_total_cost - summaryA.estimated_total_cost, '$', true)}
        ${this.compareRow('Under-prov', `${summaryA.time_under_provisioned_percent.toFixed(1)}%`, `${summaryB.time_under_provisioned_percent.toFixed(1)}%`, summaryB.time_under_provisioned_percent - summaryA.time_under_provisioned_percent, '%', true)}
      </div>
      <div class="stat-hint" style="text-align:right;margin-top:0.4rem;">*Cost based on Advanced settings</div>
    `;
  }

  private compareRow(label: string, a: string, b: string, diff: number, unit: string = '', lowerBetter: boolean = false): string {
    const sign = diff > 0 ? '+' : '';
    const cls = lowerBetter ? (diff < 0 ? 'better' : diff > 0 ? 'worse' : '') : (diff > 0 ? 'better' : diff < 0 ? 'worse' : '');
    const formattedDiff = unit === '$' ? `${sign}$${Math.abs(diff).toFixed(4)}` : `${sign}${diff.toFixed(2)}${unit}`;
    return `<div class="compare-row"><span class="compare-label">${label}</span><span>${a}</span><span>${b}</span><span class="${cls}">${formattedDiff}</span></div>`;
  }

  private updateCompareUI(): void {
    const compareResults = document.getElementById('compare-results');
    if (!this.isCompareMode && compareResults) {
      compareResults.classList.add('hidden');
    }
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
