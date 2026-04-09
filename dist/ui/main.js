// ============================================================================
// scalings.xyz — Main Application Entry Point
// ============================================================================
import { createServices } from '../factory.js';
import { UIControls } from './controls.js';
import { ChartRenderer } from './chart.js';
class App {
    constructor() {
        this.isSimulating = false;
        this.isRecording = false;
        this.recordedRuns = [];
        this.services = createServices();
        this.controls = new UIControls(this.services.traffic);
        this.chart = new ChartRenderer();
    }
    init() {
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
    bindButtons() {
        // Simulate button
        const simBtn = document.getElementById('btn-simulate');
        if (simBtn) {
            simBtn.addEventListener('click', () => this.runSimulation());
        }
        // Record runs toggle
        const recordToggle = document.getElementById('record-runs');
        const purgeBtn = document.getElementById('btn-purge-runs');
        if (recordToggle) {
            recordToggle.addEventListener('change', () => {
                this.isRecording = recordToggle.checked;
                if (purgeBtn)
                    purgeBtn.classList.toggle('hidden', !this.isRecording);
                if (!this.isRecording)
                    this.recordedRuns = [];
            });
        }
        if (purgeBtn) {
            purgeBtn.addEventListener('click', () => {
                this.recordedRuns = [];
                this.showToast('All recorded runs cleared', 'success');
            });
        }
        // Export source config
        const exportBtn = document.getElementById('btn-export-yaml');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportSourceConfig());
        }
        // Import source config
        const importBtn = document.getElementById('btn-import-yaml');
        const fileInput = document.getElementById('import-file-input');
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
        // Playback speed
        const speedSlider = document.getElementById('playback-speed');
        const speedValue = document.getElementById('playback-speed-value');
        if (speedSlider) {
            speedSlider.addEventListener('input', () => {
                const speed = parseFloat(speedSlider.value);
                this.chart.setPlaybackSpeed(speed);
                if (speedValue)
                    speedValue.textContent = `${speed}x`;
            });
        }
        // Traffic toggle
        const trafficToggle = document.getElementById('traffic-toggle');
        const trafficContent = document.getElementById('traffic-content');
        const trafficPreview = document.querySelector('#traffic-section .traffic-preview');
        const toggleTraffic = () => {
            if (!trafficToggle || !trafficContent)
                return;
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
        if (trafficToggle)
            trafficToggle.addEventListener('click', toggleTraffic);
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
            if (!docsToggle || !docsContent)
                return;
            docsContent.classList.toggle('collapsed');
            docsToggle.classList.toggle('expanded');
            const isExpanded = !docsContent.classList.contains('collapsed');
            docsToggle.setAttribute('aria-expanded', String(isExpanded));
            const arrow = docsToggle.querySelector('.toggle-arrow');
            if (arrow) {
                arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
            }
        };
        if (docsToggle)
            docsToggle.addEventListener('click', expandDocs);
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
    async runSimulation() {
        if (this.isSimulating)
            return;
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
            // Show results, hide placeholder
            const placeholder = document.getElementById('sim-placeholder');
            const resultsContent = document.getElementById('sim-results-content');
            if (placeholder)
                placeholder.classList.add('hidden');
            if (resultsContent)
                resultsContent.classList.remove('hidden');
            if (outputSection) {
                outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            // Render chart
            if (this.isRecording) {
                const runName = `Run ${this.recordedRuns.length + 1}`;
                this.recordedRuns.push({ name: runName, result });
                this.chart.renderMultiRun('sim-chart', this.recordedRuns);
            }
            else {
                const speed = parseFloat(document.getElementById('playback-speed')?.value || '5');
                await this.chart.renderAnimated('sim-chart', result, speed);
            }
            this.renderSummary(result.summary);
        }
        catch (err) {
            console.error('Simulation error:', err);
            this.showError('Simulation failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
        finally {
            this.isSimulating = false;
            document.body.classList.remove('simulating');
            if (simBtn) {
                simBtn.textContent = 'Simulate';
                simBtn.classList.remove('running');
            }
        }
    }
    renderSummary(summary) {
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
    // --- Export / Import ---
    exportSourceConfig() {
        const config = this.controls.getConfig();
        const yaml = this.services.config.export(config);
        this.showExportOutput(yaml, 'simulation.scalings.yaml');
        this.offerDownload(yaml, 'simulation.scalings.yaml', 'text/yaml');
    }
    async importSourceConfig(e) {
        const input = e.target;
        if (!input.files?.length)
            return;
        const file = input.files[0];
        await this.readAndImportFile(file);
        input.value = ''; // Reset for re-upload
    }
    async readAndImportFile(file) {
        try {
            const text = await file.text();
            const config = this.services.config.import(text);
            this.controls.setConfig(config);
            this.services.config.saveLocal(config);
            this.showSuccess('Configuration imported successfully!');
        }
        catch (err) {
            this.showError('Import failed: ' + (err instanceof Error ? err.message : 'Invalid YAML'));
        }
    }
    copyShareURL() {
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
    generateDeployConfig() {
        const config = this.controls.getConfig();
        const target = this.services.export.generate(config);
        this.showExportOutput(target.content, `${config.platform}-config`);
    }
    copyExportOutput() {
        const output = document.getElementById('export-code');
        if (output) {
            navigator.clipboard.writeText(output.textContent || '').then(() => {
                this.showSuccess('Copied to clipboard!');
            });
        }
    }
    showExportOutput(content, title) {
        const container = document.getElementById('export-output');
        const code = document.getElementById('export-code');
        const label = document.getElementById('export-label');
        if (container)
            container.classList.remove('hidden');
        if (code)
            code.textContent = content;
        if (label)
            label.textContent = title;
    }
    // --- State management ---
    loadState() {
        const saved = this.services.config.loadLocal();
        if (saved) {
            this.controls.setConfig(saved);
        }
    }
    checkURLConfig() {
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
            }
            catch (err) {
                this.showError('Failed to load configuration from URL');
            }
        }
    }
    // --- UI helpers ---
    setSummaryValue(id, value) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = value;
    }
    formatNumber(n) {
        if (n >= 1000000)
            return `${(n / 1000000).toFixed(2)}M`;
        if (n >= 1000)
            return `${(n / 1000).toFixed(1)}K`;
        return Math.round(n).toLocaleString();
    }
    offerDownload(content, filename, mimeType) {
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
    showSuccess(message) {
        this.showToast(message, 'success');
    }
    showError(message) {
        this.showToast(message, 'error');
    }
    showToast(message, type) {
        const existing = document.querySelector('.toast');
        if (existing)
            existing.remove();
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
//# sourceMappingURL=main.js.map