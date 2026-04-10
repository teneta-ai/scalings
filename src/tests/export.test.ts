import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalExportService } from '../services/export.js';
import {
  SimulationConfig,
  DEFAULT_CONFIG,
  DEFAULT_SERVICE,
} from '../interfaces/types.js';

const svc = new LocalExportService();

function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Kubernetes HPA
// ---------------------------------------------------------------------------
describe('ExportService — Kubernetes HPA', () => {
  it('generates valid HPA YAML', () => {
    const config = makeConfig({ platform: 'kubernetes-hpa' });
    const target = svc.generate(config);
    assert.equal(target.platform, 'kubernetes-hpa');
    assert.equal(target.format, 'kubernetes-yaml');
    assert.ok(target.content.includes('kind: HorizontalPodAutoscaler'));
    assert.ok(target.content.includes('apiVersion: autoscaling/v2'));
  });

  it('includes correct replica bounds', () => {
    const config = makeConfig({
      platform: 'kubernetes-hpa',
      service: { ...DEFAULT_SERVICE, min_replicas: 3, max_replicas: 25 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('minReplicas: 3'));
    assert.ok(target.content.includes('maxReplicas: 25'));
  });

  it('includes utilization threshold', () => {
    const config = makeConfig({
      platform: 'kubernetes-hpa',
      service: { ...DEFAULT_SERVICE, scale_up_threshold: 80 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('averageUtilization: 80'));
  });

  it('includes scale behavior', () => {
    const config = makeConfig({
      platform: 'kubernetes-hpa',
      service: { ...DEFAULT_SERVICE, cooldown_scale_up: 90, cooldown_scale_down: 450 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('stabilizationWindowSeconds: 90'));
    assert.ok(target.content.includes('stabilizationWindowSeconds: 450'));
  });

  it('includes step size in policies', () => {
    const config = makeConfig({
      platform: 'kubernetes-hpa',
      service: { ...DEFAULT_SERVICE, scale_up_step: 3, scale_down_step: 2 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('value: 3'));
    assert.ok(target.content.includes('value: 2'));
  });
});

// ---------------------------------------------------------------------------
// AWS ASG
// ---------------------------------------------------------------------------
describe('ExportService — AWS ASG', () => {
  it('generates CloudFormation template', () => {
    const config = makeConfig({ platform: 'aws-asg' });
    const target = svc.generate(config);
    assert.equal(target.platform, 'aws-asg');
    assert.equal(target.format, 'cloudformation');
    assert.ok(target.content.includes('AWSTemplateFormatVersion'));
    assert.ok(target.content.includes('AWS::AutoScaling::AutoScalingGroup'));
  });

  it('includes correct min/max sizes', () => {
    const config = makeConfig({
      platform: 'aws-asg',
      service: { ...DEFAULT_SERVICE, min_replicas: 4, max_replicas: 40 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes("MinSize: '4'"));
    assert.ok(target.content.includes("MaxSize: '40'"));
  });

  it('includes scale up and down policies', () => {
    const config = makeConfig({ platform: 'aws-asg' });
    const target = svc.generate(config);
    assert.ok(target.content.includes('ScaleUpPolicy'));
    assert.ok(target.content.includes('ScaleDownPolicy'));
  });

  it('includes CloudWatch alarms', () => {
    const config = makeConfig({
      platform: 'aws-asg',
      service: { ...DEFAULT_SERVICE, scale_up_threshold: 75, scale_down_threshold: 25 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('HighUtilizationAlarm'));
    assert.ok(target.content.includes('LowUtilizationAlarm'));
    assert.ok(target.content.includes('Threshold: 75'));
    assert.ok(target.content.includes('Threshold: 25'));
  });
});

// ---------------------------------------------------------------------------
// GCP MIG
// ---------------------------------------------------------------------------
describe('ExportService — GCP MIG', () => {
  it('generates Terraform config', () => {
    const config = makeConfig({ platform: 'gcp-mig' });
    const target = svc.generate(config);
    assert.equal(target.platform, 'gcp-mig');
    assert.equal(target.format, 'terraform');
    assert.ok(target.content.includes('google_compute_autoscaler'));
    assert.ok(target.content.includes('google_compute_instance_group_manager'));
  });

  it('includes correct replica bounds', () => {
    const config = makeConfig({
      platform: 'gcp-mig',
      service: { ...DEFAULT_SERVICE, min_replicas: 2, max_replicas: 30 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('min_replicas    = 2'));
    assert.ok(target.content.includes('max_replicas    = 30'));
  });

  it('includes CPU utilization target as decimal', () => {
    const config = makeConfig({
      platform: 'gcp-mig',
      service: { ...DEFAULT_SERVICE, scale_up_threshold: 65 },
    });
    const target = svc.generate(config);
    assert.ok(target.content.includes('target = 0.65'));
  });

  it('includes health check', () => {
    const config = makeConfig({ platform: 'gcp-mig' });
    const target = svc.generate(config);
    assert.ok(target.content.includes('google_compute_health_check'));
    assert.ok(target.content.includes('/health'));
  });
});

// ---------------------------------------------------------------------------
// Custom
// ---------------------------------------------------------------------------
describe('ExportService — Custom', () => {
  it('generates generic config', () => {
    const config = makeConfig({ platform: 'custom' });
    const target = svc.generate(config);
    assert.equal(target.platform, 'custom');
    assert.ok(target.content.includes('autoscaling:'));
    assert.ok(target.content.includes('min_instances'));
    assert.ok(target.content.includes('max_instances'));
  });
});

// ---------------------------------------------------------------------------
// Platform selection
// ---------------------------------------------------------------------------
describe('ExportService — platform routing', () => {
  it('routes to correct generator based on platform', () => {
    const platforms = ['kubernetes-hpa', 'aws-asg', 'gcp-mig', 'custom'] as const;
    for (const platform of platforms) {
      const config = makeConfig({ platform });
      const target = svc.generate(config);
      assert.equal(target.platform, platform, `platform mismatch for ${platform}`);
    }
  });
});
