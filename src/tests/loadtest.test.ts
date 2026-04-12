import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalLoadTestExportService } from '../services/loadtest/index.js';
import {
  SimulationConfig,
  SimulationResult,
  SimulationSummary,
  DEFAULT_CONFIG,
  DEFAULT_SERVICE,
  DEFAULT_PRODUCER,
  DEFAULT_BROKER,
  DEFAULT_LOAD_TEST_REQUEST,
  SteadyParams,
  GradualParams,
  SpikeParams,
  WaveParams,
  StepParams,
  CustomParams,
} from '../interfaces/types.js';

const svc = new LocalLoadTestExportService();

function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function makeSummary(overrides: Partial<SimulationSummary> = {}): SimulationSummary {
  return {
    total_requests: 60000,
    total_served: 58000,
    total_dropped: 2000,
    drop_rate_percent: 3.33,
    peak_pod_count: 20,
    min_pod_count: 1,
    peak_queue_depth: 0,
    avg_queue_wait_time_ms: 0,
    peak_queue_wait_time_ms: 0,
    total_expired: 0,
    total_retries: 0,
    time_under_provisioned_seconds: 60,
    time_under_provisioned_percent: 10,
    time_to_recover_seconds: 90,
    estimated_total_cost: 1.5,
    ...overrides,
  };
}

function makeResult(summaryOverrides: Partial<SimulationSummary> = {}): SimulationResult {
  return {
    run_id: 'test-run-001',
    snapshots: [],
    summary: makeSummary(summaryOverrides),
  };
}

// ---------------------------------------------------------------------------
// Service-level tests
// ---------------------------------------------------------------------------
describe('LoadTestExportService', () => {
  it('lists all 5 frameworks', () => {
    const frameworks = svc.getAvailableFrameworks();
    assert.equal(frameworks.length, 5);
    const ids = frameworks.map(f => f.id);
    assert.ok(ids.includes('k6'));
    assert.ok(ids.includes('gatling'));
    assert.ok(ids.includes('locust'));
    assert.ok(ids.includes('jmeter'));
    assert.ok(ids.includes('artillery'));
  });

  it('throws for unknown framework', () => {
    assert.throws(() => svc.getExporter('unknown' as any), /Unknown load test framework/);
  });

  it('generates via service generate method', () => {
    const config = makeConfig();
    const output = svc.generate(config, {
      framework: 'k6',
      targetUrl: 'https://example.com',
      avgResponseTimeMs: 100,
      request: DEFAULT_LOAD_TEST_REQUEST,
    });
    assert.ok(output.length > 0);
    assert.ok(output.includes('k6'));
  });

  it('validates via service validate method', () => {
    const config = makeConfig();
    const result = svc.validate(config, 'k6');
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// k6 Exporter
// ---------------------------------------------------------------------------
describe('k6 Exporter', () => {
  const exporter = svc.getExporter('k6');

  it('has correct metadata', () => {
    assert.equal(exporter.id, 'k6');
    assert.equal(exporter.extension, 'js');
  });

  it('generates valid k6 script for steady traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes("import http from 'k6/http'"));
    assert.ok(output.includes("import { check, sleep } from 'k6'"));
    assert.ok(output.includes('constant-arrival-rate'));
    assert.ok(output.includes('rate: 500'));
    assert.ok(output.includes("TARGET_URL = 'https://example.com'"));
    assert.ok(output.includes('handleSummary'));
  });

  it('generates spike traffic with ramping-arrival-rate', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('ramping-arrival-rate'));
    assert.ok(output.includes('spike_traffic'));
  });

  it('generates gradual traffic with ramping-arrival-rate', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'gradual',
          params: { start_rps: 50, end_rps: 800 } as GradualParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('ramping-arrival-rate'));
    assert.ok(output.includes('startRate: 50'));
  });

  it('generates wave traffic with multiple stages', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'wave',
          params: { base_rps: 300, amplitude: 200, period: 120 } as WaveParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('ramping-arrival-rate'));
    assert.ok(output.includes('wave_traffic'));
  });

  it('generates step traffic with multiple scenarios', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'step',
          params: {
            steps: [
              { rps: 100, duration: 120 },
              { rps: 300, duration: 120 },
              { rps: 600, duration: 120 },
            ],
          } as StepParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('step_1'));
    assert.ok(output.includes('step_2'));
    assert.ok(output.includes('step_3'));
    assert.ok(output.includes('constant-arrival-rate'));
  });

  it('generates custom traffic with stages', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'custom',
          params: {
            series: [
              { t: 0, rps: 100 },
              { t: 60, rps: 500 },
              { t: 120, rps: 200 },
            ],
          } as CustomParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('ramping-arrival-rate'));
    assert.ok(output.includes('custom_traffic'));
  });

  it('includes thresholds when results provided', () => {
    const config = makeConfig();
    const results = makeResult({ drop_rate_percent: 5, avg_queue_wait_time_ms: 500, peak_queue_wait_time_ms: 2000 });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST, results);
    assert.ok(output.includes('thresholds'));
    assert.ok(output.includes('http_req_failed'));
    assert.ok(output.includes('http_req_duration'));
  });

  it('includes scalings.xyz comment header', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('Generated by scalings.xyz'));
  });

  it('validates short duration', () => {
    const config = makeConfig({
      simulation: { duration: 5, tick_interval: 1 },
    });
    const result = exporter.validate(config);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('short duration')));
  });

  it('validates high RPS', () => {
    const config = makeConfig({
      producer: {
        traffic: { pattern: 'steady', params: { rps: 200000 } as SteadyParams },
      },
    });
    const result = exporter.validate(config);
    assert.ok(result.warnings.some(w => w.includes('VUs')));
  });
});

// ---------------------------------------------------------------------------
// Gatling Exporter
// ---------------------------------------------------------------------------
describe('Gatling Exporter', () => {
  const exporter = svc.getExporter('gatling');

  it('has correct metadata', () => {
    assert.equal(exporter.id, 'gatling');
    assert.equal(exporter.extension, 'java');
  });

  it('generates valid Gatling Java simulation for steady traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('import io.gatling.javaapi.core.*'));
    assert.ok(output.includes('extends Simulation'));
    assert.ok(output.includes('constantUsersPerSec(500)'));
    assert.ok(output.includes('.baseUrl("https://example.com")'));
  });

  it('generates spike with ramp injection', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('rampUsersPerSec'));
    assert.ok(output.includes('constantUsersPerSec'));
  });

  it('generates gradual ramp', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'gradual',
          params: { start_rps: 50, end_rps: 800 } as GradualParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('rampUsersPerSec(50).to(800)'));
  });

  it('generates step function with chained injections', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'step',
          params: {
            steps: [
              { rps: 100, duration: 120 },
              { rps: 300, duration: 120 },
            ],
          } as StepParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('constantUsersPerSec(100)'));
    assert.ok(output.includes('constantUsersPerSec(300)'));
  });

  it('includes assertions when results provided', () => {
    const config = makeConfig();
    const results = makeResult({ drop_rate_percent: 5 });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST, results);
    assert.ok(output.includes('assertions'));
    assert.ok(output.includes('failedRequests'));
  });

  it('includes scalings.xyz comment header', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('Generated by scalings.xyz'));
  });
});

// ---------------------------------------------------------------------------
// Locust Exporter
// ---------------------------------------------------------------------------
describe('Locust Exporter', () => {
  const exporter = svc.getExporter('locust');

  it('has correct metadata', () => {
    assert.equal(exporter.id, 'locust');
    assert.equal(exporter.extension, 'py');
  });

  it('generates simple Locust for steady traffic (no LoadTestShape)', () => {
    const config = makeConfig({
      producer: {
        traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('from locust import HttpUser, task, between'));
    assert.ok(output.includes('class ScalingsUser(HttpUser)'));
    assert.ok(output.includes('@task'));
    assert.ok(!output.includes('LoadTestShape'));
    assert.ok(output.includes('--headless'));
  });

  it('generates LoadTestShape for spike traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('LoadTestShape'));
    assert.ok(output.includes('class ScalingsLoadShape'));
    assert.ok(output.includes('def tick'));
    assert.ok(output.includes('spike_start'));
  });

  it('generates LoadTestShape for gradual ramp', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'gradual',
          params: { start_rps: 50, end_rps: 800 } as GradualParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('LoadTestShape'));
    assert.ok(output.includes('progress'));
  });

  it('generates wave shape with math.sin', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'wave',
          params: { base_rps: 300, amplitude: 200, period: 120 } as WaveParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('math.sin'));
    assert.ok(output.includes('import math'));
  });

  it('generates step shape', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'step',
          params: {
            steps: [
              { rps: 100, duration: 120 },
              { rps: 300, duration: 120 },
            ],
          } as StepParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('steps'));
    assert.ok(output.includes('elapsed'));
  });

  it('includes scalings.xyz comment header', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('Generated by scalings.xyz'));
  });

  it('includes type hints', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('def tick(self) -> tuple'));
  });
});

// ---------------------------------------------------------------------------
// JMeter Exporter
// ---------------------------------------------------------------------------
describe('JMeter Exporter', () => {
  const exporter = svc.getExporter('jmeter');

  it('has correct metadata', () => {
    assert.equal(exporter.id, 'jmeter');
    assert.equal(exporter.extension, 'jmx');
  });

  it('generates valid JMX XML for steady traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      },
    });
    const output = exporter.generate(config, 'https://example.com/api', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('<?xml version="1.0"'));
    assert.ok(output.includes('jmeterTestPlan'));
    assert.ok(output.includes('ThreadGroup'));
    assert.ok(output.includes('HTTPSamplerProxy'));
    assert.ok(output.includes('SummaryReport'));
  });

  it('generates Ultimate Thread Group for spike traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('UltimateThreadGroup'));
  });

  it('parses URL components correctly', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://api.example.com:8443/v1/test', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('api.example.com'));
    assert.ok(output.includes('8443'));
    assert.ok(output.includes('/v1/test'));
  });

  it('validates with thread model warning', () => {
    const config = makeConfig();
    const result = exporter.validate(config);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('thread-based model')));
  });

  it('warns about plugin requirement for complex patterns', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const result = exporter.validate(config);
    assert.ok(result.warnings.some(w => w.includes('Ultimate Thread Group plugin')));
  });

  it('includes scalings.xyz comment header', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('Generated by scalings.xyz'));
  });

  it('escapes XML special characters', () => {
    const config = makeConfig({ name: 'Test <script>&"alert"' });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('&lt;script&gt;'));
    assert.ok(output.includes('&amp;'));
    assert.ok(output.includes('&quot;'));
  });
});

// ---------------------------------------------------------------------------
// Artillery Exporter
// ---------------------------------------------------------------------------
describe('Artillery Exporter', () => {
  const exporter = svc.getExporter('artillery');

  it('has correct metadata', () => {
    assert.equal(exporter.id, 'artillery');
    assert.equal(exporter.extension, 'yml');
  });

  it('generates valid Artillery YAML for steady traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('config:'));
    assert.ok(output.includes('target: "https://example.com"'));
    assert.ok(output.includes('phases:'));
    assert.ok(output.includes('arrivalRate: 500'));
    assert.ok(output.includes('scenarios:'));
  });

  it('generates ramp phases for gradual traffic', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'gradual',
          params: { start_rps: 50, end_rps: 800 } as GradualParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('rampTo: 800'));
    assert.ok(output.includes('arrivalRate: 50'));
  });

  it('generates multi-phase spike', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'spike',
          params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('arrivalRate: 200'));
    assert.ok(output.includes('rampTo: 2000'));
    assert.ok(output.includes('Pre-spike baseline'));
  });

  it('generates step function phases', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'step',
          params: {
            steps: [
              { rps: 100, duration: 120 },
              { rps: 300, duration: 120 },
            ],
          } as StepParams,
        },
      },
    });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('arrivalRate: 100'));
    assert.ok(output.includes('arrivalRate: 300'));
    assert.ok(output.includes('Step 1'));
    assert.ok(output.includes('Step 2'));
  });

  it('includes thresholds when results provided', () => {
    const config = makeConfig();
    const results = makeResult({ drop_rate_percent: 5, peak_queue_wait_time_ms: 2000 });
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST, results);
    assert.ok(output.includes('ensure:'));
    assert.ok(output.includes('thresholds:'));
  });

  it('includes scalings.xyz comment header', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('Generated by scalings.xyz'));
  });

  it('includes run command comment', () => {
    const config = makeConfig();
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
    assert.ok(output.includes('npx artillery run'));
  });
});

// ---------------------------------------------------------------------------
// Cross-exporter: all frameworks handle all traffic patterns
// ---------------------------------------------------------------------------
describe('Cross-exporter pattern coverage', () => {
  const frameworks = ['k6', 'gatling', 'locust', 'jmeter', 'artillery'] as const;
  const patterns: { name: string; config: Partial<SimulationConfig> }[] = [
    {
      name: 'steady',
      config: { producer: { traffic: { pattern: 'steady', params: { rps: 500 } as SteadyParams } } },
    },
    {
      name: 'gradual',
      config: { producer: { traffic: { pattern: 'gradual', params: { start_rps: 50, end_rps: 800 } as GradualParams } } },
    },
    {
      name: 'spike',
      config: { producer: { traffic: { pattern: 'spike', params: { base_rps: 200, spike_rps: 2000, spike_start: 120, spike_duration: 60 } as SpikeParams } } },
    },
    {
      name: 'wave',
      config: { producer: { traffic: { pattern: 'wave', params: { base_rps: 300, amplitude: 200, period: 120 } as WaveParams } } },
    },
    {
      name: 'step',
      config: { producer: { traffic: { pattern: 'step', params: { steps: [{ rps: 100, duration: 120 }, { rps: 300, duration: 120 }] } as StepParams } } },
    },
    {
      name: 'custom',
      config: { producer: { traffic: { pattern: 'custom', params: { series: [{ t: 0, rps: 100 }, { t: 60, rps: 500 }, { t: 120, rps: 200 }] } as CustomParams } } },
    },
  ];

  for (const framework of frameworks) {
    for (const pattern of patterns) {
      it(`${framework} generates non-empty output for ${pattern.name} traffic`, () => {
        const config = makeConfig(pattern.config);
        const exporter = svc.getExporter(framework);
        const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
        assert.ok(output.length > 50, `${framework}/${pattern.name}: output too short (${output.length} chars)`);
        assert.ok(output.includes('scalings.xyz'), `${framework}/${pattern.name}: missing scalings.xyz attribution`);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('handles very short duration', () => {
    const config = makeConfig({ simulation: { duration: 5, tick_interval: 1 } });
    for (const framework of ['k6', 'gatling', 'locust', 'jmeter', 'artillery'] as const) {
      const exporter = svc.getExporter(framework);
      const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
      assert.ok(output.length > 0, `${framework}: empty output for short duration`);
    }
  });

  it('handles single-point custom series', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'custom',
          params: { series: [{ t: 0, rps: 100 }] } as CustomParams,
        },
      },
    });
    for (const framework of ['k6', 'gatling', 'locust', 'jmeter', 'artillery'] as const) {
      const exporter = svc.getExporter(framework);
      const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
      assert.ok(output.length > 0, `${framework}: empty output for single-point custom`);
    }
  });

  it('handles empty custom series', () => {
    const config = makeConfig({
      producer: {
        traffic: {
          pattern: 'custom',
          params: { series: [] } as CustomParams,
        },
      },
    });
    for (const framework of ['k6', 'gatling', 'locust', 'jmeter', 'artillery'] as const) {
      const exporter = svc.getExporter(framework);
      const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
      assert.ok(output.length > 0, `${framework}: empty output for empty custom series`);
    }
  });

  it('all validators return valid for default config', () => {
    const config = makeConfig();
    for (const framework of ['k6', 'gatling', 'locust', 'jmeter', 'artillery'] as const) {
      const result = svc.validate(config, framework);
      assert.equal(result.valid, true, `${framework}: should be valid for default config`);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP method, headers, body, and template variables
// ---------------------------------------------------------------------------
describe('Request config — HTTP method', () => {
  const config = makeConfig({
    producer: { traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams } },
  });

  it('k6 uses POST method', () => {
    const output = svc.getExporter('k6').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body: '{"key":"value"}',
    });
    assert.ok(output.includes('http.post('));
    assert.ok(!output.includes('http.get('));
  });

  it('gatling uses PUT method', () => {
    const output = svc.getExporter('gatling').generate(config, 'https://example.com', 100, {
      method: 'PUT', headers: {}, body: '{"key":"value"}',
    });
    assert.ok(output.includes('.put('));
  });

  it('locust uses PATCH method', () => {
    const output = svc.getExporter('locust').generate(config, 'https://example.com', 100, {
      method: 'PATCH', headers: {}, body: '{"key":"value"}',
    });
    assert.ok(output.includes('self.client.patch('));
  });

  it('jmeter uses DELETE method', () => {
    const output = svc.getExporter('jmeter').generate(config, 'https://example.com', 100, {
      method: 'DELETE', headers: {}, body: '',
    });
    assert.ok(output.includes('DELETE'));
    assert.ok(!output.includes('>GET<'));
  });

  it('artillery uses post method', () => {
    const output = svc.getExporter('artillery').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body: '{"key":"value"}',
    });
    assert.ok(output.includes('- post:'));
  });
});

describe('Request config — custom headers', () => {
  const config = makeConfig({
    producer: { traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams } },
  });
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' };

  it('k6 includes custom headers in params', () => {
    const output = svc.getExporter('k6').generate(config, 'https://example.com', 100, {
      method: 'GET', headers, body: '',
    });
    assert.ok(output.includes("'Content-Type'"));
    assert.ok(output.includes("'Authorization'"));
    assert.ok(output.includes('Bearer test-token'));
  });

  it('gatling includes custom headers', () => {
    const output = svc.getExporter('gatling').generate(config, 'https://example.com', 100, {
      method: 'GET', headers, body: '',
    });
    assert.ok(output.includes('Content-Type'));
    assert.ok(output.includes('Bearer test-token'));
  });

  it('locust includes custom headers', () => {
    const output = svc.getExporter('locust').generate(config, 'https://example.com', 100, {
      method: 'GET', headers, body: '',
    });
    assert.ok(output.includes('"Content-Type"'));
    assert.ok(output.includes('Bearer test-token'));
    assert.ok(output.includes('headers=headers'));
  });

  it('jmeter includes HeaderManager', () => {
    const output = svc.getExporter('jmeter').generate(config, 'https://example.com', 100, {
      method: 'GET', headers, body: '',
    });
    assert.ok(output.includes('HeaderManager'));
    assert.ok(output.includes('Content-Type'));
    assert.ok(output.includes('Bearer test-token'));
  });

  it('artillery includes headers in defaults', () => {
    const output = svc.getExporter('artillery').generate(config, 'https://example.com', 100, {
      method: 'GET', headers, body: '',
    });
    assert.ok(output.includes('Content-Type'));
    assert.ok(output.includes('Bearer test-token'));
    assert.ok(output.includes('defaults:'));
  });
});

describe('Request config — body', () => {
  const config = makeConfig({
    producer: { traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams } },
  });
  const body = '{"name":"test","value":42}';

  it('k6 includes body in POST request', () => {
    const output = svc.getExporter('k6').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body,
    });
    assert.ok(output.includes('const body'));
    assert.ok(output.includes('http.post(TARGET_URL, body'));
  });

  it('gatling includes StringBody for POST', () => {
    const output = svc.getExporter('gatling').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body,
    });
    assert.ok(output.includes('body(StringBody'));
  });

  it('locust passes body to request', () => {
    const output = svc.getExporter('locust').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body,
    });
    assert.ok(output.includes('body ='));
    assert.ok(output.includes('self.client.post('));
  });

  it('jmeter includes raw body in POST', () => {
    const output = svc.getExporter('jmeter').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body,
    });
    assert.ok(output.includes('postBodyRaw'));
    assert.ok(output.includes('POST'));
  });

  it('artillery includes json body for POST', () => {
    const output = svc.getExporter('artillery').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body,
    });
    assert.ok(output.includes('post:'));
    assert.ok(output.includes('json:') || output.includes('body:'));
  });

  it('body is ignored for GET requests', () => {
    const k6Output = svc.getExporter('k6').generate(config, 'https://example.com', 100, {
      method: 'GET', headers: {}, body,
    });
    assert.ok(!k6Output.includes('const body'));
    assert.ok(k6Output.includes('http.get('));
  });
});

describe('Request config — template variables', () => {
  const config = makeConfig({
    producer: { traffic: { pattern: 'steady', params: { rps: 100 } as SteadyParams } },
  });
  const bodyWithVars = '{"id": $randInt, "name": "$randString", "email": "$randomEmail"}';

  it('k6 replaces template vars with JS expressions', () => {
    const output = svc.getExporter('k6').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body: bodyWithVars,
    });
    assert.ok(output.includes('Math.random()'));
    assert.ok(output.includes('randomString'));
    assert.ok(!output.includes('$randInt'));
    assert.ok(!output.includes('$randString'));
  });

  it('locust replaces template vars with Python expressions', () => {
    const output = svc.getExporter('locust').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body: bodyWithVars,
    });
    assert.ok(output.includes('random.randint'));
    assert.ok(output.includes('import random'));
    assert.ok(!output.includes('$randInt'));
  });

  it('jmeter replaces template vars with JMeter functions', () => {
    const output = svc.getExporter('jmeter').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body: bodyWithVars,
    });
    assert.ok(output.includes('__Random') || output.includes('__RandomString'));
    assert.ok(!output.includes('$randInt'));
  });

  it('artillery replaces template vars with Artillery helpers', () => {
    const output = svc.getExporter('artillery').generate(config, 'https://example.com', 100, {
      method: 'POST', headers: {}, body: bodyWithVars,
    });
    assert.ok(output.includes('$randomNumber') || output.includes('$randomString'));
    assert.ok(!output.includes('$randInt'));
  });

  it('template vars in headers are also replaced', () => {
    const headersWithVars = { 'X-Request-ID': '$uuid' };
    const k6Output = svc.getExporter('k6').generate(config, 'https://example.com', 100, {
      method: 'GET', headers: headersWithVars, body: '',
    });
    assert.ok(!k6Output.includes("'$uuid'"));
    assert.ok(k6Output.includes('uuidv4'));
  });
});

// ---------------------------------------------------------------------------
// Share URL inclusion & encoding
// ---------------------------------------------------------------------------
describe('Share URL in generated scripts', () => {
  const config = makeConfig();

  it('all frameworks include scalings.xyz share URL in output', () => {
    const frameworks = ['k6', 'gatling', 'locust', 'jmeter', 'artillery'] as const;
    for (const fw of frameworks) {
      const exporter = svc.getExporter(fw);
      const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);
      assert.ok(
        output.includes('scalings.xyz/#config='),
        `${fw} script should include share URL`,
      );
    }
  });

  it('share URL uses Unicode-safe encoding compatible with config service', () => {
    const exporter = svc.getExporter('k6');
    const output = exporter.generate(config, 'https://example.com', 100, DEFAULT_LOAD_TEST_REQUEST);

    // Extract the base64 portion from the share URL
    const match = output.match(/scalings\.xyz\/#config=([A-Za-z0-9+/=]+)/);
    assert.ok(match, 'should contain a base64-encoded config');

    // Decode using the same method as LocalConfigService.fromURL
    const json = decodeURIComponent(escape(atob(match![1])));
    const decoded = JSON.parse(json);
    assert.equal(decoded.simulation.duration, config.simulation.duration);
  });
});
