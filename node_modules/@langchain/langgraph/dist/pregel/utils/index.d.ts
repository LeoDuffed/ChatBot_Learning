import { Callbacks } from "@langchain/core/callbacks/manager";
import { RunnableConfig } from "@langchain/core/runnables";
import type { ChannelVersions, CheckpointMetadata } from "@langchain/langgraph-checkpoint";
export declare function getNullChannelVersion(currentVersions: ChannelVersions): 0 | "" | undefined;
export declare function getNewChannelVersions(previousVersions: ChannelVersions, currentVersions: ChannelVersions): ChannelVersions;
export declare function _coerceToDict(value: any, defaultKey: string): any;
export type RetryPolicy = {
    /**
     * Amount of time that must elapse before the first retry occurs in milliseconds.
     * @default 500
     */
    initialInterval?: number;
    /**
     * Multiplier by which the interval increases after each retry.
     * @default 2
     */
    backoffFactor?: number;
    /**
     * Maximum amount of time that may elapse between retries in milliseconds.
     * @default 128000
     */
    maxInterval?: number;
    /**
     * Maximum amount of time that may elapse between retries.
     * @default 3
     */
    maxAttempts?: number;
    /** Whether to add random jitter to the interval between retries. */
    jitter?: boolean;
    /** A function that returns True for exceptions that should trigger a retry. */
    retryOn?: (e: any) => boolean;
    /** Whether to log a warning when a retry is attempted. Defaults to true. */
    logWarning?: boolean;
};
/**
 * Configuration for caching nodes.
 */
export type CachePolicy = {
    /**
     * A function used to generate a cache key from node's input.
     * @returns A key for the cache.
     */
    keyFunc?: (args: unknown[]) => string;
    /**
     * The time to live for the cache in seconds.
     * If not defined, the entry will never expire.
     */
    ttl?: number;
};
export declare function patchConfigurable(config: RunnableConfig | undefined, patch: Record<string, any>): RunnableConfig;
export declare function patchCheckpointMap(config: RunnableConfig, metadata?: CheckpointMetadata): RunnableConfig;
/**
 * Combine multiple abort signals into a single abort signal.
 * @param signals - The abort signals to combine.
 * @returns A combined abort signal and a dispose function to remove the abort listener if unused.
 */
export declare function combineAbortSignals(...x: (AbortSignal | undefined)[]): {
    signal: AbortSignal | undefined;
    dispose?: () => void;
};
/**
 * Combine multiple callbacks into a single callback.
 * @param callback1 - The first callback to combine.
 * @param callback2 - The second callback to combine.
 * @returns A single callback that is a combination of the input callbacks.
 */
export declare const combineCallbacks: (callback1?: Callbacks, callback2?: Callbacks) => Callbacks | undefined;
