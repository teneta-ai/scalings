// ============================================================================
// scalings.xyz — Chart Rendering and Animation
// ============================================================================
const COLORS = {
    traffic: 'rgba(0, 212, 255, 0.9)',
    trafficFill: 'rgba(0, 212, 255, 0.15)',
    capacity: 'rgba(132, 204, 22, 0.9)',
    capacityGreen: 'rgba(132, 204, 22, 0.9)',
    capacityRed: 'rgba(239, 68, 68, 0.9)',
    pods: 'rgba(179, 71, 217, 0.9)',
    dropped: 'rgba(239, 68, 68, 0.9)',
    droppedFill: 'rgba(239, 68, 68, 0.25)',
    responseTime: 'rgba(251, 191, 36, 0.7)',
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
        // Compare mode
        this.compareChart = null;
        this.compareResult = null;
    }
    setPlaybackSpeed(speed) {
        this.playbackSpeed = speed;
    }
    setAnimationCallback(cb) {
        this.onAnimationTick = cb;
    }
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
        const labels = snapshots.map(s => this.formatTime(s.time));
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Traffic (RPS)',
                        data: [],
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
                        data: [],
                        borderColor: COLORS.capacity,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                        order: 1,
                        segment: {
                            borderColor: (ctx) => {
                                const idx = ctx.p0DataIndex;
                                if (idx < snapshots.length && snapshots[idx].capacity_rps < snapshots[idx].traffic_rps) {
                                    return COLORS.capacityRed;
                                }
                                return COLORS.capacityGreen;
                            },
                        },
                    },
                    {
                        label: 'Dropped (RPS)',
                        data: [],
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
                        data: [],
                        borderColor: COLORS.pods,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y1',
                        order: 3,
                        borderDash: [5, 3],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#94a3b8',
                            font: { family: "'JetBrains Mono', monospace", size: 11 },
                            usePointStyle: true,
                            pointStyle: 'line',
                            padding: 16,
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        titleColor: '#00d4ff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(0, 212, 255, 0.3)',
                        borderWidth: 1,
                        titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
                        bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                if (label.includes('Pods'))
                                    return `${label}: ${value}`;
                                return `${label}: ${Math.round(value).toLocaleString()}`;
                            },
                        },
                    },
                },
                scales: {
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
                },
            },
        });
        // Start animation
        this.isPlaying = true;
        this.animate(snapshots);
    }
    animate(snapshots) {
        if (!this.isPlaying || !this.chart)
            return;
        const ticksPerFrame = Math.max(1, Math.round(this.playbackSpeed));
        const nextIndex = Math.min(this.currentIndex + ticksPerFrame, snapshots.length);
        // Add data points
        for (let i = this.currentIndex; i < nextIndex; i++) {
            const snap = snapshots[i];
            this.chart.data.datasets[0].data.push(snap.traffic_rps);
            this.chart.data.datasets[1].data.push(snap.capacity_rps);
            this.chart.data.datasets[2].data.push(snap.dropped_requests);
            this.chart.data.datasets[3].data.push(snap.running_pods);
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
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: snapshots.map(s => this.formatTime(s.time)),
                datasets: [
                    {
                        label: 'Traffic (RPS)',
                        data: snapshots.map(s => s.traffic_rps),
                        borderColor: COLORS.traffic,
                        backgroundColor: COLORS.trafficFill,
                        fill: true,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Capacity (RPS)',
                        data: snapshots.map(s => s.capacity_rps),
                        borderColor: COLORS.capacity,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                        segment: {
                            borderColor: (ctx) => {
                                const idx = ctx.p0DataIndex;
                                if (idx < snapshots.length && snapshots[idx].capacity_rps < snapshots[idx].traffic_rps) {
                                    return COLORS.capacityRed;
                                }
                                return COLORS.capacityGreen;
                            },
                        },
                    },
                    {
                        label: 'Dropped (RPS)',
                        data: snapshots.map(s => s.dropped_requests),
                        borderColor: COLORS.dropped,
                        backgroundColor: COLORS.droppedFill,
                        fill: true,
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Running Pods',
                        data: snapshots.map(s => s.running_pods),
                        borderColor: COLORS.pods,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y1',
                        borderDash: [5, 3],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 500 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: '#94a3b8',
                            font: { family: "'JetBrains Mono', monospace", size: 11 },
                            usePointStyle: true,
                            pointStyle: 'line',
                            padding: 16,
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        titleColor: '#00d4ff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(0, 212, 255, 0.3)',
                        borderWidth: 1,
                        titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
                        bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
                        padding: 12,
                    },
                },
                scales: {
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
                },
            },
        });
    }
    renderCompare(canvasId, resultA, resultB) {
        this.stop();
        const canvas = document.getElementById(canvasId);
        if (!canvas)
            return;
        if (this.compareChart) {
            this.compareChart.destroy();
            this.compareChart = null;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const maxLen = Math.max(resultA.snapshots.length, resultB.snapshots.length);
        const labels = Array.from({ length: maxLen }, (_, i) => {
            const snap = resultA.snapshots[i] || resultB.snapshots[i];
            return snap ? this.formatTime(snap.time) : '';
        });
        this.compareChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Config A - Capacity',
                        data: resultA.snapshots.map(s => s.capacity_rps),
                        borderColor: COLORS.capacityGreen,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Config B - Capacity',
                        data: resultB.snapshots.map(s => s.capacity_rps),
                        borderColor: 'rgba(251, 191, 36, 0.9)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                        borderDash: [8, 4],
                    },
                    {
                        label: 'Traffic',
                        data: resultA.snapshots.map(s => s.traffic_rps),
                        borderColor: COLORS.traffic,
                        backgroundColor: COLORS.trafficFill,
                        fill: true,
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Config A - Pods',
                        data: resultA.snapshots.map(s => s.running_pods),
                        borderColor: COLORS.pods,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y1',
                    },
                    {
                        label: 'Config B - Pods',
                        data: resultB.snapshots.map(s => s.running_pods),
                        borderColor: 'rgba(251, 146, 60, 0.9)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y1',
                        borderDash: [8, 4],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 500 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: '#94a3b8',
                            font: { family: "'JetBrains Mono', monospace", size: 11 },
                            usePointStyle: true,
                            pointStyle: 'line',
                            padding: 16,
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        titleColor: '#00d4ff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(0, 212, 255, 0.3)',
                        borderWidth: 1,
                    },
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', maxTicksLimit: 20, maxRotation: 0 },
                        grid: { color: 'rgba(100, 116, 139, 0.1)' },
                    },
                    y: {
                        position: 'left',
                        title: { display: true, text: 'RPS', color: '#64748b' },
                        ticks: { color: '#64748b' },
                        grid: { color: 'rgba(100, 116, 139, 0.1)' },
                        beginAtZero: true,
                    },
                    y1: {
                        position: 'right',
                        title: { display: true, text: 'Pods', color: '#b347d9' },
                        ticks: { color: '#b347d9' },
                        grid: { drawOnChartArea: false },
                        beginAtZero: true,
                    },
                },
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
        if (this.compareChart) {
            this.compareChart.destroy();
            this.compareChart = null;
        }
    }
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
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
        const labels = data.map((_, i) => i.toString());
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
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
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                },
                scales: {
                    x: { display: false },
                    y: {
                        display: true,
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