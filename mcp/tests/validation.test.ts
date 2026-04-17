// ============================================================================
// Tests for config validation + merging with defaults.
// ============================================================================

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mergeWithDefaults, validateSimulationConfig } from '../validation.js';
import { DEFAULT_CONFIG, DEFAULT_SERVICE } from '../../src/interfaces/types.js';

describe('mergeWithDefaults', () => {
  it('fills missing fields from DEFAULT_CONFIG', () => {
    const merged = mergeWithDefaults({});
    assert.deepEqual(merged.service, DEFAULT_CONFIG.service);
    assert.deepEqual(merged.producer, DEFAULT_CONFIG.producer);
    assert.deepEqual(merged.client, DEFAULT_CONFIG.client);
    assert.deepEqual(merged.broker, DEFAULT_CONFIG.broker);
    assert.deepEqual(merged.simulation, DEFAULT_CONFIG.simulation);
  });

  it('deep-merges service overrides without losing defaults', () => {
    const merged = mergeWithDefaults({ service: { max_replicas: 200 } });
    assert.equal(merged.service.max_replicas, 200);
    assert.equal(merged.service.min_replicas, DEFAULT_SERVICE.min_replicas);
    assert.equal(merged.service.capacity_per_replica, DEFAULT_SERVICE.capacity_per_replica);
  });

  it('deep-merges nested producer.traffic', () => {
    const merged = mergeWithDefaults({
      producer: { traffic: { pattern: 'steady', params: { rps: 42 } } },
    });
    assert.equal(merged.producer.traffic.pattern, 'steady');
    // Pattern params should be replaced wholesale (not deep-merged) because pattern changed.
    assert.deepEqual(merged.producer.traffic.params, { rps: 42 });
  });

  it('preserves DEFAULT traffic params when only pattern is unchanged', () => {
    // If the caller only provides partial traffic.params for the same pattern,
    // missing sub-fields should NOT silently inherit defaults from a different pattern.
    // Our simplified merge: missing params = default traffic config.
    const merged = mergeWithDefaults({});
    assert.deepEqual(merged.producer.traffic, DEFAULT_CONFIG.producer.traffic);
  });
});

describe('validateSimulationConfig', () => {
  it('accepts a valid fully-formed config', () => {
    const result = validateSimulationConfig(DEFAULT_CONFIG);
    assert.equal(result.valid, true);
  });

  it('accepts completely empty partial config (merges with defaults)', () => {
    const result = validateSimulationConfig(mergeWithDefaults({}));
    assert.equal(result.valid, true);
  });

  it('accepts config with only service overrides', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ service: { min_replicas: 3 } }),
    );
    assert.equal(result.valid, true);
  });

  it('rejects duration > 3600', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ simulation: { duration: 4000, tick_interval: 1 } }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(e => e.field === 'simulation.duration'));
    }
  });

  it('rejects tick_interval < 0.5', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ simulation: { duration: 60, tick_interval: 0.1 } }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(e => e.field === 'simulation.tick_interval'));
    }
  });

  it('rejects max_replicas > 1000', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ service: { max_replicas: 5000 } }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      const err = result.errors.find(e => e.field === 'service.max_replicas');
      assert.ok(err);
      assert.match(err!.message, /1000/);
    }
  });

  it('rejects min_replicas > max_replicas', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ service: { min_replicas: 50, max_replicas: 10 } }),
    );
    assert.equal(result.valid, false);
  });

  it('rejects scale_down_threshold >= scale_up_threshold', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ service: { scale_up_threshold: 50, scale_down_threshold: 60 } }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(e => e.field.includes('scale_down_threshold')));
    }
  });

  it('rejects negative numeric values', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ service: { min_replicas: -1 } }),
    );
    assert.equal(result.valid, false);
  });

  it('rejects NaN and Infinity values', () => {
    const resultNaN = validateSimulationConfig(
      mergeWithDefaults({ service: { capacity_per_replica: NaN } }),
    );
    assert.equal(resultNaN.valid, false);

    const resultInf = validateSimulationConfig(
      mergeWithDefaults({ service: { capacity_per_replica: Infinity } }),
    );
    assert.equal(resultInf.valid, false);
  });

  it('rejects unknown traffic pattern type', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({
        producer: { traffic: { pattern: 'bogus' as never, params: {} as never } },
      }),
    );
    assert.equal(result.valid, false);
  });

  it('rejects traffic params that do not match declared pattern', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({
        producer: { traffic: { pattern: 'spike', params: { rps: 100 } as never } },
      }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(e => e.field.startsWith('producer.traffic.params')));
    }
  });

  it('rejects failure_events timestamps outside simulation duration', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({
        simulation: { duration: 60, tick_interval: 1 },
        service: { failure_events: [{ time: 9999, count: 1 }] },
      }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(e => e.field.includes('failure_events')));
    }
  });

  it('error messages include the offending value and field', () => {
    const result = validateSimulationConfig(
      mergeWithDefaults({ service: { max_replicas: 5000 } }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      const err = result.errors.find(e => e.field === 'service.max_replicas');
      assert.ok(err);
      assert.equal(err!.value, 5000);
      assert.ok(err!.message.length > 0);
    }
  });
});
