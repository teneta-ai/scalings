// ============================================================================
// scalings.xyz — Traffic Pattern Service
// ============================================================================
export class LocalTrafficPatternService {
    generate(traffic, duration, tickInterval) {
        const ticks = Math.ceil(duration / tickInterval);
        const result = [];
        for (let i = 0; i < ticks; i++) {
            const t = i * tickInterval;
            result.push(Math.max(0, this.getRPS(traffic, t, duration)));
        }
        return result;
    }
    preview(traffic, points = 100) {
        const duration = this.getPreviewDuration(traffic);
        const tickInterval = duration / points;
        return this.generate(traffic, duration, tickInterval);
    }
    getRPS(traffic, t, duration) {
        switch (traffic.pattern) {
            case 'steady':
                return this.steady(traffic.params);
            case 'gradual':
                return this.gradual(traffic.params, t, duration);
            case 'spike':
                return this.spike(traffic.params, t);
            case 'wave':
                return this.wave(traffic.params, t);
            case 'step':
                return this.step(traffic.params, t);
            case 'custom':
                return this.custom(traffic.params, t);
            default:
                return 0;
        }
    }
    steady(params) {
        return params.rps;
    }
    gradual(params, t, duration) {
        const effectiveDuration = params.duration || duration;
        const progress = Math.min(t / effectiveDuration, 1);
        return params.start_rps + (params.end_rps - params.start_rps) * progress;
    }
    spike(params, t) {
        if (t >= params.spike_start && t < params.spike_start + params.spike_duration) {
            return params.spike_rps;
        }
        return params.base_rps;
    }
    wave(params, t) {
        return params.base_rps + params.amplitude * Math.sin((2 * Math.PI * t) / params.period);
    }
    step(params, t) {
        let elapsed = 0;
        for (const s of params.steps) {
            if (t < elapsed + s.duration) {
                return s.rps;
            }
            elapsed += s.duration;
        }
        // After all steps, hold the last value
        return params.steps.length > 0 ? params.steps[params.steps.length - 1].rps : 0;
    }
    custom(params, t) {
        const series = params.series;
        if (!series || series.length === 0)
            return 0;
        if (series.length === 1)
            return series[0].rps;
        // Find surrounding points and interpolate
        for (let i = 0; i < series.length - 1; i++) {
            if (t >= series[i].t && t <= series[i + 1].t) {
                const span = series[i + 1].t - series[i].t;
                if (span === 0)
                    return series[i].rps;
                const progress = (t - series[i].t) / span;
                return series[i].rps + (series[i + 1].rps - series[i].rps) * progress;
            }
        }
        // Beyond the last point, hold the last value
        if (t >= series[series.length - 1].t) {
            return series[series.length - 1].rps;
        }
        return series[0].rps;
    }
    getPreviewDuration(traffic) {
        switch (traffic.pattern) {
            case 'steady':
                return 60;
            case 'gradual': {
                const p = traffic.params;
                return p.duration || 600;
            }
            case 'spike': {
                const p = traffic.params;
                return p.spike_start + p.spike_duration + Math.max(60, p.spike_duration);
            }
            case 'wave': {
                const p = traffic.params;
                return p.period * 3;
            }
            case 'step': {
                const p = traffic.params;
                return p.steps.reduce((sum, s) => sum + s.duration, 0);
            }
            case 'custom': {
                const p = traffic.params;
                if (p.series && p.series.length > 0) {
                    return p.series[p.series.length - 1].t;
                }
                return 600;
            }
            default:
                return 600;
        }
    }
}
//# sourceMappingURL=traffic.js.map