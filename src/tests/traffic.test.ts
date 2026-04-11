import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalTrafficPatternService, parseGrafanaCSV, detectCsvValueUnit, parseHumanValue, detectUnitFromValueSuffix } from '../services/traffic.js';
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

// ---------------------------------------------------------------------------
// Auto-detect CSV value unit
// ---------------------------------------------------------------------------
describe('detectCsvValueUnit — column name detection', () => {
  it('detects RPM from column name containing "rpm"', () => {
    const csv = 'Time,http_requests_rpm\n1000000000,6000\n1000000060,3000';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rpm');
    assert.ok(guess.reason.includes('requests/min'));
  });

  it('detects RPM from column name containing "per_minute"', () => {
    const csv = 'Time,requests_per_minute\n1000000000,6000\n1000000060,3000';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rpm');
  });

  it('detects RPH from column name containing "/hour"', () => {
    const csv = 'Time,requests/hour\n1000000000,360000\n1000000060,180000';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rph');
    assert.ok(guess.reason.includes('requests/hour'));
  });

  it('detects RPS from column name containing "rps"', () => {
    const csv = 'Time,http_rps\n1000000000,100\n1000000060,200';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rps');
    assert.ok(guess.reason.includes('requests/sec'));
  });
});

describe('detectCsvValueUnit — magnitude detection', () => {
  it('guesses RPM when median value > 5000', () => {
    const csv = 'Time,Value\n1000000000,12000\n1000000060,8000\n1000000120,15000';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rpm');
    assert.ok(guess.reason.includes('median'));
  });

  it('guesses RPH when median value > 100000', () => {
    const csv = 'Time,Value\n1000000000,360000\n1000000060,200000\n1000000120,500000';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rph');
    assert.ok(guess.reason.includes('median'));
  });

  it('guesses RPS when median value is small', () => {
    const csv = 'Time,Value\n1000000000,100\n1000000060,200\n1000000120,150';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rps');
  });

  it('column name takes priority over magnitude', () => {
    // Column says "rps" but values are huge — trust the column name
    const csv = 'Time,high_throughput_rps\n1000000000,50000\n1000000060,60000';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rps');
  });
});

// ---------------------------------------------------------------------------
// parseHumanValue — SI suffix handling
// ---------------------------------------------------------------------------
describe('parseHumanValue — SI suffixes', () => {
  it('parses plain numbers', () => {
    assert.equal(parseHumanValue('42'), 42);
    assert.equal(parseHumanValue('3.14'), 3.14);
    assert.equal(parseHumanValue('  100  '), 100);
  });

  it('parses K suffix (thousands)', () => {
    assert.equal(parseHumanValue('40.0K'), 40000);
    assert.equal(parseHumanValue('1.07K'), 1070);
    assert.equal(parseHumanValue('104K'), 104000);
  });

  it('parses M suffix (millions)', () => {
    assert.equal(parseHumanValue('2.5M'), 2500000);
    assert.equal(parseHumanValue('1M'), 1000000);
  });

  it('parses case-insensitively', () => {
    assert.equal(parseHumanValue('40k'), 40000);
    assert.equal(parseHumanValue('2.5m'), 2500000);
  });

  it('handles trailing text after suffix', () => {
    assert.equal(parseHumanValue('40.0K ops/m'), 40000);
    assert.equal(parseHumanValue('119 ops/m'), 119);
    assert.equal(parseHumanValue('1.07K ops/m'), 1070);
  });

  it('returns NaN for non-numeric strings', () => {
    assert.ok(isNaN(parseHumanValue('N/A')));
    assert.ok(isNaN(parseHumanValue('abc')));
    assert.ok(isNaN(parseHumanValue('')));
  });

  it('handles negative values', () => {
    assert.equal(parseHumanValue('-5K'), -5000);
  });
});

// ---------------------------------------------------------------------------
// detectUnitFromValueSuffix
// ---------------------------------------------------------------------------
describe('detectUnitFromValueSuffix', () => {
  it('detects ops/m as rpm', () => {
    assert.equal(detectUnitFromValueSuffix('40.0K ops/m'), 'rpm');
  });

  it('detects ops/min as rpm', () => {
    assert.equal(detectUnitFromValueSuffix('500 ops/min'), 'rpm');
  });

  it('detects ops/s as rps', () => {
    assert.equal(detectUnitFromValueSuffix('200 ops/s'), 'rps');
  });

  it('detects ops/sec as rps', () => {
    assert.equal(detectUnitFromValueSuffix('200 ops/sec'), 'rps');
  });

  it('detects ops/h as rph', () => {
    assert.equal(detectUnitFromValueSuffix('1.2K ops/h'), 'rph');
  });

  it('detects ops/hr as rph', () => {
    assert.equal(detectUnitFromValueSuffix('500 ops/hr'), 'rph');
  });

  it('returns null for plain numbers', () => {
    assert.equal(detectUnitFromValueSuffix('42'), null);
    assert.equal(detectUnitFromValueSuffix('40.0K'), null);
  });
});

// ---------------------------------------------------------------------------
// parseGrafanaCSV — SI suffix and unit suffix handling
// ---------------------------------------------------------------------------
describe('parseGrafanaCSV — Grafana human-readable values (K/M suffixes)', () => {
  it('parses values with K suffix correctly', () => {
    const csv = [
      '"Time","Operations"',
      '2026-04-07 13:27:00,40.0K ops/m',
      '2026-04-07 13:27:15,40.5K ops/m',
      '2026-04-07 13:27:30,41.0K ops/m',
    ].join('\n');
    const result = parseGrafanaCSV(csv, 'rpm');
    assert.equal(result.length, 3);
    assert.equal(result[0].t, 0);
    assert.equal(result[0].rps, Math.round(40000 / 60 * 100) / 100);  // 666.67
    assert.equal(result[1].t, 15);
    assert.equal(result[1].rps, Math.round(40500 / 60 * 100) / 100);  // 675
    assert.equal(result[2].t, 30);
  });

  it('handles mix of K-suffixed and plain values', () => {
    const csv = [
      '"Time","Operations"',
      '2026-04-07 13:37:45,119 ops/m',
      '2026-04-07 13:38:00,12.3K ops/m',
    ].join('\n');
    const result = parseGrafanaCSV(csv, 'rpm');
    assert.equal(result.length, 2);
    assert.equal(result[0].rps, Math.round(119 / 60 * 100) / 100);    // 1.98
    assert.equal(result[1].rps, Math.round(12300 / 60 * 100) / 100);  // 205
  });

  it('handles real Grafana export with full data', () => {
    const csv = [
      '"Time","Operations"',
      '2026-04-07 13:27:00,40.0K ops/m',
      '2026-04-07 13:32:45,51.0K ops/m',
      '2026-04-07 13:37:30,1.07K ops/m',
      '2026-04-07 13:37:45,119 ops/m',
      '2026-04-07 13:41:00,74.8K ops/m',
      '2026-04-07 13:55:00,128K ops/m',
      '2026-04-07 13:57:00,154K ops/m',
    ].join('\n');
    const result = parseGrafanaCSV(csv, 'rpm');
    assert.equal(result.length, 7);
    // First point at t=0
    assert.equal(result[0].t, 0);
    assert.equal(result[0].rps, Math.round(40000 / 60 * 100) / 100);
    // 154K ops/m = 154000 / 60 ≈ 2566.67 RPS
    assert.equal(result[6].rps, Math.round(154000 / 60 * 100) / 100);
  });
});

// ---------------------------------------------------------------------------
// detectCsvValueUnit — value suffix detection
// ---------------------------------------------------------------------------
describe('detectCsvValueUnit — value suffix detection', () => {
  it('detects RPM from "ops/m" suffix in values', () => {
    const csv = '"Time","Operations"\n2026-04-07 13:27:00,40.0K ops/m\n2026-04-07 13:27:15,40.5K ops/m';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rpm');
    assert.ok(guess.reason.includes('requests/min'));
  });

  it('detects RPS from "ops/s" suffix in values', () => {
    const csv = 'Time,Value\n1000000000,500 ops/s\n1000000060,600 ops/s';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rps');
  });

  it('detects RPH from "ops/h" suffix in values', () => {
    const csv = 'Time,Value\n1000000000,360K ops/h\n1000000060,200K ops/h';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rph');
  });

  it('magnitude detection works with K-suffixed values', () => {
    // Column name is generic "Value", no unit suffix in values, but values are 40K+
    const csv = 'Time,Value\n1000000000,40.0K\n1000000060,50.0K\n1000000120,45.0K';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rpm');
    assert.ok(guess.reason.includes('median'));
  });

  it('column name still takes priority over value suffix', () => {
    const csv = 'Time,http_rps\n1000000000,500 ops/m\n1000000060,600 ops/m';
    const guess = detectCsvValueUnit(csv);
    assert.equal(guess.unit, 'rps');  // column name wins
  });
});
