import { TrafficPatternService, TrafficConfig } from '../interfaces/types.js';
export declare class LocalTrafficPatternService implements TrafficPatternService {
    generate(traffic: TrafficConfig, duration: number, tickInterval: number): number[];
    preview(traffic: TrafficConfig, points?: number): number[];
    private getRPS;
    private steady;
    private gradual;
    private spike;
    private wave;
    private step;
    private custom;
    private getPreviewDuration;
}
