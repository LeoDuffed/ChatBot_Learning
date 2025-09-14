"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PregelLoop = void 0;
const langgraph_checkpoint_1 = require("@langchain/langgraph-checkpoint");
const base_js_1 = require("../channels/base.cjs");
const constants_js_1 = require("../constants.cjs");
const algo_js_1 = require("./algo.cjs");
const utils_js_1 = require("../utils.cjs");
const io_js_1 = require("./io.cjs");
const errors_js_1 = require("../errors.cjs");
const index_js_1 = require("./utils/index.cjs");
const debug_js_1 = require("./debug.cjs");
const stream_js_1 = require("./stream.cjs");
const hash_js_1 = require("../hash.cjs");
const INPUT_DONE = Symbol.for("INPUT_DONE");
const INPUT_RESUMING = Symbol.for("INPUT_RESUMING");
const DEFAULT_LOOP_LIMIT = 25;
function createDuplexStream(...streams) {
    return new stream_js_1.IterableReadableWritableStream({
        passthroughFn: (value) => {
            for (const stream of streams) {
                if (stream.modes.has(value[1])) {
                    stream.push(value);
                }
            }
        },
        modes: new Set(streams.flatMap((s) => Array.from(s.modes))),
    });
}
class AsyncBatchedCache extends langgraph_checkpoint_1.BaseCache {
    constructor(cache) {
        super();
        Object.defineProperty(this, "cache", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "queue", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Promise.resolve()
        });
        this.cache = cache;
    }
    async get(keys) {
        return this.enqueueOperation("get", keys);
    }
    async set(pairs) {
        return this.enqueueOperation("set", pairs);
    }
    async clear(namespaces) {
        return this.enqueueOperation("clear", namespaces);
    }
    async stop() {
        await this.queue;
    }
    enqueueOperation(type, ...args) {
        const newPromise = this.queue.then(() => {
            // @ts-expect-error Tuple type warning
            return this.cache[type](...args);
        });
        this.queue = newPromise.then(() => void 0, () => void 0);
        return newPromise;
    }
}
class PregelLoop {
    get isResuming() {
        let hasChannelVersions = false;
        if (constants_js_1.START in this.checkpoint.channel_versions) {
            // For common channels, we can short-circuit the check
            hasChannelVersions = true;
        }
        else {
            for (const chan in this.checkpoint.channel_versions) {
                if (Object.prototype.hasOwnProperty.call(this.checkpoint.channel_versions, chan)) {
                    hasChannelVersions = true;
                    break;
                }
            }
        }
        const configHasResumingFlag = this.config.configurable?.[constants_js_1.CONFIG_KEY_RESUMING] !== undefined;
        const configIsResuming = configHasResumingFlag && this.config.configurable?.[constants_js_1.CONFIG_KEY_RESUMING];
        const inputIsNullOrUndefined = this.input === null || this.input === undefined;
        const inputIsCommandResuming = (0, constants_js_1.isCommand)(this.input) && this.input.resume != null;
        const inputIsResuming = this.input === INPUT_RESUMING;
        const runIdMatchesPrevious = !this.isNested &&
            this.config.metadata?.run_id !== undefined &&
            this.checkpointMetadata?.run_id !== undefined &&
            this.config.metadata.run_id ===
                this.checkpointMetadata?.run_id;
        return (hasChannelVersions &&
            (configIsResuming ||
                inputIsNullOrUndefined ||
                inputIsCommandResuming ||
                inputIsResuming ||
                runIdMatchesPrevious));
    }
    constructor(params) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.defineProperty(this, "input", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.defineProperty(this, "output", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointerGetNextVersion", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "channels", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpoint", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointIdSaved", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointConfig", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointMetadata", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointNamespace", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointPendingWrites", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "checkpointPreviousVersions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "step", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "stop", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "durability", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "outputKeys", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "streamKeys", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "nodes", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "skipDoneTasks", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "prevCheckpointConfig", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "status", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "pending"
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.defineProperty(this, "tasks", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.defineProperty(this, "stream", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "checkpointerPromises", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "isNested", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_checkpointerChainedPromise", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Promise.resolve()
        });
        Object.defineProperty(this, "store", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "cache", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "manager", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "interruptAfter", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "interruptBefore", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "toInterrupt", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "debug", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "triggerToNodes", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.input = params.input;
        this.checkpointer = params.checkpointer;
        // TODO: if managed values no longer needs graph we can replace with
        // managed_specs, channel_specs
        if (this.checkpointer !== undefined) {
            this.checkpointerGetNextVersion = this.checkpointer.getNextVersion.bind(this.checkpointer);
        }
        else {
            this.checkpointerGetNextVersion = algo_js_1.increment;
        }
        this.checkpoint = params.checkpoint;
        this.checkpointMetadata = params.checkpointMetadata;
        this.checkpointPreviousVersions = params.checkpointPreviousVersions;
        this.channels = params.channels;
        this.checkpointPendingWrites = params.checkpointPendingWrites;
        this.step = params.step;
        this.stop = params.stop;
        this.config = params.config;
        this.checkpointConfig = params.checkpointConfig;
        this.isNested = params.isNested;
        this.manager = params.manager;
        this.outputKeys = params.outputKeys;
        this.streamKeys = params.streamKeys;
        this.nodes = params.nodes;
        this.skipDoneTasks = params.skipDoneTasks;
        this.store = params.store;
        this.cache = params.cache ? new AsyncBatchedCache(params.cache) : undefined;
        this.stream = params.stream;
        this.checkpointNamespace = params.checkpointNamespace;
        this.prevCheckpointConfig = params.prevCheckpointConfig;
        this.interruptAfter = params.interruptAfter;
        this.interruptBefore = params.interruptBefore;
        this.durability = params.durability;
        this.debug = params.debug;
        this.triggerToNodes = params.triggerToNodes;
    }
    static async initialize(params) {
        let { config, stream } = params;
        if (stream !== undefined &&
            config.configurable?.[constants_js_1.CONFIG_KEY_STREAM] !== undefined) {
            stream = createDuplexStream(stream, config.configurable[constants_js_1.CONFIG_KEY_STREAM]);
        }
        const skipDoneTasks = config.configurable
            ? !("checkpoint_id" in config.configurable)
            : true;
        const scratchpad = config.configurable?.[constants_js_1.CONFIG_KEY_SCRATCHPAD];
        if (config.configurable && scratchpad) {
            if (scratchpad.subgraphCounter > 0) {
                config = (0, index_js_1.patchConfigurable)(config, {
                    [constants_js_1.CONFIG_KEY_CHECKPOINT_NS]: [
                        config.configurable[constants_js_1.CONFIG_KEY_CHECKPOINT_NS],
                        scratchpad.subgraphCounter.toString(),
                    ].join(constants_js_1.CHECKPOINT_NAMESPACE_SEPARATOR),
                });
            }
            scratchpad.subgraphCounter += 1;
        }
        const isNested = constants_js_1.CONFIG_KEY_READ in (config.configurable ?? {});
        if (!isNested &&
            config.configurable?.checkpoint_ns !== undefined &&
            config.configurable?.checkpoint_ns !== "") {
            config = (0, index_js_1.patchConfigurable)(config, {
                checkpoint_ns: "",
                checkpoint_id: undefined,
            });
        }
        let checkpointConfig = config;
        if (config.configurable?.[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP] !== undefined &&
            config.configurable?.[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP]?.[config.configurable?.checkpoint_ns]) {
            checkpointConfig = (0, index_js_1.patchConfigurable)(config, {
                checkpoint_id: config.configurable[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP][config.configurable?.checkpoint_ns],
            });
        }
        const checkpointNamespace = config.configurable?.checkpoint_ns?.split(constants_js_1.CHECKPOINT_NAMESPACE_SEPARATOR) ?? [];
        const saved = (await params.checkpointer?.getTuple(checkpointConfig)) ?? {
            config,
            checkpoint: (0, langgraph_checkpoint_1.emptyCheckpoint)(),
            metadata: { source: "input", step: -2, parents: {} },
            pendingWrites: [],
        };
        checkpointConfig = {
            ...config,
            ...saved.config,
            configurable: {
                checkpoint_ns: "",
                ...config.configurable,
                ...saved.config.configurable,
            },
        };
        const prevCheckpointConfig = saved.parentConfig;
        const checkpoint = (0, langgraph_checkpoint_1.copyCheckpoint)(saved.checkpoint);
        const checkpointMetadata = { ...saved.metadata };
        const checkpointPendingWrites = saved.pendingWrites ?? [];
        const channels = (0, base_js_1.emptyChannels)(params.channelSpecs, checkpoint);
        const step = (checkpointMetadata.step ?? 0) + 1;
        const stop = step + (config.recursionLimit ?? DEFAULT_LOOP_LIMIT) + 1;
        const checkpointPreviousVersions = { ...checkpoint.channel_versions };
        const store = params.store
            ? new langgraph_checkpoint_1.AsyncBatchedStore(params.store)
            : undefined;
        if (store) {
            // Start the store. This is a batch store, so it will run continuously
            await store.start();
        }
        return new PregelLoop({
            input: params.input,
            config,
            checkpointer: params.checkpointer,
            checkpoint,
            checkpointMetadata,
            checkpointConfig,
            prevCheckpointConfig,
            checkpointNamespace,
            channels,
            isNested,
            manager: params.manager,
            skipDoneTasks,
            step,
            stop,
            checkpointPreviousVersions,
            checkpointPendingWrites,
            outputKeys: params.outputKeys ?? [],
            streamKeys: params.streamKeys ?? [],
            nodes: params.nodes,
            stream,
            store,
            cache: params.cache,
            interruptAfter: params.interruptAfter,
            interruptBefore: params.interruptBefore,
            durability: params.durability,
            debug: params.debug,
            triggerToNodes: params.triggerToNodes,
        });
    }
    _checkpointerPutAfterPrevious(input) {
        this._checkpointerChainedPromise = this._checkpointerChainedPromise.then(() => {
            return this.checkpointer?.put(input.config, input.checkpoint, input.metadata, input.newVersions);
        });
        this.checkpointerPromises.push(this._checkpointerChainedPromise);
    }
    /**
     * Put writes for a task, to be read by the next tick.
     * @param taskId
     * @param writes
     */
    putWrites(taskId, writes) {
        let writesCopy = writes;
        if (writesCopy.length === 0)
            return;
        // deduplicate writes to special channels, last write wins
        if (writesCopy.every(([key]) => key in langgraph_checkpoint_1.WRITES_IDX_MAP)) {
            writesCopy = Array.from(new Map(writesCopy.map((w) => [w[0], w])).values());
        }
        // remove existing writes for this task
        this.checkpointPendingWrites = this.checkpointPendingWrites.filter((w) => w[0] !== taskId);
        // save writes
        for (const [c, v] of writesCopy) {
            this.checkpointPendingWrites.push([taskId, c, v]);
        }
        const config = (0, index_js_1.patchConfigurable)(this.checkpointConfig, {
            [constants_js_1.CONFIG_KEY_CHECKPOINT_NS]: this.config.configurable?.checkpoint_ns ?? "",
            [constants_js_1.CONFIG_KEY_CHECKPOINT_ID]: this.checkpoint.id,
        });
        if (this.durability !== "exit" && this.checkpointer != null) {
            this.checkpointerPromises.push(this.checkpointer.putWrites(config, writesCopy, taskId));
        }
        if (this.tasks) {
            this._outputWrites(taskId, writesCopy);
        }
        if (!writes.length || !this.cache || !this.tasks) {
            return;
        }
        // only cache tasks with a cache key
        const task = this.tasks[taskId];
        if (task == null || task.cache_key == null) {
            return;
        }
        // only cache successful tasks
        if (writes[0][0] === constants_js_1.ERROR || writes[0][0] === constants_js_1.INTERRUPT) {
            return;
        }
        void this.cache.set([
            {
                key: [task.cache_key.ns, task.cache_key.key],
                value: task.writes,
                ttl: task.cache_key.ttl,
            },
        ]);
    }
    _outputWrites(taskId, writes, cached = false) {
        const task = this.tasks[taskId];
        if (task !== undefined) {
            if (task.config !== undefined &&
                (task.config.tags ?? []).includes(constants_js_1.TAG_HIDDEN)) {
                return;
            }
            if (writes.length > 0) {
                if (writes[0][0] === constants_js_1.INTERRUPT) {
                    // in `algo.ts` we append a bool to the task path to indicate
                    // whether or not a call was present. If so, we don't emit the
                    // the interrupt as it'll be emitted by the parent.
                    if (task.path?.[0] === constants_js_1.PUSH && task.path?.at(-1) === true)
                        return;
                    const interruptWrites = writes
                        .filter((w) => w[0] === constants_js_1.INTERRUPT)
                        .flatMap((w) => w[1]);
                    this._emit([
                        ["updates", { [constants_js_1.INTERRUPT]: interruptWrites }],
                        ["values", { [constants_js_1.INTERRUPT]: interruptWrites }],
                    ]);
                }
                else if (writes[0][0] !== constants_js_1.ERROR) {
                    this._emit((0, utils_js_1.gatherIteratorSync)((0, utils_js_1.prefixGenerator)((0, io_js_1.mapOutputUpdates)(this.outputKeys, [[task, writes]], cached), "updates")));
                }
            }
            if (!cached) {
                this._emit((0, utils_js_1.gatherIteratorSync)((0, utils_js_1.prefixGenerator)((0, debug_js_1.mapDebugTaskResults)([[task, writes]], this.streamKeys), "tasks")));
            }
        }
    }
    async _matchCachedWrites() {
        if (!this.cache)
            return [];
        const matched = [];
        const serializeKey = ([ns, key]) => {
            return `ns:${ns.join(",")}|key:${key}`;
        };
        const keys = [];
        const keyMap = {};
        for (const task of Object.values(this.tasks)) {
            if (task.cache_key != null && !task.writes.length) {
                keys.push([task.cache_key.ns, task.cache_key.key]);
                keyMap[serializeKey([task.cache_key.ns, task.cache_key.key])] = task;
            }
        }
        if (keys.length === 0)
            return [];
        const cache = await this.cache.get(keys);
        for (const { key, value } of cache) {
            const task = keyMap[serializeKey(key)];
            if (task != null) {
                // update the task with the cached writes
                task.writes.push(...value);
                matched.push({ task, result: value });
            }
        }
        return matched;
    }
    /**
     * Execute a single iteration of the Pregel loop.
     * Returns true if more iterations are needed.
     * @param params
     */
    async tick(params) {
        if (this.store && !this.store.isRunning) {
            await this.store?.start();
        }
        const { inputKeys = [] } = params;
        if (this.status !== "pending") {
            throw new Error(`Cannot tick when status is no longer "pending". Current status: "${this.status}"`);
        }
        if (![INPUT_DONE, INPUT_RESUMING].includes(this.input)) {
            await this._first(inputKeys);
        }
        else if (this.toInterrupt.length > 0) {
            this.status = "interrupt_before";
            throw new errors_js_1.GraphInterrupt();
        }
        else if (Object.values(this.tasks).every((task) => task.writes.length > 0)) {
            // finish superstep
            const writes = Object.values(this.tasks).flatMap((t) => t.writes);
            // All tasks have finished
            (0, algo_js_1._applyWrites)(this.checkpoint, this.channels, Object.values(this.tasks), this.checkpointerGetNextVersion, this.triggerToNodes);
            // produce values output
            const valuesOutput = await (0, utils_js_1.gatherIterator)((0, utils_js_1.prefixGenerator)((0, io_js_1.mapOutputValues)(this.outputKeys, writes, this.channels), "values"));
            this._emit(valuesOutput);
            // clear pending writes
            this.checkpointPendingWrites = [];
            await this._putCheckpoint({ source: "loop" });
            // after execution, check if we should interrupt
            if ((0, algo_js_1.shouldInterrupt)(this.checkpoint, this.interruptAfter, Object.values(this.tasks))) {
                this.status = "interrupt_after";
                throw new errors_js_1.GraphInterrupt();
            }
            // unset resuming flag
            if (this.config.configurable?.[constants_js_1.CONFIG_KEY_RESUMING] !== undefined) {
                delete this.config.configurable?.[constants_js_1.CONFIG_KEY_RESUMING];
            }
        }
        else {
            return false;
        }
        if (this.step > this.stop) {
            this.status = "out_of_steps";
            return false;
        }
        const nextTasks = (0, algo_js_1._prepareNextTasks)(this.checkpoint, this.checkpointPendingWrites, this.nodes, this.channels, this.config, true, {
            step: this.step,
            checkpointer: this.checkpointer,
            isResuming: this.isResuming,
            manager: this.manager,
            store: this.store,
            stream: this.stream,
        });
        this.tasks = nextTasks;
        // Produce debug output
        if (this.checkpointer) {
            this._emit(await (0, utils_js_1.gatherIterator)((0, utils_js_1.prefixGenerator)((0, debug_js_1.mapDebugCheckpoint)(this.checkpointConfig, this.channels, this.streamKeys, this.checkpointMetadata, Object.values(this.tasks), this.checkpointPendingWrites, this.prevCheckpointConfig, this.outputKeys), "checkpoints")));
        }
        if (Object.values(this.tasks).length === 0) {
            this.status = "done";
            return false;
        }
        // if there are pending writes from a previous loop, apply them
        if (this.skipDoneTasks && this.checkpointPendingWrites.length > 0) {
            for (const [tid, k, v] of this.checkpointPendingWrites) {
                if (k === constants_js_1.ERROR || k === constants_js_1.INTERRUPT || k === constants_js_1.RESUME) {
                    continue;
                }
                const task = Object.values(this.tasks).find((t) => t.id === tid);
                if (task) {
                    task.writes.push([k, v]);
                }
            }
            for (const task of Object.values(this.tasks)) {
                if (task.writes.length > 0) {
                    this._outputWrites(task.id, task.writes, true);
                }
            }
        }
        // if all tasks have finished, re-tick
        if (Object.values(this.tasks).every((task) => task.writes.length > 0)) {
            return this.tick({ inputKeys });
        }
        // Before execution, check if we should interrupt
        if ((0, algo_js_1.shouldInterrupt)(this.checkpoint, this.interruptBefore, Object.values(this.tasks))) {
            this.status = "interrupt_before";
            throw new errors_js_1.GraphInterrupt();
        }
        // Produce debug output
        const debugOutput = await (0, utils_js_1.gatherIterator)((0, utils_js_1.prefixGenerator)((0, debug_js_1.mapDebugTasks)(Object.values(this.tasks)), "tasks"));
        this._emit(debugOutput);
        return true;
    }
    async finishAndHandleError(error) {
        // persist current checkpoint and writes
        if (this.durability === "exit" &&
            // if it's a top graph
            (!this.isNested ||
                // or a nested graph with error or interrupt
                typeof error !== "undefined" ||
                // or a nested graph with checkpointer: true
                this.checkpointNamespace.every((part) => !part.includes(constants_js_1.CHECKPOINT_NAMESPACE_END)))) {
            this._putCheckpoint(this.checkpointMetadata);
            this._flushPendingWrites();
        }
        const suppress = this._suppressInterrupt(error);
        if (suppress || error === undefined) {
            this.output = (0, io_js_1.readChannels)(this.channels, this.outputKeys);
        }
        if (suppress) {
            // emit one last "values" event, with pending writes applied
            if (this.tasks !== undefined &&
                this.checkpointPendingWrites.length > 0 &&
                Object.values(this.tasks).some((task) => task.writes.length > 0)) {
                (0, algo_js_1._applyWrites)(this.checkpoint, this.channels, Object.values(this.tasks), this.checkpointerGetNextVersion, this.triggerToNodes);
                this._emit((0, utils_js_1.gatherIteratorSync)((0, utils_js_1.prefixGenerator)((0, io_js_1.mapOutputValues)(this.outputKeys, Object.values(this.tasks).flatMap((t) => t.writes), this.channels), "values")));
            }
            // Emit INTERRUPT event
            if ((0, errors_js_1.isGraphInterrupt)(error) && !error.interrupts.length) {
                this._emit([
                    ["updates", { [constants_js_1.INTERRUPT]: [] }],
                    ["values", { [constants_js_1.INTERRUPT]: [] }],
                ]);
            }
        }
        return suppress;
    }
    async acceptPush(task, writeIdx, call) {
        if (this.interruptAfter?.length > 0 &&
            (0, algo_js_1.shouldInterrupt)(this.checkpoint, this.interruptAfter, [task])) {
            this.toInterrupt.push(task);
            return;
        }
        const pushed = (0, algo_js_1._prepareSingleTask)([constants_js_1.PUSH, task.path ?? [], writeIdx, task.id, call], this.checkpoint, this.checkpointPendingWrites, this.nodes, this.channels, task.config ?? {}, true, {
            step: this.step,
            checkpointer: this.checkpointer,
            manager: this.manager,
            store: this.store,
            stream: this.stream,
        });
        if (!pushed)
            return;
        if (this.interruptBefore?.length > 0 &&
            (0, algo_js_1.shouldInterrupt)(this.checkpoint, this.interruptBefore, [pushed])) {
            this.toInterrupt.push(pushed);
            return;
        }
        this._emit((0, utils_js_1.gatherIteratorSync)((0, utils_js_1.prefixGenerator)((0, debug_js_1.mapDebugTasks)([pushed]), "tasks")));
        if (this.debug)
            (0, debug_js_1.printStepTasks)(this.step, [pushed]);
        this.tasks[pushed.id] = pushed;
        if (this.skipDoneTasks)
            this._matchWrites({ [pushed.id]: pushed });
        const tasks = await this._matchCachedWrites();
        for (const { task } of tasks) {
            this._outputWrites(task.id, task.writes, true);
        }
        return pushed;
    }
    _suppressInterrupt(e) {
        return (0, errors_js_1.isGraphInterrupt)(e) && !this.isNested;
    }
    async _first(inputKeys) {
        /*
         * Resuming from previous checkpoint requires
         * - finding a previous checkpoint
         * - receiving null input (outer graph) or RESUMING flag (subgraph)
         */
        const { configurable } = this.config;
        // take resume value from parent
        const scratchpad = configurable?.[constants_js_1.CONFIG_KEY_SCRATCHPAD];
        if (scratchpad && scratchpad.nullResume !== undefined) {
            this.putWrites(constants_js_1.NULL_TASK_ID, [[constants_js_1.RESUME, scratchpad.nullResume]]);
        }
        // map command to writes
        if ((0, constants_js_1.isCommand)(this.input)) {
            const hasResume = this.input.resume != null;
            if (this.input.resume != null &&
                typeof this.input.resume === "object" &&
                Object.keys(this.input.resume).every(hash_js_1.isXXH3)) {
                this.config.configurable ??= {};
                this.config.configurable[constants_js_1.CONFIG_KEY_RESUME_MAP] = this.input.resume;
            }
            if (hasResume && this.checkpointer == null) {
                throw new Error("Cannot use Command(resume=...) without checkpointer");
            }
            const writes = {};
            // group writes by task id
            for (const [tid, key, value] of (0, io_js_1.mapCommand)(this.input, this.checkpointPendingWrites)) {
                writes[tid] ??= [];
                writes[tid].push([key, value]);
            }
            if (Object.keys(writes).length === 0) {
                throw new errors_js_1.EmptyInputError("Received empty Command input");
            }
            // save writes
            for (const [tid, ws] of Object.entries(writes)) {
                this.putWrites(tid, ws);
            }
        }
        // apply null writes
        const nullWrites = (this.checkpointPendingWrites ?? [])
            .filter((w) => w[0] === constants_js_1.NULL_TASK_ID)
            .map((w) => w.slice(1));
        if (nullWrites.length > 0) {
            (0, algo_js_1._applyWrites)(this.checkpoint, this.channels, [
                {
                    name: constants_js_1.INPUT,
                    writes: nullWrites,
                    triggers: [],
                },
            ], this.checkpointerGetNextVersion, this.triggerToNodes);
        }
        const isCommandUpdateOrGoto = (0, constants_js_1.isCommand)(this.input) && nullWrites.length > 0;
        if (this.isResuming || isCommandUpdateOrGoto) {
            for (const channelName in this.channels) {
                if (!Object.prototype.hasOwnProperty.call(this.channels, channelName))
                    continue;
                if (this.checkpoint.channel_versions[channelName] !== undefined) {
                    const version = this.checkpoint.channel_versions[channelName];
                    this.checkpoint.versions_seen[constants_js_1.INTERRUPT] = {
                        ...this.checkpoint.versions_seen[constants_js_1.INTERRUPT],
                        [channelName]: version,
                    };
                }
            }
            // produce values output
            const valuesOutput = await (0, utils_js_1.gatherIterator)((0, utils_js_1.prefixGenerator)((0, io_js_1.mapOutputValues)(this.outputKeys, true, this.channels), "values"));
            this._emit(valuesOutput);
        }
        if (this.isResuming) {
            this.input = INPUT_RESUMING;
        }
        else if (isCommandUpdateOrGoto) {
            // we need to create a new checkpoint for Command(update=...) or Command(goto=...)
            // in case the result of Command(goto=...) is an interrupt.
            // If not done, the checkpoint containing the interrupt will be lost.
            await this._putCheckpoint({ source: "input" });
            this.input = INPUT_DONE;
        }
        else {
            // map inputs to channel updates
            const inputWrites = await (0, utils_js_1.gatherIterator)((0, io_js_1.mapInput)(inputKeys, this.input));
            if (inputWrites.length > 0) {
                const discardTasks = (0, algo_js_1._prepareNextTasks)(this.checkpoint, this.checkpointPendingWrites, this.nodes, this.channels, this.config, true, { step: this.step });
                (0, algo_js_1._applyWrites)(this.checkpoint, this.channels, Object.values(discardTasks).concat([
                    {
                        name: constants_js_1.INPUT,
                        writes: inputWrites,
                        triggers: [],
                    },
                ]), this.checkpointerGetNextVersion, this.triggerToNodes);
                // save input checkpoint
                await this._putCheckpoint({ source: "input" });
                this.input = INPUT_DONE;
            }
            else if (!(constants_js_1.CONFIG_KEY_RESUMING in (this.config.configurable ?? {}))) {
                throw new errors_js_1.EmptyInputError(`Received no input writes for ${JSON.stringify(inputKeys, null, 2)}`);
            }
            else {
                // done with input
                this.input = INPUT_DONE;
            }
        }
        if (!this.isNested) {
            this.config = (0, index_js_1.patchConfigurable)(this.config, {
                [constants_js_1.CONFIG_KEY_RESUMING]: this.isResuming,
            });
        }
    }
    _emit(values) {
        for (const [mode, payload] of values) {
            if (this.stream.modes.has(mode)) {
                this.stream.push([this.checkpointNamespace, mode, payload]);
            }
            // debug mode is a "checkpoints" or "tasks" wrapped in an object
            // TODO: consider deprecating this in 1.x
            if ((mode === "checkpoints" || mode === "tasks") &&
                this.stream.modes.has("debug")) {
                const step = mode === "checkpoints" ? this.step - 1 : this.step;
                const timestamp = new Date().toISOString();
                const type = (() => {
                    if (mode === "checkpoints") {
                        return "checkpoint";
                    }
                    else if (typeof payload === "object" &&
                        payload != null &&
                        "result" in payload) {
                        return "task_result";
                    }
                    else {
                        return "task";
                    }
                })();
                this.stream.push([
                    this.checkpointNamespace,
                    "debug",
                    { step, type, timestamp, payload },
                ]);
            }
        }
    }
    _putCheckpoint(inputMetadata) {
        const exiting = this.checkpointMetadata === inputMetadata;
        const doCheckpoint = this.checkpointer != null && (this.durability !== "exit" || exiting);
        const storeCheckpoint = (checkpoint) => {
            // store the previous checkpoint config for debug events
            this.prevCheckpointConfig = this.checkpointConfig?.configurable
                ?.checkpoint_id
                ? this.checkpointConfig
                : undefined;
            // child graphs keep at most one checkpoint per parent checkpoint
            // this is achieved by writing child checkpoints as progress is made
            // (so that error recovery / resuming from interrupt don't lose work)
            // but doing so always with an id equal to that of the parent checkpoint
            this.checkpointConfig = (0, index_js_1.patchConfigurable)(this.checkpointConfig, {
                [constants_js_1.CONFIG_KEY_CHECKPOINT_NS]: this.config.configurable?.checkpoint_ns ?? "",
            });
            const channelVersions = { ...this.checkpoint.channel_versions };
            const newVersions = (0, index_js_1.getNewChannelVersions)(this.checkpointPreviousVersions, channelVersions);
            this.checkpointPreviousVersions = channelVersions;
            // save it, without blocking
            // if there's a previous checkpoint save in progress, wait for it
            // ensuring checkpointers receive checkpoints in order
            void this._checkpointerPutAfterPrevious({
                config: { ...this.checkpointConfig },
                checkpoint: (0, langgraph_checkpoint_1.copyCheckpoint)(checkpoint),
                metadata: { ...this.checkpointMetadata },
                newVersions,
            });
            this.checkpointConfig = {
                ...this.checkpointConfig,
                configurable: {
                    ...this.checkpointConfig.configurable,
                    checkpoint_id: this.checkpoint.id,
                },
            };
        };
        if (!exiting) {
            this.checkpointMetadata = {
                ...inputMetadata,
                step: this.step,
                parents: this.config.configurable?.[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP] ?? {},
            };
        }
        // create new checkpoint
        this.checkpoint = (0, base_js_1.createCheckpoint)(this.checkpoint, doCheckpoint ? this.channels : undefined, this.step, exiting ? { id: this.checkpoint.id } : undefined);
        // Bail if no checkpointer
        if (doCheckpoint)
            storeCheckpoint(this.checkpoint);
        if (!exiting) {
            // increment step
            this.step += 1;
        }
    }
    _flushPendingWrites() {
        if (this.checkpointer == null)
            return;
        if (this.checkpointPendingWrites.length === 0)
            return;
        // patch config
        const config = (0, index_js_1.patchConfigurable)(this.checkpointConfig, {
            [constants_js_1.CONFIG_KEY_CHECKPOINT_NS]: this.config.configurable?.checkpoint_ns ?? "",
            [constants_js_1.CONFIG_KEY_CHECKPOINT_ID]: this.checkpoint.id,
        });
        // group writes by task id
        const byTask = {};
        for (const [tid, key, value] of this.checkpointPendingWrites) {
            byTask[tid] ??= [];
            byTask[tid].push([key, value]);
        }
        // submit writes to checkpointer
        for (const [tid, ws] of Object.entries(byTask)) {
            this.checkpointerPromises.push(this.checkpointer.putWrites(config, ws, tid));
        }
    }
    _matchWrites(tasks) {
        for (const [tid, k, v] of this.checkpointPendingWrites) {
            if (k === constants_js_1.ERROR || k === constants_js_1.INTERRUPT || k === constants_js_1.RESUME) {
                continue;
            }
            const task = Object.values(tasks).find((t) => t.id === tid);
            if (task) {
                task.writes.push([k, v]);
            }
        }
        for (const task of Object.values(tasks)) {
            if (task.writes.length > 0) {
                this._outputWrites(task.id, task.writes, true);
            }
        }
    }
}
exports.PregelLoop = PregelLoop;
//# sourceMappingURL=loop.js.map