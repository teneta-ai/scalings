import { SimulationResult } from '../interfaces/types.js';
export declare class ChartRenderer {
    private chart;
    private animationFrame;
    private currentIndex;
    private isPlaying;
    private playbackSpeed;
    private result;
    private onAnimationTick;
    private compareChart;
    private compareResult;
    constructor();
    setPlaybackSpeed(speed: number): void;
    setAnimationCallback(cb: (index: number, total: number) => void): void;
    renderAnimated(canvasId: string, result: SimulationResult, playbackSpeed?: number): Promise<void>;
    private animate;
    renderComplete(canvasId: string, result: SimulationResult): void;
    renderCompare(canvasId: string, resultA: SimulationResult, resultB: SimulationResult): void;
    stop(): void;
    destroy(): void;
    private formatTime;
}
export declare class TrafficPreviewRenderer {
    private chart;
    render(canvasId: string, data: number[]): void;
    destroy(): void;
}
