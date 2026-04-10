import { SimulationResult } from '../interfaces/types.js';
export declare class ChartRenderer {
    private chart;
    private animationFrame;
    private currentIndex;
    private isPlaying;
    private playbackSpeed;
    private result;
    private onAnimationTick;
    /** Maps dataset labels to their index in the current chart for safe lookup. */
    private datasetIndex;
    constructor();
    setPlaybackSpeed(speed: number): void;
    setAnimationCallback(cb: (index: number, total: number) => void): void;
    private buildScales;
    private buildPlugins;
    /** Builds the standard simulation datasets. Pass empty arrays for animated (progressive) mode. */
    private buildDatasets;
    /** Builds a label -> index map for safe dataset access by name. */
    private indexDatasets;
    private getDatasetByLabel;
    renderAnimated(canvasId: string, result: SimulationResult, playbackSpeed?: number): Promise<void>;
    private animate;
    renderComplete(canvasId: string, result: SimulationResult): void;
    renderMultiRun(canvasId: string, runs: {
        name: string;
        result: SimulationResult;
    }[]): void;
    stop(): void;
    destroy(): void;
    private formatTime;
}
export declare class TrafficPreviewRenderer {
    private chart;
    render(canvasId: string, data: number[]): void;
    destroy(): void;
}
