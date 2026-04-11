// ============================================================================
// scalings.xyz — Chart Rendering and Animation
// ============================================================================
// --- Exported formatting helpers (testable without DOM/Chart.js) ---
/** Format seconds into M:SS display string */
export function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
/** Format a tooltip label based on dataset type */
export function formatTooltipLabel(datasetLabel, value) {
    if (datasetLabel.includes('Pods'))
        return ` ${datasetLabel}: ${value}`;
    if (datasetLabel.includes('Wait'))
        return ` ${datasetLabel}: ${value >= 1000 ? (value / 1000).toFixed(1) + 's' : Math.round(value) + 'ms'}`;
    return ` ${datasetLabel}: ${Math.round(value).toLocaleString()}`;
}
const COLORS = {
    traffic: 'rgba(0, 212, 255, 0.9)',
    trafficFill: 'rgba(0, 212, 255, 0.15)',
    capacity: 'rgba(132, 204, 22, 0.9)',
    capacityGreen: 'rgba(132, 204, 22, 0.9)',
    capacityRed: 'rgba(239, 68, 68, 0.9)',
    pods: 'rgba(179, 71, 217, 0.9)',
    dropped: 'rgba(239, 68, 68, 0.9)',
    droppedFill: 'rgba(239, 68, 68, 0.25)',
    queue: 'rgba(251, 191, 36, 0.9)',
    queueFill: 'rgba(251, 191, 36, 0.15)',
    effectiveCapacity: 'rgba(251, 146, 60, 0.9)',
    waitTime: 'rgba(244, 114, 182, 0.9)',
    waitTimeFill: 'rgba(244, 114, 182, 0.15)',
};
export class ChartRenderer {
    constructor() {
        this.chart = null;
        this.animationFrame = 0;
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playbackSpeed = 5;
        this.result = null;
        this.onAnimationTick = null;
        /** Maps dataset labels to their index in the current chart for safe lookup. */
        this.datasetIndex = new Map();
    }
    setPlaybackSpeed(speed) {
        this.playbackSpeed = speed;
    }
    setAnimationCallback(cb) {
        this.onAnimationTick = cb;
    }
    // --- Shared chart building blocks ---
    buildScales() {
        return {
            x: {
                ticks: {
                    color: '#64748b',
                    font: { family: "'JetBrains Mono', monospace", size: 10 },
                    maxTicksLimit: 20,
                    maxRotation: 0,
                },
                grid: { color: 'rgba(100, 116, 139, 0.1)' },
            },
            y: {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Requests / Second',
                    color: '#64748b',
                    font: { family: "'JetBrains Mono', monospace", size: 11 },
                },
                ticks: {
                    color: '#64748b',
                    font: { family: "'JetBrains Mono', monospace", size: 10 },
                    callback: (val) => val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val,
                },
                grid: { color: 'rgba(100, 116, 139, 0.1)' },
                beginAtZero: true,
            },
            y1: {
                type: 'linear',
                position: 'right',
                title: {
                    display: true,
                    text: 'Pod Count',
                    color: '#b347d9',
                    font: { family: "'JetBrains Mono', monospace", size: 11 },
                },
                ticks: {
                    color: '#b347d9',
                    font: { family: "'JetBrains Mono', monospace", size: 10 },
                    stepSize: 1,
                },
                grid: { drawOnChartArea: false },
                beginAtZero: true,
            },
            y2: {
                type: 'linear',
                position: 'right',
                display: false, // only shown when wait time dataset exists
                title: {
                    display: true,
                    text: 'Wait Time (ms)',
                    color: COLORS.waitTime,
                    font: { family: "'JetBrains Mono', monospace", size: 11 },
                },
                ticks: {
                    color: COLORS.waitTime,
                    font: { family: "'JetBrains Mono', monospace", size: 10 },
                    callback: (val) => val >= 1000 ? `${(val / 1000).toFixed(1)}s` : `${val}ms`,
                },
                grid: { drawOnChartArea: false },
                beginAtZero: true,
            },
        };
    }
    buildPlugins() {
        const tooltip = {
            backgroundColor: 'rgba(10, 14, 26, 0.95)',
            titleColor: '#00d4ff',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(0, 212, 255, 0.3)',
            borderWidth: 1,
            titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            padding: 12,
            callbacks: {
                title: (items) => {
                    if (!items.length)
                        return '';
                    return `Time: ${items[0].label}`;
                },
                label: (context) => {
                    return formatTooltipLabel(context.dataset.label || '', context.parsed.y);
                },
            },
        };
        return {
            legend: {
                labels: {
                    color: '#94a3b8',
                    font: { family: "'JetBrains Mono', monospace", size: 11 },
                    usePointStyle: true,
                    pointStyle: 'line',
                    padding: 16,
                },
            },
            tooltip,
        };
    }
    /** Builds the standard simulation datasets. Pass empty arrays for animated (progressive) mode. */
    buildDatasets(snapshots, preloaded) {
        const hasQueue = snapshots.some(s => s.queue_depth > 0);
        const capacitySegment = {
            borderColor: (ctx) => {
                const idx = ctx.p0DataIndex;
                if (idx < snapshots.length && snapshots[idx].capacity_rps < snapshots[idx].traffic_rps) {
                    return COLORS.capacityRed;
                }
                return COLORS.capacityGreen;
            },
        };
        const datasets = [
            {
                label: 'Traffic (RPS)',
                data: preloaded ? snapshots.map(s => s.traffic_rps) : [],
                borderColor: COLORS.traffic,
                backgroundColor: COLORS.trafficFill,
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: 2,
            },
            {
                label: 'Capacity (RPS)',
                data: preloaded ? snapshots.map(s => s.capacity_rps) : [],
                borderColor: COLORS.capacity,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: 1,
                segment: capacitySegment,
            },
            {
                label: 'Dropped (RPS)',
                data: preloaded ? snapshots.map(s => s.dropped_requests) : [],
                borderColor: COLORS.dropped,
                backgroundColor: COLORS.droppedFill,
                fill: true,
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: 0,
            },
            {
                label: 'Running Pods',
                data: preloaded ? snapshots.map(s => s.running_pods) : [],
                borderColor: COLORS.pods,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y1',
                order: 3,
                borderDash: [5, 3],
            },
        ];
        if (hasQueue) {
            datasets.push({
                label: 'Queue Depth',
                data: preloaded ? snapshots.map(s => s.queue_depth) : [],
                borderColor: COLORS.queue,
                backgroundColor: COLORS.queueFill,
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: 0,
                borderDash: [3, 2],
            });
        }
        // Show effective capacity line when saturation is reducing capacity
        const hasSaturation = snapshots.some(s => s.effective_capacity_rps < s.capacity_rps);
        if (hasSaturation) {
            datasets.push({
                label: 'Effective Capacity',
                data: preloaded ? snapshots.map(s => s.effective_capacity_rps) : [],
                borderColor: COLORS.effectiveCapacity,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: 1,
                borderDash: [6, 3],
            });
        }
        // Show wait time when queue has latency
        const hasWaitTime = snapshots.some(s => s.queue_wait_time_ms > 0);
        if (hasWaitTime) {
            datasets.push({
                label: 'Queue Wait (ms)',
                data: preloaded ? snapshots.map(s => s.queue_wait_time_ms) : [],
                borderColor: COLORS.waitTime,
                backgroundColor: COLORS.waitTimeFill,
                fill: true,
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y2',
                order: 0,
                borderDash: [2, 2],
            });
        }
        return datasets;
    }
    /** Enable the y2 axis if a wait time dataset is present. */
    enableY2IfNeeded(datasets) {
        const hasY2 = datasets.some((d) => d.yAxisID === 'y2');
        if (hasY2 && this.chart) {
            this.chart.options.scales.y2.display = true;
        }
    }
    /** Builds a label -> index map for safe dataset access by name. */
    indexDatasets(datasets) {
        this.datasetIndex.clear();
        for (let i = 0; i < datasets.length; i++) {
            this.datasetIndex.set(datasets[i].label, i);
        }
    }
    getDatasetByLabel(label) {
        const idx = this.datasetIndex.get(label);
        if (idx !== undefined && this.chart) {
            return this.chart.data.datasets[idx];
        }
        return null;
    }
    // --- Render methods ---
    async renderAnimated(canvasId, result, playbackSpeed = 5) {
        this.stop();
        this.result = result;
        this.playbackSpeed = playbackSpeed;
        this.currentIndex = 0;
        const canvas = document.getElementById(canvasId);
        if (!canvas)
            return;
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const snapshots = result.snapshots;
        const datasets = this.buildDatasets(snapshots, false);
        this.indexDatasets(datasets);
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: snapshots.map(s => formatTime(s.time)),
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: this.buildPlugins(),
                scales: this.buildScales(),
            },
        });
        this.enableY2IfNeeded(datasets);
        this.isPlaying = true;
        this.animate(snapshots);
    }
    animate(snapshots) {
        if (!this.isPlaying || !this.chart)
            return;
        const ticksPerFrame = Math.max(1, Math.round(this.playbackSpeed));
        const nextIndex = Math.min(this.currentIndex + ticksPerFrame, snapshots.length);
        // Add data points by label (no fragile index assumptions)
        const trafficDs = this.getDatasetByLabel('Traffic (RPS)');
        const capacityDs = this.getDatasetByLabel('Capacity (RPS)');
        const droppedDs = this.getDatasetByLabel('Dropped (RPS)');
        const podsDs = this.getDatasetByLabel('Running Pods');
        const queueDs = this.getDatasetByLabel('Queue Depth');
        const effectiveCapDs = this.getDatasetByLabel('Effective Capacity');
        const waitTimeDs = this.getDatasetByLabel('Queue Wait (ms)');
        for (let i = this.currentIndex; i < nextIndex; i++) {
            const snap = snapshots[i];
            if (trafficDs)
                trafficDs.data.push(snap.traffic_rps);
            if (capacityDs)
                capacityDs.data.push(snap.capacity_rps);
            if (droppedDs)
                droppedDs.data.push(snap.dropped_requests);
            if (podsDs)
                podsDs.data.push(snap.running_pods);
            if (queueDs)
                queueDs.data.push(snap.queue_depth);
            if (effectiveCapDs)
                effectiveCapDs.data.push(snap.effective_capacity_rps);
            if (waitTimeDs)
                waitTimeDs.data.push(snap.queue_wait_time_ms);
        }
        this.currentIndex = nextIndex;
        this.chart.update('none');
        if (this.onAnimationTick) {
            this.onAnimationTick(this.currentIndex, snapshots.length);
        }
        if (this.currentIndex < snapshots.length) {
            this.animationFrame = requestAnimationFrame(() => this.animate(snapshots));
        }
        else {
            this.isPlaying = false;
            if (this.onAnimationTick) {
                this.onAnimationTick(snapshots.length, snapshots.length);
            }
        }
    }
    renderComplete(canvasId, result) {
        this.stop();
        this.result = result;
        const canvas = document.getElementById(canvasId);
        if (!canvas)
            return;
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const snapshots = result.snapshots;
        const datasets = this.buildDatasets(snapshots, true);
        this.indexDatasets(datasets);
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: snapshots.map(s => formatTime(s.time)),
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 500 },
                interaction: { mode: 'index', intersect: false },
                plugins: this.buildPlugins(),
                scales: this.buildScales(),
            },
        });
        this.enableY2IfNeeded(datasets);
    }
    renderMultiRun(canvasId, runs) {
        this.stop();
        const canvas = document.getElementById(canvasId);
        if (!canvas)
            return;
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const RUN_COLORS = [
            { capacity: 'rgba(132, 204, 22, 0.9)', pods: 'rgba(179, 71, 217, 0.9)' },
            { capacity: 'rgba(251, 191, 36, 0.9)', pods: 'rgba(251, 146, 60, 0.9)' },
            { capacity: 'rgba(56, 189, 248, 0.9)', pods: 'rgba(99, 102, 241, 0.9)' },
            { capacity: 'rgba(244, 114, 182, 0.9)', pods: 'rgba(232, 121, 249, 0.9)' },
            { capacity: 'rgba(52, 211, 153, 0.9)', pods: 'rgba(20, 184, 166, 0.9)' },
        ];
        // Use the longest run for labels
        const longest = runs.reduce((a, b) => a.result.snapshots.length >= b.result.snapshots.length ? a : b);
        const labels = longest.result.snapshots.map(s => formatTime(s.time));
        // Traffic from the latest run (shared x-axis)
        const latestRun = runs[runs.length - 1];
        const datasets = [
            {
                label: 'Traffic (RPS)',
                data: latestRun.result.snapshots.map(s => s.traffic_rps),
                borderColor: COLORS.traffic,
                backgroundColor: COLORS.trafficFill,
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: runs.length * 2 + 1,
            },
        ];
        runs.forEach((run, i) => {
            const colors = RUN_COLORS[i % RUN_COLORS.length];
            const tag = run.name;
            datasets.push({
                label: `${tag} Capacity`,
                data: run.result.snapshots.map(s => s.capacity_rps),
                borderColor: colors.capacity,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y',
                order: i * 2 + 1,
                borderDash: i > 0 ? [6, 3] : undefined,
            });
            datasets.push({
                label: `${tag} Pods`,
                data: run.result.snapshots.map(s => s.running_pods),
                borderColor: colors.pods,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                yAxisID: 'y1',
                order: i * 2,
                borderDash: [5, 3],
            });
        });
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                interaction: { mode: 'index', intersect: false },
                plugins: this.buildPlugins(),
                scales: this.buildScales(),
            },
        });
    }
    stop() {
        this.isPlaying = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = 0;
        }
    }
    destroy() {
        this.stop();
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
}
// --- Traffic Preview (small inline chart) ---
export class TrafficPreviewRenderer {
    constructor() {
        this.chart = null;
    }
    render(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas)
            return;
        if (this.chart) {
            this.chart.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const labels = data.map((_, i) => formatTime(i));
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Traffic (RPS)',
                        data,
                        borderColor: COLORS.traffic,
                        backgroundColor: COLORS.trafficFill,
                        fill: true,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        titleColor: '#00d4ff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(0, 212, 255, 0.3)',
                        borderWidth: 1,
                        titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
                        bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
                        padding: 8,
                        callbacks: {
                            title: (items) => {
                                if (!items.length)
                                    return '';
                                return `Time: ${items[0].label}`;
                            },
                            label: (context) => {
                                return formatTooltipLabel(context.dataset.label || 'Traffic (RPS)', context.parsed.y);
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        display: true,
                        ticks: {
                            color: '#475569',
                            font: { family: "'JetBrains Mono', monospace", size: 8 },
                            maxTicksLimit: 5,
                            maxRotation: 0,
                        },
                        grid: { display: false },
                    },
                    y: {
                        display: true,
                        title: {
                            display: true,
                            text: 'RPS',
                            color: '#475569',
                            font: { family: "'JetBrains Mono', monospace", size: 8 },
                        },
                        ticks: {
                            color: '#475569',
                            font: { family: "'JetBrains Mono', monospace", size: 9 },
                            maxTicksLimit: 4,
                            callback: (val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val,
                        },
                        grid: { color: 'rgba(100, 116, 139, 0.08)' },
                        beginAtZero: true,
                    },
                },
            },
        });
    }
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
}
//# sourceMappingURL=chart.js.map