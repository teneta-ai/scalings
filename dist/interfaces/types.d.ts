export type Platform = 'kubernetes-hpa' | 'aws-asg' | 'gcp-mig' | 'custom';
export type TargetFormat = 'kubernetes-yaml' | 'cloudformation' | 'terraform' | 'gcloud-cli';
export type TrafficPatternType = 'steady' | 'gradual' | 'spike' | 'wave' | 'step' | 'custom';
export interface SimulationParams {
    duration: number;
    tick_interval: number;
}
export interface ScalingParams {
    min_replicas: number;
    max_replicas: number;
    scale_up_threshold: number;
    scale_down_threshold: number;
    capacity_per_replica: number;
    startup_time: number;
    scale_up_step: number;
    scale_down_step: number;
}
export interface AdvancedParams {
    metric_observation_delay: number;
    cooldown_scale_up: number;
    cooldown_scale_down: number;
    node_provisioning_time: number;
    cluster_node_capacity: number;
    pod_failure_rate: number;
    graceful_shutdown_time: number;
    cost_per_replica_hour: number;
}
export interface SteadyParams {
    rps: number;
}
export interface GradualParams {
    start_rps: number;
    end_rps: number;
    duration: number;
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
export type PatternParams = SteadyParams | GradualParams | SpikeParams | WaveParams | StepParams | CustomParams;
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
    scaling: ScalingParams;
    advanced: AdvancedParams;
    traffic: TrafficConfig;
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
    utilization: number;
    delayed_utilization: number;
    estimated_cost: number;
    scale_event: 'up' | 'down' | null;
    response_time_ms: number;
}
export interface SimulationResult {
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
    time_under_provisioned_seconds: number;
    time_under_provisioned_percent: number;
    time_to_recover_seconds: number | null;
    estimated_total_cost: number;
    max_response_time_ms: number;
    avg_response_time_ms: number;
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
export interface PresetScenario {
    name: string;
    description: string;
    config: Partial<SimulationConfig>;
}
export declare const DEFAULT_SCALING: ScalingParams;
export declare const DEFAULT_ADVANCED: AdvancedParams;
export declare const DEFAULT_SIMULATION: SimulationParams;
export declare const DEFAULT_TRAFFIC: TrafficConfig;
export declare const DEFAULT_CONFIG: SimulationConfig;
export declare const PRESET_SCENARIOS: PresetScenario[];
