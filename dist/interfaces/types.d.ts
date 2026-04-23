export type Platform = 'kubernetes-hpa' | 'aws-asg' | 'gcp-mig' | 'custom';
export type TargetFormat = 'kubernetes-yaml' | 'cloudformation' | 'terraform' | 'gcloud-cli';
export type TrafficPatternType = 'steady' | 'gradual' | 'spike' | 'wave' | 'step' | 'custom' | 'grafana';
export interface SimulationParams {
    duration: number;
    tick_interval: number;
}
export interface ProducerConfig {
    traffic: TrafficConfig;
}
export type RetryStrategy = 'fixed' | 'exponential' | 'exponential-jitter';
export interface ClientConfig {
    max_retries: number;
    retry_delay: number;
    retry_strategy: RetryStrategy;
}
export interface BrokerConfig {
    enabled: boolean;
    max_size: number;
    request_timeout_ms: number;
}
export interface ServiceConfig {
    min_replicas: number;
    max_replicas: number;
    scale_up_threshold: number;
    scale_down_threshold: number;
    capacity_per_replica: number;
    startup_time: number;
    scale_up_step: number;
    scale_down_step: number;
    metric_observation_delay: number;
    cooldown_scale_up: number;
    cooldown_scale_down: number;
    node_provisioning_time: number;
    cluster_node_capacity: number;
    pods_per_node: number;
    graceful_shutdown_time: number;
    cost_per_replica_hour: number;
    saturation_threshold: number;
    max_capacity_reduction: number;
    pod_failure_rate: number;
    random_seed: number;
    failure_events: FailureEvent[];
}
export interface FailureEvent {
    time: number;
    count: number;
}
export interface SteadyParams {
    rps: number;
}
export interface GradualParams {
    start_rps: number;
    end_rps: number;
}
export interface SpikeParams {
    base_rps: number;
    spike_rps: number;
    spike_start: number;
    spike_duration: number;
}
export interface WaveParams {
    base_rps: number;
    amplitude: number;
    period: number;
}
export interface StepEntry {
    rps: number;
    duration: number;
}
export interface StepParams {
    steps: StepEntry[];
}
export interface CustomTimePoint {
    t: number;
    rps: number;
}
export interface CustomParams {
    series: CustomTimePoint[];
}
export interface GrafanaParams {
    series: CustomTimePoint[];
    raw_csv: string;
    value_unit: 'rps' | 'rpm' | 'rph';
}
export type PatternParams = SteadyParams | GradualParams | SpikeParams | WaveParams | StepParams | CustomParams | GrafanaParams;
export interface TrafficConfig {
    pattern: TrafficPatternType;
    params: PatternParams;
}
export interface SimulationConfig {
    version: number;
    name: string;
    description?: string;
    platform: Platform;
    simulation: SimulationParams;
    producer: ProducerConfig;
    client: ClientConfig;
    broker: BrokerConfig;
    service: ServiceConfig;
}
export interface TargetConfig {
    platform: Platform;
    format: TargetFormat;
    content: string;
}
export type PodState = 'starting' | 'running' | 'shutting_down';
export interface Pod {
    id: number;
    state: PodState;
    stateTimer: number;
    needsNodeProvisioning: boolean;
}
export interface TickSnapshot {
    time: number;
    traffic_rps: number;
    capacity_rps: number;
    running_pods: number;
    total_pods: number;
    starting_pods: number;
    shutting_down_pods: number;
    served_requests: number;
    dropped_requests: number;
    queue_depth: number;
    queue_wait_time_ms: number;
    expired_requests: number;
    retry_requests: number;
    effective_capacity_rps: number;
    utilization: number;
    delayed_utilization: number;
    estimated_cost: number;
    scale_event: 'up' | 'down' | null;
    log_entries: string[];
}
export interface SimulationResult {
    run_id: string;
    snapshots: TickSnapshot[];
    summary: SimulationSummary;
}
export interface SimulationSummary {
    total_requests: number;
    total_served: number;
    total_dropped: number;
    drop_rate_percent: number;
    peak_pod_count: number;
    min_pod_count: number;
    peak_queue_depth: number;
    avg_queue_wait_time_ms: number;
    peak_queue_wait_time_ms: number;
    total_expired: number;
    total_retries: number;
    time_under_provisioned_seconds: number;
    time_under_provisioned_percent: number;
    time_to_recover_seconds: number | null;
    estimated_total_cost: number;
}
export type LoadTestFramework = 'k6' | 'gatling' | 'locust' | 'jmeter' | 'artillery';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/**
 * Template variables available in body and header values.
 * Each exporter maps these to framework-native syntax.
 *
 *   $randInt        — random integer 0–10000
 *   $randString     — random alphanumeric string (10 chars)
 *   $uuid           — UUID v4
 *   $timestamp      — current Unix timestamp (ms)
 *   $randFloat      — random float 0.0–1.0
 *   $randomEmail    — random email address
 */
export declare const LOAD_TEST_TEMPLATE_VARS: readonly ["$randInt", "$randString", "$uuid", "$timestamp", "$randFloat", "$randomEmail"];
export type LoadTestTemplateVar = typeof LOAD_TEST_TEMPLATE_VARS[number];
export interface LoadTestRequestConfig {
    method: HttpMethod;
    headers: Record<string, string>;
    body: string;
}
export interface LoadTestValidationResult {
    valid: boolean;
    warnings: string[];
    errors: string[];
}
export interface LoadTestExporter {
    /** Framework identifier */
    readonly id: LoadTestFramework;
    /** Human-readable framework name */
    readonly name: string;
    /** File extension for the exported script */
    readonly extension: string;
    /** Generate the load test script from simulation config */
    generate(config: SimulationConfig, targetUrl: string, avgResponseTime: number, request: LoadTestRequestConfig, results?: SimulationResult): string;
    /** Validate that the config can be exported to this framework */
    validate(config: SimulationConfig): LoadTestValidationResult;
}
export interface LoadTestExportOptions {
    framework: LoadTestFramework;
    targetUrl: string;
    avgResponseTimeMs: number;
    request: LoadTestRequestConfig;
}
export interface SimulationService {
    run(config: SimulationConfig): Promise<SimulationResult>;
}
export interface ConfigService {
    export(config: SimulationConfig): string;
    import(yaml: string): SimulationConfig;
    toURL(config: SimulationConfig): string;
    fromURL(hash: string): SimulationConfig;
    saveLocal(config: SimulationConfig): void;
    loadLocal(): SimulationConfig | null;
}
export interface ExportService {
    generate(config: SimulationConfig): TargetConfig;
}
export interface TrafficPatternService {
    generate(pattern: TrafficConfig, duration: number, tickInterval: number): number[];
    preview(pattern: TrafficConfig, points?: number): number[];
}
/** Identity of the current user. All fields optional so anonymous or partially-known users are representable. */
export interface UserContext {
    id?: string;
    email?: string;
    team?: string;
}
/**
 * Reads the current user identity. Enables future team- and permission-scoping
 * without changing callers. The default implementation returns null (anonymous);
 * swap for an auth-backed implementation in factory.ts when sign-in lands.
 */
export interface UserContextService {
    getCurrentUser(): UserContext | null;
}
export interface LoadTestExportService {
    getExporter(framework: LoadTestFramework): LoadTestExporter;
    getAvailableFrameworks(): {
        id: LoadTestFramework;
        name: string;
    }[];
    generate(config: SimulationConfig, options: LoadTestExportOptions, results?: SimulationResult): string;
    validate(config: SimulationConfig, framework: LoadTestFramework): LoadTestValidationResult;
}
export declare const DEFAULT_LOAD_TEST_REQUEST: LoadTestRequestConfig;
export interface PresetScenario {
    name: string;
    description: string;
    config: Partial<SimulationConfig>;
}
export declare const DEFAULT_SIMULATION: SimulationParams;
export declare const DEFAULT_TRAFFIC: TrafficConfig;
export declare const DEFAULT_PRODUCER: ProducerConfig;
export declare const DEFAULT_CLIENT: ClientConfig;
export declare const DEFAULT_BROKER: BrokerConfig;
export declare const DEFAULT_SERVICE: ServiceConfig;
export declare const DEFAULT_CONFIG: SimulationConfig;
export declare const PRESET_SCENARIOS: PresetScenario[];
