import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatTime, formatTooltipLabel } from '../ui/chart.js';

// ---------------------------------------------------------------------------
// formatTime — seconds → M:SS display string
// ---------------------------------------------------------------------------
describe('formatTime', () => {
  it('formats zero seconds', () => {
    assert.equal(formatTime(0), '0:00');
  });

  it('formats seconds under a minute', () => {
    assert.equal(formatTime(5), '0:05');
    assert.equal(formatTime(30), '0:30');
    assert.equal(formatTime(59), '0:59');
  });

  it('formats exact minutes', () => {
    assert.equal(formatTime(60), '1:00');
    assert.equal(formatTime(120), '2:00');
    assert.equal(formatTime(300), '5:00');
  });

  it('formats minutes and seconds', () => {
    assert.equal(formatTime(90), '1:30');
    assert.equal(formatTime(125), '2:05');
    assert.equal(formatTime(3599), '59:59');
  });

  it('pads single-digit seconds with zero', () => {
    assert.equal(formatTime(61), '1:01');
    assert.equal(formatTime(609), '10:09');
  });

  it('truncates fractional seconds', () => {
    assert.equal(formatTime(1.7), '0:01');
    assert.equal(formatTime(59.9), '0:59');
    assert.equal(formatTime(60.5), '1:00');
  });
});

// ---------------------------------------------------------------------------
// formatTooltipLabel — dataset-aware value formatting
// ---------------------------------------------------------------------------
describe('formatTooltipLabel', () => {
  it('formats pod counts as integers', () => {
    assert.equal(formatTooltipLabel('Running Pods', 5), ' Running Pods: 5');
    assert.equal(formatTooltipLabel('Run 1 Pods', 12), ' Run 1 Pods: 12');
  });

  it('formats wait time in milliseconds', () => {
    assert.equal(formatTooltipLabel('Queue Wait', 350), ' Queue Wait: 350ms');
    assert.equal(formatTooltipLabel('Queue Wait', 0), ' Queue Wait: 0ms');
    assert.equal(formatTooltipLabel('Queue Wait', 999), ' Queue Wait: 999ms');
  });

  it('formats wait time in seconds when >= 1000ms', () => {
    assert.equal(formatTooltipLabel('Queue Wait', 1000), ' Queue Wait: 1.0s');
    assert.equal(formatTooltipLabel('Queue Wait', 1500), ' Queue Wait: 1.5s');
    assert.equal(formatTooltipLabel('Queue Wait', 25000), ' Queue Wait: 25.0s');
  });

  it('formats RPS values with comma separation', () => {
    const result = formatTooltipLabel('Traffic (RPS)', 1234);
    assert.ok(result.includes('Traffic (RPS)'));
    assert.ok(result.includes('1'));
    assert.ok(result.includes('234'));
  });

  it('rounds fractional RPS values', () => {
    const result = formatTooltipLabel('Traffic (RPS)', 99.7);
    assert.ok(result.includes('100'));
  });

  it('formats capacity values', () => {
    const result = formatTooltipLabel('Capacity (RPS)', 5000);
    assert.ok(result.includes('Capacity (RPS)'));
    assert.ok(result.includes('5'));
    assert.ok(result.includes('000'));
  });

  it('formats dropped requests', () => {
    const result = formatTooltipLabel('Dropped (RPS)', 42);
    assert.ok(result.includes('Dropped (RPS)'));
    assert.ok(result.includes('42'));
  });

  it('formats queue depth', () => {
    const result = formatTooltipLabel('Queue Depth', 250);
    assert.ok(result.includes('Queue Depth'));
    assert.ok(result.includes('250'));
  });
});
