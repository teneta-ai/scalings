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
        this.runCounter = 0;
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
        const exportRunsBtn = document.getElementById('btn-export-runs');
        const importRunsBtn = document.getElementById('btn-import-runs');
        const importRunsInput = document.getElementById('import-runs-input');
        const runButtons = [purgeBtn, exportRunsBtn];
        if (recordToggle) {
            recordToggle.addEventListener('change', () => {
                this.isRecording = recordToggle.checked;
                for (const btn of runButtons) {
                    if (btn)
                        btn.classList.toggle('hidden', !this.isRecording);
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
                if (arrow)
                    arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
            });
        }
        // Log filters
        for (const id of ['log-filter-scale', 'log-filter-lifecycle', 'log-filter-failures', 'log-filter-traffic']) {
            const el = document.getElementById(id);
            if (el)
                el.addEventListener('change', () => this.applyLogFilters());
        }
        const runFilterEl = document.getElementById('log-run-filter');
        if (runFilterEl)
            runFilterEl.addEventListener('change', () => this.applyLogFilters());
        // Log copy & download
        const logCopyBtn = document.getElementById('btn-log-copy');
        if (logCopyBtn) {
            logCopyBtn.addEventListener('click', () => {
                const text = this.getLogText();
                if (!text)
                    return;
                navigator.clipboard.writeText(text).then(() => this.showToast('Log copied to clipboard', 'success'));
            });
        }
        const logDownloadBtn = document.getElementById('btn-log-download');
        if (logDownloadBtn) {
            logDownloadBtn.addEventListener('click', () => {
                const text = this.getLogText();
                if (!text)
                    return;
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
            this.runCounter++;
            if (this.isRecording) {
                this.renderMultiRunSummary(this.recordedRuns);
                this.renderMultiRunLog(this.recordedRuns);
            }
            else {
                this.renderSummary(result.summary);
                this.renderLog(result.snapshots, null);
            }
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
        // Queue stat visibility
        const queueStatCard = document.getElementById('stat-card-peak-queue');
        if (queueStatCard) {
            if (summary.peak_queue_depth > 0) {
                queueStatCard.classList.remove('hidden');
                this.setSummaryValue('stat-peak-queue', this.formatNumber(summary.peak_queue_depth));
            }
            else {
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
            }
            else {
                waitStatCard.classList.add('hidden');
            }
        }
        // Expired requests stat
        const expiredStatCard = document.getElementById('stat-card-expired');
        if (expiredStatCard) {
            if (summary.total_expired > 0) {
                expiredStatCard.classList.remove('hidden');
                this.setSummaryValue('stat-expired', this.formatNumber(summary.total_expired));
            }
            else {
                expiredStatCard.classList.add('hidden');
            }
        }
        // Retry traffic stat
        const retriesStatCard = document.getElementById('stat-card-retries');
        if (retriesStatCard) {
            if (summary.total_retries > 0) {
                retriesStatCard.classList.remove('hidden');
                this.setSummaryValue('stat-retries', this.formatNumber(summary.total_retries));
            }
            else {
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
    renderMultiRunSummary(runs) {
        const stats = [
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
                    const anyVisible = runs.some(r => stat.showIf(r.result.summary));
                    card.classList.toggle('hidden', !anyVisible);
                    if (!anyVisible)
                        continue;
                }
            }
            const el = document.getElementById(stat.id);
            if (!el)
                continue;
            const lines = runs.map(r => `<span class="stat-run-line"><span class="stat-run-label">${r.name}:</span> ${stat.extract(r.result.summary)}</span>`);
            el.innerHTML = lines.join('');
        }
        // Highlight drops based on latest run
        const latest = runs[runs.length - 1].result.summary;
        const droppedEl = document.getElementById('stat-dropped');
        if (droppedEl)
            droppedEl.classList.toggle('danger', latest.total_dropped > 0);
        const dropRateEl = document.getElementById('stat-drop-rate');
        if (dropRateEl)
            dropRateEl.classList.toggle('danger', latest.drop_rate_percent > 1);
    }
    // --- Decision Log ---
    classifyLog(msg) {
        if (msg.startsWith('Scaled up'))
            return { type: 'scale-up', category: 'scale' };
        if (msg.startsWith('Scaled down'))
            return { type: 'scale-down', category: 'scale' };
        if (msg.startsWith('Scale-up needed but cooldown'))
            return { type: 'cooldown', category: 'scale' };
        if (msg.startsWith('At max replicas'))
            return { type: 'max-replicas', category: 'scale' };
        if (msg.startsWith('Already at min replicas'))
            return { type: 'min-replicas', category: 'scale' };
        if (msg.includes('finished starting'))
            return { type: 'ready', category: 'lifecycle' };
        if (msg.includes('graceful shutdown'))
            return { type: 'shutdown', category: 'lifecycle' };
        if (msg.includes('failure') || msg.includes('killed'))
            return { type: 'failure', category: 'failures' };
        if (msg.startsWith('Dropping'))
            return { type: 'drop', category: 'traffic' };
        if (msg.startsWith('Recovered'))
            return { type: 'recover', category: 'traffic' };
        if (msg.startsWith('Expired'))
            return { type: 'expired', category: 'traffic' };
        if (msg.startsWith('Saturation'))
            return { type: 'backpressure', category: 'traffic' };
        if (msg.includes('will retry'))
            return { type: 'retry', category: 'traffic' };
        return { type: 'info', category: 'scale' };
    }
    renderLog(snapshots, runName) {
        const container = document.getElementById('log-entries');
        const countEl = document.getElementById('log-count');
        if (!container)
            return;
        container.innerHTML = '';
        this.updateRunFilter(runName ? [runName] : []);
        let eventCount = 0;
        for (const snap of snapshots) {
            if (snap.log_entries.length === 0)
                continue;
            for (const msg of snap.log_entries) {
                eventCount++;
                this.appendLogLine(container, snap.time, msg, runName);
            }
        }
        if (countEl)
            countEl.textContent = `${eventCount} events`;
        this.applyLogFilters();
    }
    renderMultiRunLog(runs) {
        const container = document.getElementById('log-entries');
        const countEl = document.getElementById('log-count');
        if (!container)
            return;
        container.innerHTML = '';
        const runNames = runs.map(r => r.name);
        this.updateRunFilter(runNames);
        let eventCount = 0;
        for (const run of runs) {
            for (const snap of run.result.snapshots) {
                if (snap.log_entries.length === 0)
                    continue;
                for (const msg of snap.log_entries) {
                    eventCount++;
                    this.appendLogLine(container, snap.time, msg, run.name);
                }
            }
        }
        if (countEl)
            countEl.textContent = `${eventCount} events`;
        this.applyLogFilters();
    }
    appendLogLine(container, time, msg, runName) {
        const { type, category } = this.classifyLog(msg);
        const line = document.createElement('div');
        line.className = 'log-line';
        line.dataset.type = type;
        line.dataset.category = category;
        if (runName)
            line.dataset.run = runName;
        const timeStr = time >= 3600
            ? `${Math.floor(time / 3600)}h${Math.floor((time % 3600) / 60).toString().padStart(2, '0')}m${(time % 60).toString().padStart(2, '0')}s`
            : time >= 60
                ? `${Math.floor(time / 60)}m${(time % 60).toString().padStart(2, '0')}s`
                : `${time}s`;
        const runCol = runName ? `<span class="log-run">${runName}</span>` : '';
        line.innerHTML = `${runCol}<span class="log-time">${timeStr}</span><span class="log-msg">${msg}</span>`;
        container.appendChild(line);
    }
    updateRunFilter(runNames) {
        const filterContainer = document.getElementById('log-run-filter-container');
        const select = document.getElementById('log-run-filter');
        if (!filterContainer || !select)
            return;
        if (runNames.length <= 1) {
            filterContainer.classList.add('hidden');
            select.innerHTML = '<option value="all">All Runs</option>';
            return;
        }
        filterContainer.classList.remove('hidden');
        select.innerHTML = '<option value="all">All Runs</option>';
        for (const name of runNames) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        }
    }
    applyLogFilters() {
        const filters = {
            scale: document.getElementById('log-filter-scale')?.checked ?? true,
            lifecycle: document.getElementById('log-filter-lifecycle')?.checked ?? true,
            failures: document.getElementById('log-filter-failures')?.checked ?? true,
            traffic: document.getElementById('log-filter-traffic')?.checked ?? true,
        };
        const runFilter = document.getElementById('log-run-filter')?.value || 'all';
        const lines = document.querySelectorAll('.log-line');
        for (const line of lines) {
            const el = line;
            const cat = el.dataset.category || 'scale';
            const run = el.dataset.run || '';
            const categoryMatch = filters[cat];
            const runMatch = runFilter === 'all' || run === runFilter;
            el.style.display = (categoryMatch && runMatch) ? '' : 'none';
        }
    }
    getLogText() {
        const lines = document.querySelectorAll('.log-line');
        const parts = [];
        for (const line of lines) {
            const el = line;
            if (el.style.display === 'none')
                continue;
            const run = el.querySelector('.log-run')?.textContent || '';
            const time = el.querySelector('.log-time')?.textContent || '';
            const msg = el.querySelector('.log-msg')?.textContent || '';
            const prefix = run ? `[${run}] ` : '';
            parts.push(`${prefix}[${time}] ${msg}`);
        }
        return parts.join('\n');
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
    // --- Run export / import ---
    exportRuns() {
        if (this.recordedRuns.length === 0) {
            this.showError('No recorded runs to export');
            return;
        }
        const json = JSON.stringify(this.recordedRuns, null, 2);
        this.offerDownload(json, 'simulation-runs.json', 'application/json');
        this.showToast(`Exported ${this.recordedRuns.length} run(s)`, 'success');
    }
    async importRuns(e) {
        const input = e.target;
        if (!input.files?.length)
            return;
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
            const recordToggle = document.getElementById('record-runs');
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
            if (placeholder)
                placeholder.classList.add('hidden');
            if (resultsContent)
                resultsContent.classList.remove('hidden');
            this.showToast(`Imported ${parsed.length} run(s)`, 'success');
        }
        catch (err) {
            this.showError('Import failed: ' + (err instanceof Error ? err.message : 'Invalid JSON'));
        }
        input.value = ''; // Reset for re-upload
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