// ============================================================================
// scalings.xyz — Traffic Pattern Service
// ============================================================================

import {
  TrafficPatternService,
  TrafficConfig,
  SteadyParams,
  GradualParams,
  SpikeParams,
  WaveParams,
  StepParams,
  CustomParams,
} from '../interfaces/types.js';

export class LocalTrafficPatternService implements TrafficPatternService {
  generate(traffic: TrafficConfig, duration: number, tickInterval: number): number[] {
    const ticks = Math.ceil(duration / tickInterval);
    const result: number[] = [];

    for (let i = 0; i < ticks; i++) {
      const t = i * tickInterval;
      result.push(Math.max(0, this.getRPS(traffic, t, duration)));
    }

    return result;
  }

  preview(traffic: TrafficConfig, points: number = 100): number[] {
    const duration = this.getPreviewDuration(traffic);
    const tickInterval = duration / points;
    return this.generate(traffic, duration, tickInterval);
  }

  private getRPS(traffic: TrafficConfig, t: number, duration: number): number {
    switch (traffic.pattern) {
      case 'steady':
        return this.steady(traffic.params as SteadyParams);
      case 'gradual':
        return this.gradual(traffic.params as GradualParams, t, duration);
      case 'spike':
        return this.spike(traffic.params as SpikeParams, t);
      case 'wave':
        return this.wave(traffic.params as WaveParams, t);
      case 'step':
        return this.step(traffic.params as StepParams, t);
      case 'custom':
        return this.custom(traffic.params as CustomParams, t);
      default:
        return 0;
    }
  }

  private steady(params: SteadyParams): number {
    return params.rps;
  }

  private gradual(params: GradualParams, t: number, duration: number): number {
    const progress = Math.min(t / duration, 1);
    return params.start_rps + (params.end_rps - params.start_rps) * progress;
  }

  private spike(params: SpikeParams, t: number): number {
    if (t >= params.spike_start && t < params.spike_start + params.spike_duration) {
      return params.spike_rps;
    }
    return params.base_rps;
  }

  private wave(params: WaveParams, t: number): number {
    return params.base_rps + params.amplitude * Math.sin((2 * Math.PI * t) / params.period);
  }

  private step(params: StepParams, t: number): number {
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

  private custom(params: CustomParams, t: number): number {
    const series = params.series;
    if (!series || series.length === 0) return 0;
    if (series.length === 1) return series[0].rps;

    // Find surrounding points and interpolate
    for (let i = 0; i < series.length - 1; i++) {
      if (t >= series[i].t && t <= series[i + 1].t) {
        const span = series[i + 1].t - series[i].t;
        if (span === 0) return series[i].rps;
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

  private getPreviewDuration(traffic: TrafficConfig): number {
    switch (traffic.pattern) {
      case 'steady':
        return 60;
      case 'gradual':
        return 600;
      case 'spike': {
        const p = traffic.params as SpikeParams;
        return p.spike_start + p.spike_duration + Math.max(60, p.spike_duration);
      }
      case 'wave': {
        const p = traffic.params as WaveParams;
        return p.period * 3;
      }
      case 'step': {
        const p = traffic.params as StepParams;
        return p.steps.reduce((sum, s) => sum + s.duration, 0);
      }
      case 'custom': {
        const p = traffic.params as CustomParams;
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
