import { SimulationResult } from '../interfaces/types.js';
/** Format seconds into M:SS display string */
export declare function formatTime(seconds: number): string;
/** Format a tooltip label based on dataset type */
export declare function formatTooltipLabel(datasetLabel: string, value: number): string;
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
    /** Enable the y2 axis if a wait time dataset is present. */
    private enableY2IfNeeded;
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
}
export declare class TrafficPreviewRenderer {
    private chart;
    render(canvasId: string, data: number[]): void;
    destroy(): void;
}
