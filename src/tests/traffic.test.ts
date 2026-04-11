import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalTrafficPatternService, parseGrafanaCSV } from '../services/traffic.js';
import {
  TrafficConfig,
  SteadyParams,
  GradualParams,
  SpikeParams,
  WaveParams,
  StepParams,
  CustomParams,
} from '../interfaces/types.js';

const svc = new LocalTrafficPatternService();

// ---------------------------------------------------------------------------
// Steady
// ---------------------------------------------------------------------------
describe('TrafficPatternService — steady', () => {
  const traffic: TrafficConfig = {
    pattern: 'steady',
    params: { rps: 500 } as SteadyParams,
  };

  it('returns constant RPS for every tick', () => {
    const data = svc.generate(traffic, 60, 1);
    assert.equal(data.length, 60);
    for (const val of data) {
      assert.equal(val, 500);
    }
  });

  it('preview returns non-empty array', () => {
    const preview = svc.preview(traffic);
    assert.ok(preview.length > 0);
    for (const val of preview) {
      assert.equal(val, 500);
    }
  });
});

// ---------------------------------------------------------------------------
// Gradual ramp
// ---------------------------------------------------------------------------
describe('TrafficPatternService — gradual', () => {
  const traffic: TrafficConfig = {
    pattern: 'gradual',
    params: { start_rps: 100, end_rps: 1000 } as GradualParams,
  };

  it('starts at start_rps', () => {
    const data = svc.generate(traffic, 100, 1);
    assert.equal(data[0], 100);
  });

  it('ends near end_rps', () => {
    const data = svc.generate(traffic, 100, 1);
    // Last tick is at t=99, so value is 100 + 900*(99/100) = 991
    assert.ok(Math.abs(data[data.length - 1] - 1000) < 20, `last value was ${data[data.length - 1]}`);
  });

  it('monotonically increases', () => {
    const data = svc.generate(traffic, 100, 1);
    for (let i = 1; i < data.length; i++) {
      assert.ok(data[i] >= data[i - 1], `tick ${i}: ${data[i]} should be >= ${data[i - 1]}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Spike
// ---------------------------------------------------------------------------
describe('TrafficPatternService — spike', () => {
  const traffic: TrafficConfig = {
    pattern: 'spike',
    params: {
      base_rps: 200,
      spike_rps: 2000,
      spike_start: 10,
      spike_duration: 5,
    } as SpikeParams,
  };

  it('returns base_rps before spike', () => {
    const data = svc.generate(traffic, 30, 1);
    for (let i = 0; i < 10; i++) {
      assert.equal(data[i], 200, `tick ${i}`);
    }
  });

  it('returns spike_rps during spike', () => {
    const data = svc.generate(traffic, 30, 1);
    for (let i = 10; i < 15; i++) {
      assert.equal(data[i], 2000, `tick ${i}`);
    }
  });

  it('returns base_rps after spike', () => {
    const data = svc.generate(traffic, 30, 1);
    for (let i = 15; i < 30; i++) {
      assert.equal(data[i], 200, `tick ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Wave / sinusoidal
// ---------------------------------------------------------------------------
describe('TrafficPatternService — wave', () => {
  const traffic: TrafficConfig = {
    pattern: 'wave',
    params: { base_rps: 300, amplitude: 200, period: 60 } as WaveParams,
  };

  it('starts at base_rps (sin(0) = 0)', () => {
    const data = svc.generate(traffic, 60, 1);
    assert.equal(data[0], 300);
  });

  it('peak equals base + amplitude', () => {
    const data = svc.generate(traffic, 60, 1);
    const max = Math.max(...data);
    // sin peaks at 1, so max ≈ 300 + 200 = 500
    assert.ok(Math.abs(max - 500) < 5, `max was ${max}`);
  });

  it('trough equals base - amplitude', () => {
    const data = svc.generate(traffic, 60, 1);
    const min = Math.min(...data);
    // sin troughs at -1, so min ≈ 300 - 200 = 100
    assert.ok(Math.abs(min - 100) < 5, `min was ${min}`);
  });
});

// ---------------------------------------------------------------------------
// Step function
// ---------------------------------------------------------------------------
describe('TrafficPatternService — step', () => {
  const traffic: TrafficConfig = {
    pattern: 'step',
    params: {
      steps: [
        { rps: 100, duration: 10 },
        { rps: 300, duration: 10 },
        { rps: 500, duration: 10 },
      ],
    } as StepParams,
  };

  it('returns correct RPS for each step', () => {
    const data = svc.generate(traffic, 30, 1);
    assert.equal(data[0], 100);
    assert.equal(data[9], 100);
    assert.equal(data[10], 300);
    assert.equal(data[19], 300);
    assert.equal(data[20], 500);
    assert.equal(data[29], 500);
  });

  it('holds last step value past total duration', () => {
    const data = svc.generate(traffic, 40, 1);
    assert.equal(data[35], 500);
  });
});

// ---------------------------------------------------------------------------
// Custom (linear interpolation)
// ---------------------------------------------------------------------------
describe('TrafficPatternService — custom', () => {
  const traffic: TrafficConfig = {
    pattern: 'custom',
    params: {
      series: [
        { t: 0, rps: 100 },
        { t: 10, rps: 200 },
        { t: 20, rps: 100 },
      ],
    } as CustomParams,
  };

  it('matches exact points', () => {
    const data = svc.generate(traffic, 20, 1);
    assert.equal(data[0], 100);
    assert.equal(data[10], 200);
  });

  it('interpolates midpoints', () => {
    const data = svc.generate(traffic, 20, 1);
    assert.equal(data[5], 150); // halfway between 100 and 200
  });

  it('holds last value beyond series', () => {
    const data = svc.generate(traffic, 30, 1);
    assert.equal(data[25], 100);
  });

  it('handles single-point series', () => {
    const single: TrafficConfig = {
      pattern: 'custom',
      params: { series: [{ t: 0, rps: 42 }] } as CustomParams,
    };
    const data = svc.generate(single, 10, 1);
    for (const val of data) assert.equal(val, 42);
  });

  it('handles empty series', () => {
    const empty: TrafficConfig = {
      pattern: 'custom',
      params: { series: [] } as CustomParams,
    };
    const data = svc.generate(empty, 10, 1);
    for (const val of data) assert.equal(val, 0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('TrafficPatternService — edge cases', () => {
  it('generate never returns negative values', () => {
    const traffic: TrafficConfig = {
      pattern: 'wave',
      params: { base_rps: 10, amplitude: 100, period: 60 } as WaveParams,
    };
    const data = svc.generate(traffic, 120, 1);
    for (const val of data) {
      assert.ok(val >= 0, `negative value: ${val}`);
    }
  });

  it('generate respects tick interval', () => {
    const traffic: TrafficConfig = {
      pattern: 'steady',
      params: { rps: 100 } as SteadyParams,
    };
    const data = svc.generate(traffic, 60, 5);
    assert.equal(data.length, 12); // 60 / 5
  });
});

// ---------------------------------------------------------------------------
// Grafana CSV import
// ---------------------------------------------------------------------------
describe('parseGrafanaCSV — semicolon-separated (panel export)', () => {
  it('parses Series;Time;Value format with epoch ms timestamps', () => {
    const csv = [
      'Series;Time;Value',
      '"cpu_usage";1706745600000;42.5',
      '"cpu_usage";1706745660000;55.3',
      '"cpu_usage";1706745720000;38.1',
    ].join('\n');
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 3);
    assert.equal(result[0].t, 0);
    assert.equal(result[0].rps, 42.5);
    assert.equal(result[1].t, 60);
    assert.equal(result[1].rps, 55.3);
    assert.equal(result[2].t, 120);
    assert.equal(result[2].rps, 38.1);
  });
});

describe('parseGrafanaCSV — comma-separated (Inspect > Data export)', () => {
  it('parses Time,MetricName format with ISO timestamps', () => {
    const csv = [
      'Time,request_rate',
      '2024-01-31T16:00:00.000Z,100',
      '2024-01-31T16:01:00.000Z,200',
      '2024-01-31T16:02:00.000Z,150',
    ].join('\n');
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 3);
    assert.equal(result[0].t, 0);
    assert.equal(result[0].rps, 100);
    assert.equal(result[1].t, 60);
    assert.equal(result[1].rps, 200);
    assert.equal(result[2].t, 120);
    assert.equal(result[2].rps, 150);
  });

  it('parses Time,Value format with epoch seconds', () => {
    const csv = [
      'Time,Value',
      '1706745600,500',
      '1706745660,600',
      '1706745720,550',
    ].join('\n');
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 3);
    assert.equal(result[0].t, 0);
    assert.equal(result[1].t, 60);
    assert.equal(result[2].t, 120);
  });
});

describe('parseGrafanaCSV — tab-separated', () => {
  it('parses tab-separated format', () => {
    const csv = 'Time\tValue\n1706745600000\t42\n1706745660000\t55';
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 2);
    assert.equal(result[0].t, 0);
    assert.equal(result[1].t, 60);
  });
});

describe('parseGrafanaCSV — unit conversion', () => {
  it('converts RPM values to RPS (divides by 60)', () => {
    const csv = 'Time,Value\n1000000000,6000\n1000000060,3000';
    const result = parseGrafanaCSV(csv, 'rpm');
    assert.equal(result[0].rps, 100);    // 6000 / 60
    assert.equal(result[1].rps, 50);     // 3000 / 60
  });

  it('converts RPH values to RPS (divides by 3600)', () => {
    const csv = 'Time,Value\n1000000000,360000\n1000000060,7200';
    const result = parseGrafanaCSV(csv, 'rph');
    assert.equal(result[0].rps, 100);    // 360000 / 3600
    assert.equal(result[1].rps, 2);      // 7200 / 3600
  });

  it('leaves RPS values unchanged (default)', () => {
    const csv = 'Time,Value\n1000000000,42\n1000000060,55';
    const result = parseGrafanaCSV(csv);
    assert.equal(result[0].rps, 42);
    assert.equal(result[1].rps, 55);
  });

  it('clamps converted negative values to 0', () => {
    const csv = 'Time,Value\n1000000000,-120\n1000000060,600';
    const result = parseGrafanaCSV(csv, 'rpm');
    assert.equal(result[0].rps, 0);      // -120/60 = -2, clamped to 0
    assert.equal(result[1].rps, 10);     // 600/60
  });
});

describe('parseGrafanaCSV — edge cases', () => {
  it('clamps negative values to 0', () => {
    const csv = 'Time,Value\n1000000000,100\n1000000060,-50\n1000000120,200';
    const result = parseGrafanaCSV(csv);
    assert.equal(result[1].rps, 0);
  });

  it('sorts by timestamp', () => {
    const csv = 'Time,Value\n1000000120,300\n1000000000,100\n1000000060,200';
    const result = parseGrafanaCSV(csv);
    assert.equal(result[0].t, 0);
    assert.equal(result[0].rps, 100);
    assert.equal(result[1].t, 60);
    assert.equal(result[1].rps, 200);
    assert.equal(result[2].t, 120);
    assert.equal(result[2].rps, 300);
  });

  it('skips rows with non-numeric values', () => {
    const csv = 'Time,Value\n1000000000,100\n1000000060,N/A\n1000000120,200';
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 2);
  });

  it('throws on missing Time column', () => {
    const csv = 'Series,Value\nfoo,100\nbar,200';
    assert.throws(() => parseGrafanaCSV(csv), /Time/);
  });

  it('throws on too few rows', () => {
    const csv = 'Time,Value';
    assert.throws(() => parseGrafanaCSV(csv), /header.*data/i);
  });

  it('throws on no valid data rows', () => {
    const csv = 'Time,Value\nbadtime,notanumber';
    assert.throws(() => parseGrafanaCSV(csv), /No valid/);
  });

  it('handles Windows-style line endings', () => {
    const csv = 'Time,Value\r\n1000000000,100\r\n1000000060,200\r\n';
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 2);
  });

  it('handles quoted headers', () => {
    const csv = '"Time";"Value"\n1000000000;100\n1000000060;200';
    const result = parseGrafanaCSV(csv);
    assert.equal(result.length, 2);
    assert.equal(result[0].t, 0);
    assert.equal(result[1].t, 60);
  });
});
