"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.increment = void 0;
exports.shouldInterrupt = shouldInterrupt;
exports._localRead = _localRead;
exports._localWrite = _localWrite;
exports._applyWrites = _applyWrites;
exports._prepareNextTasks = _prepareNextTasks;
exports._prepareSingleTask = _prepareSingleTask;
/* eslint-disable no-param-reassign */
const runnables_1 = require("@langchain/core/runnables");
const langgraph_checkpoint_1 = require("@langchain/langgraph-checkpoint");
const base_js_1 = require("../channels/base.cjs");
const io_js_1 = require("./io.cjs");
const constants_js_1 = require("../constants.cjs");
const types_js_1 = require("./types.cjs");
const errors_js_1 = require("../errors.cjs");
const index_js_1 = require("./utils/index.cjs");
const call_js_1 = require("./call.cjs");
const hash_js_1 = require("../hash.cjs");
const increment = (current) => {
    return current !== undefined ? current + 1 : 1;
};
exports.increment = increment;
// Avoids unnecessary double iteration
function maxChannelMapVersion(channelVersions) {
    let maxVersion;
    for (const chan in channelVersions) {
        if (!Object.prototype.hasOwnProperty.call(channelVersions, chan))
            continue;
        if (maxVersion == null) {
            maxVersion = channelVersions[chan];
        }
        else {
            maxVersion = (0, langgraph_checkpoint_1.maxChannelVersion)(maxVersion, channelVersions[chan]);
        }
    }
    return maxVersion;
}
function shouldInterrupt(checkpoint, interruptNodes, tasks) {
    const nullVersion = (0, index_js_1.getNullChannelVersion)(checkpoint.channel_versions);
    const seen = checkpoint.versions_seen[constants_js_1.INTERRUPT] ?? {};
    let anyChannelUpdated = false;
    for (const chan in checkpoint.channel_versions) {
        if (!Object.prototype.hasOwnProperty.call(checkpoint.channel_versions, chan))
            continue;
        if (checkpoint.channel_versions[chan] > (seen[chan] ?? nullVersion)) {
            anyChannelUpdated = true;
            break;
        }
    }
    const anyTriggeredNodeInInterruptNodes = tasks.some((task) => interruptNodes === "*"
        ? !task.config?.tags?.includes(constants_js_1.TAG_HIDDEN)
        : interruptNodes.includes(task.name));
    return anyChannelUpdated && anyTriggeredNodeInInterruptNodes;
}
function _localRead(checkpoint, channels, task, select, fresh = false) {
    let updated = new Set();
    if (!Array.isArray(select)) {
        for (const [c] of task.writes) {
            if (c === select) {
                updated = new Set([c]);
                break;
            }
        }
        updated = updated || new Set();
    }
    else {
        updated = new Set(select.filter((c) => task.writes.some(([key, _]) => key === c)));
    }
    let values;
    if (fresh && updated.size > 0) {
        const localChannels = Object.fromEntries(Object.entries(channels).filter(([k, _]) => updated.has(k)));
        const newCheckpoint = (0, base_js_1.createCheckpoint)(checkpoint, localChannels, -1);
        const newChannels = (0, base_js_1.emptyChannels)(localChannels, newCheckpoint);
        _applyWrites((0, langgraph_checkpoint_1.copyCheckpoint)(newCheckpoint), newChannels, [task], undefined, undefined);
        values = (0, io_js_1.readChannels)({ ...channels, ...newChannels }, select);
    }
    else {
        values = (0, io_js_1.readChannels)(channels, select);
    }
    return values;
}
function _localWrite(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
commit, processes, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
writes) {
    for (const [chan, value] of writes) {
        if ([constants_js_1.PUSH, constants_js_1.TASKS].includes(chan) && value != null) {
            if (!(0, constants_js_1._isSend)(value)) {
                throw new errors_js_1.InvalidUpdateError(`Invalid packet type, expected SendProtocol, got ${JSON.stringify(value)}`);
            }
            if (!(value.node in processes)) {
                throw new errors_js_1.InvalidUpdateError(`Invalid node name "${value.node}" in Send packet`);
            }
        }
    }
    commit(writes);
}
const IGNORE = new Set([
    constants_js_1.NO_WRITES,
    constants_js_1.PUSH,
    constants_js_1.RESUME,
    constants_js_1.INTERRUPT,
    constants_js_1.RETURN,
    constants_js_1.ERROR,
]);
function _applyWrites(checkpoint, channels, tasks, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
getNextVersion, triggerToNodes) {
    // Sort tasks by first 3 path elements for deterministic order
    // Later path parts (like task IDs) are ignored for sorting
    tasks.sort((a, b) => {
        const aPath = a.path?.slice(0, 3) || [];
        const bPath = b.path?.slice(0, 3) || [];
        // Compare each path element
        for (let i = 0; i < Math.min(aPath.length, bPath.length); i += 1) {
            if (aPath[i] < bPath[i])
                return -1;
            if (aPath[i] > bPath[i])
                return 1;
        }
        // If one path is shorter, it comes first
        return aPath.length - bPath.length;
    });
    // if no task has triggers this is applying writes from the null task only
    // so we don't do anything other than update the channels written to
    const bumpStep = tasks.some((task) => task.triggers.length > 0);
    // Filter out non instances of BaseChannel
    const onlyChannels = (0, base_js_1.getOnlyChannels)(channels);
    // Update seen versions
    for (const task of tasks) {
        checkpoint.versions_seen[task.name] ??= {};
        for (const chan of task.triggers) {
            if (chan in checkpoint.channel_versions) {
                checkpoint.versions_seen[task.name][chan] =
                    checkpoint.channel_versions[chan];
            }
        }
    }
    // Find the highest version of all channels
    let maxVersion = maxChannelMapVersion(checkpoint.channel_versions);
    // Consume all channels that were read
    const channelsToConsume = new Set(tasks
        .flatMap((task) => task.triggers)
        .filter((chan) => !constants_js_1.RESERVED.includes(chan)));
    for (const chan of channelsToConsume) {
        if (chan in onlyChannels && onlyChannels[chan].consume()) {
            if (getNextVersion !== undefined) {
                checkpoint.channel_versions[chan] = getNextVersion(maxVersion);
            }
        }
    }
    // Group writes by channel
    const pendingWritesByChannel = {};
    for (const task of tasks) {
        for (const [chan, val] of task.writes) {
            if (IGNORE.has(chan)) {
                // do nothing
            }
            else if (chan in onlyChannels) {
                pendingWritesByChannel[chan] ??= [];
                pendingWritesByChannel[chan].push(val);
            }
        }
    }
    // Find the highest version of all channels
    maxVersion = maxChannelMapVersion(checkpoint.channel_versions);
    const updatedChannels = new Set();
    // Apply writes to channels
    for (const [chan, vals] of Object.entries(pendingWritesByChannel)) {
        if (chan in onlyChannels) {
            const channel = onlyChannels[chan];
            let updated;
            try {
                updated = channel.update(vals);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }
            catch (e) {
                if (e.name === errors_js_1.InvalidUpdateError.unminifiable_name) {
                    const wrappedError = new errors_js_1.InvalidUpdateError(`Invalid update for channel "${chan}" with values ${JSON.stringify(vals)}: ${e.message}`);
                    wrappedError.lc_error_code = e.lc_error_code;
                    throw wrappedError;
                }
                else {
                    throw e;
                }
            }
            if (updated && getNextVersion !== undefined) {
                checkpoint.channel_versions[chan] = getNextVersion(maxVersion);
                // unavailable channels can't trigger tasks, so don't add them
                if (channel.isAvailable())
                    updatedChannels.add(chan);
            }
        }
    }
    // Channels that weren't updated in this step are notified of a new step
    if (bumpStep) {
        for (const chan in onlyChannels) {
            if (!Object.prototype.hasOwnProperty.call(onlyChannels, chan))
                continue;
            const channel = onlyChannels[chan];
            if (channel.isAvailable() && !updatedChannels.has(chan)) {
                const updated = channel.update([]);
                if (updated && getNextVersion !== undefined) {
                    checkpoint.channel_versions[chan] = getNextVersion(maxVersion);
                    // unavailable channels can't trigger tasks, so don't add them
                    if (channel.isAvailable())
                        updatedChannels.add(chan);
                }
            }
        }
    }
    // If this is (tentatively) the last superstep, notify all channels of finish
    if (bumpStep &&
        !Object.keys(triggerToNodes ?? {}).some((channel) => updatedChannels.has(channel))) {
        for (const chan in onlyChannels) {
            if (!Object.prototype.hasOwnProperty.call(onlyChannels, chan))
                continue;
            const channel = onlyChannels[chan];
            if (channel.finish() && getNextVersion !== undefined) {
                checkpoint.channel_versions[chan] = getNextVersion(maxVersion);
                // unavailable channels can't trigger tasks, so don't add them
                if (channel.isAvailable())
                    updatedChannels.add(chan);
            }
        }
    }
}
/**
 * Prepare the set of tasks that will make up the next Pregel step.
 * This is the union of all PUSH tasks (Sends) and PULL tasks (nodes triggered
 * by edges).
 */
function _prepareNextTasks(checkpoint, pendingWrites, processes, channels, config, forExecution, extra) {
    const tasks = {};
    // Consume pending tasks
    const tasksChannel = channels[constants_js_1.TASKS];
    if (tasksChannel?.isAvailable()) {
        const len = tasksChannel.get().length;
        for (let i = 0; i < len; i += 1) {
            const task = _prepareSingleTask([constants_js_1.PUSH, i], checkpoint, pendingWrites, processes, channels, config, forExecution, extra);
            if (task !== undefined) {
                tasks[task.id] = task;
            }
        }
    }
    // Check if any processes should be run in next step
    // If so, prepare the values to be passed to them
    for (const name in processes) {
        if (!Object.prototype.hasOwnProperty.call(processes, name))
            continue;
        const task = _prepareSingleTask([constants_js_1.PULL, name], checkpoint, pendingWrites, processes, channels, config, forExecution, extra);
        if (task !== undefined) {
            tasks[task.id] = task;
        }
    }
    return tasks;
}
/**
 * Prepares a single task for the next Pregel step, given a task path, which
 * uniquely identifies a PUSH or PULL task within the graph.
 */
function _prepareSingleTask(taskPath, checkpoint, pendingWrites, processes, channels, config, forExecution, extra) {
    const { step, checkpointer, manager } = extra;
    const configurable = config.configurable ?? {};
    const parentNamespace = configurable.checkpoint_ns ?? "";
    if (taskPath[0] === constants_js_1.PUSH && (0, types_js_1.isCall)(taskPath[taskPath.length - 1])) {
        const call = taskPath[taskPath.length - 1];
        const proc = (0, call_js_1.getRunnableForFunc)(call.name, call.func);
        const triggers = [constants_js_1.PUSH];
        const checkpointNamespace = parentNamespace === ""
            ? call.name
            : `${parentNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_SEPARATOR}${call.name}`;
        const id = (0, langgraph_checkpoint_1.uuid5)(JSON.stringify([
            checkpointNamespace,
            step.toString(),
            call.name,
            constants_js_1.PUSH,
            taskPath[1],
            taskPath[2],
        ]), checkpoint.id);
        const taskCheckpointNamespace = `${checkpointNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_END}${id}`;
        // we append `true` to the task path to indicate that a call is being made
        // so we should not return interrupts from this task (responsibility lies with the parent)
        const outputTaskPath = [...taskPath.slice(0, 3), true];
        const metadata = {
            langgraph_step: step,
            langgraph_node: call.name,
            langgraph_triggers: triggers,
            langgraph_path: outputTaskPath,
            langgraph_checkpoint_ns: taskCheckpointNamespace,
        };
        if (forExecution) {
            const writes = [];
            const task = {
                name: call.name,
                input: call.input,
                proc,
                writes,
                config: (0, runnables_1.patchConfig)((0, runnables_1.mergeConfigs)(config, {
                    metadata,
                    store: extra.store ?? config.store,
                }), {
                    runName: call.name,
                    callbacks: manager?.getChild(`graph:step:${step}`),
                    configurable: {
                        [constants_js_1.CONFIG_KEY_TASK_ID]: id,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        [constants_js_1.CONFIG_KEY_SEND]: (writes_) => _localWrite((items) => writes.push(...items), processes, writes_),
                        [constants_js_1.CONFIG_KEY_READ]: (select_, fresh_ = false) => _localRead(checkpoint, channels, {
                            name: call.name,
                            writes: writes,
                            triggers,
                            path: outputTaskPath,
                        }, select_, fresh_),
                        [constants_js_1.CONFIG_KEY_CHECKPOINTER]: checkpointer ?? configurable[constants_js_1.CONFIG_KEY_CHECKPOINTER],
                        [constants_js_1.CONFIG_KEY_CHECKPOINT_MAP]: {
                            ...configurable[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP],
                            [parentNamespace]: checkpoint.id,
                        },
                        [constants_js_1.CONFIG_KEY_SCRATCHPAD]: _scratchpad({
                            pendingWrites: pendingWrites ?? [],
                            taskId: id,
                            currentTaskInput: call.input,
                            resumeMap: config.configurable?.[constants_js_1.CONFIG_KEY_RESUME_MAP],
                            namespaceHash: (0, hash_js_1.XXH3)(taskCheckpointNamespace),
                        }),
                        [constants_js_1.CONFIG_KEY_PREVIOUS_STATE]: checkpoint.channel_values[constants_js_1.PREVIOUS],
                        checkpoint_id: undefined,
                        checkpoint_ns: taskCheckpointNamespace,
                    },
                }),
                triggers,
                retry_policy: call.retry,
                cache_key: call.cache
                    ? {
                        key: (0, hash_js_1.XXH3)((call.cache.keyFunc ?? JSON.stringify)([call.input])),
                        ns: [constants_js_1.CACHE_NS_WRITES, call.name ?? "__dynamic__"],
                        ttl: call.cache.ttl,
                    }
                    : undefined,
                id,
                path: outputTaskPath,
                writers: [],
            };
            return task;
        }
        else {
            return {
                id,
                name: call.name,
                interrupts: [],
                path: outputTaskPath,
            };
        }
    }
    else if (taskPath[0] === constants_js_1.PUSH) {
        const index = typeof taskPath[1] === "number"
            ? taskPath[1]
            : parseInt(taskPath[1], 10);
        if (!channels[constants_js_1.TASKS]?.isAvailable()) {
            return undefined;
        }
        const sends = channels[constants_js_1.TASKS].get();
        if (index < 0 || index >= sends.length) {
            return undefined;
        }
        const packet = (0, constants_js_1._isSendInterface)(sends[index]) && !(0, constants_js_1._isSend)(sends[index])
            ? new constants_js_1.Send(sends[index].node, sends[index].args)
            : sends[index];
        if (!(0, constants_js_1._isSendInterface)(packet)) {
            console.warn(`Ignoring invalid packet ${JSON.stringify(packet)} in pending sends.`);
            return undefined;
        }
        if (!(packet.node in processes)) {
            console.warn(`Ignoring unknown node name ${packet.node} in pending sends.`);
            return undefined;
        }
        const triggers = [constants_js_1.PUSH];
        const checkpointNamespace = parentNamespace === ""
            ? packet.node
            : `${parentNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_SEPARATOR}${packet.node}`;
        const taskId = (0, langgraph_checkpoint_1.uuid5)(JSON.stringify([
            checkpointNamespace,
            step.toString(),
            packet.node,
            constants_js_1.PUSH,
            index.toString(),
        ]), checkpoint.id);
        const taskCheckpointNamespace = `${checkpointNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_END}${taskId}`;
        let metadata = {
            langgraph_step: step,
            langgraph_node: packet.node,
            langgraph_triggers: triggers,
            langgraph_path: taskPath.slice(0, 3),
            langgraph_checkpoint_ns: taskCheckpointNamespace,
        };
        if (forExecution) {
            const proc = processes[packet.node];
            const node = proc.getNode();
            if (node !== undefined) {
                if (proc.metadata !== undefined) {
                    metadata = { ...metadata, ...proc.metadata };
                }
                const writes = [];
                return {
                    name: packet.node,
                    input: packet.args,
                    proc: node,
                    subgraphs: proc.subgraphs,
                    writes,
                    config: (0, runnables_1.patchConfig)((0, runnables_1.mergeConfigs)(config, {
                        metadata,
                        tags: proc.tags,
                        store: extra.store ?? config.store,
                    }), {
                        runName: packet.node,
                        callbacks: manager?.getChild(`graph:step:${step}`),
                        configurable: {
                            [constants_js_1.CONFIG_KEY_TASK_ID]: taskId,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            [constants_js_1.CONFIG_KEY_SEND]: (writes_) => _localWrite((items) => writes.push(...items), processes, writes_),
                            [constants_js_1.CONFIG_KEY_READ]: (select_, fresh_ = false) => _localRead(checkpoint, channels, {
                                name: packet.node,
                                writes: writes,
                                triggers,
                                path: taskPath,
                            }, select_, fresh_),
                            [constants_js_1.CONFIG_KEY_CHECKPOINTER]: checkpointer ?? configurable[constants_js_1.CONFIG_KEY_CHECKPOINTER],
                            [constants_js_1.CONFIG_KEY_CHECKPOINT_MAP]: {
                                ...configurable[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP],
                                [parentNamespace]: checkpoint.id,
                            },
                            [constants_js_1.CONFIG_KEY_SCRATCHPAD]: _scratchpad({
                                pendingWrites: pendingWrites ?? [],
                                taskId,
                                currentTaskInput: packet.args,
                                resumeMap: config.configurable?.[constants_js_1.CONFIG_KEY_RESUME_MAP],
                                namespaceHash: (0, hash_js_1.XXH3)(taskCheckpointNamespace),
                            }),
                            [constants_js_1.CONFIG_KEY_PREVIOUS_STATE]: checkpoint.channel_values[constants_js_1.PREVIOUS],
                            checkpoint_id: undefined,
                            checkpoint_ns: taskCheckpointNamespace,
                        },
                    }),
                    triggers,
                    retry_policy: proc.retryPolicy,
                    cache_key: proc.cachePolicy
                        ? {
                            key: (0, hash_js_1.XXH3)((proc.cachePolicy.keyFunc ?? JSON.stringify)([packet.args])),
                            ns: [constants_js_1.CACHE_NS_WRITES, proc.name ?? "__dynamic__", packet.node],
                            ttl: proc.cachePolicy.ttl,
                        }
                        : undefined,
                    id: taskId,
                    path: taskPath,
                    writers: proc.getWriters(),
                };
            }
        }
        else {
            return {
                id: taskId,
                name: packet.node,
                interrupts: [],
                path: taskPath,
            };
        }
    }
    else if (taskPath[0] === constants_js_1.PULL) {
        const name = taskPath[1].toString();
        const proc = processes[name];
        if (proc === undefined) {
            return undefined;
        }
        // Check if this task already has successful writes in the pending writes
        if (pendingWrites?.length) {
            // Find the task ID for this node/path
            const checkpointNamespace = parentNamespace === ""
                ? name
                : `${parentNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_SEPARATOR}${name}`;
            const taskId = (0, langgraph_checkpoint_1.uuid5)(JSON.stringify([
                checkpointNamespace,
                step.toString(),
                name,
                constants_js_1.PULL,
                name,
            ]), checkpoint.id);
            // Check if there are successful writes (not ERROR) for this task ID
            const hasSuccessfulWrites = pendingWrites.some((w) => w[0] === taskId && w[1] !== constants_js_1.ERROR);
            // If task completed successfully, don't include it in next tasks
            if (hasSuccessfulWrites) {
                return undefined;
            }
        }
        const nullVersion = (0, index_js_1.getNullChannelVersion)(checkpoint.channel_versions);
        if (nullVersion === undefined) {
            return undefined;
        }
        const seen = checkpoint.versions_seen[name] ?? {};
        // Find the first trigger that is available and has a new version
        const trigger = proc.triggers.find((chan) => {
            if (!channels[chan].isAvailable())
                return false;
            return ((checkpoint.channel_versions[chan] ?? nullVersion) >
                (seen[chan] ?? nullVersion));
        });
        // If any of the channels read by this process were updated
        if (trigger !== undefined) {
            const val = _procInput(proc, channels, forExecution);
            if (val === undefined) {
                return undefined;
            }
            const checkpointNamespace = parentNamespace === ""
                ? name
                : `${parentNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_SEPARATOR}${name}`;
            const taskId = (0, langgraph_checkpoint_1.uuid5)(JSON.stringify([
                checkpointNamespace,
                step.toString(),
                name,
                constants_js_1.PULL,
                [trigger],
            ]), checkpoint.id);
            const taskCheckpointNamespace = `${checkpointNamespace}${constants_js_1.CHECKPOINT_NAMESPACE_END}${taskId}`;
            let metadata = {
                langgraph_step: step,
                langgraph_node: name,
                langgraph_triggers: [trigger],
                langgraph_path: taskPath,
                langgraph_checkpoint_ns: taskCheckpointNamespace,
            };
            if (forExecution) {
                const node = proc.getNode();
                if (node !== undefined) {
                    if (proc.metadata !== undefined) {
                        metadata = { ...metadata, ...proc.metadata };
                    }
                    const writes = [];
                    return {
                        name,
                        input: val,
                        proc: node,
                        subgraphs: proc.subgraphs,
                        writes,
                        config: (0, runnables_1.patchConfig)((0, runnables_1.mergeConfigs)(config, {
                            metadata,
                            tags: proc.tags,
                            store: extra.store ?? config.store,
                        }), {
                            runName: name,
                            callbacks: manager?.getChild(`graph:step:${step}`),
                            configurable: {
                                [constants_js_1.CONFIG_KEY_TASK_ID]: taskId,
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                [constants_js_1.CONFIG_KEY_SEND]: (writes_) => _localWrite((items) => {
                                    writes.push(...items);
                                }, processes, writes_),
                                [constants_js_1.CONFIG_KEY_READ]: (select_, fresh_ = false) => _localRead(checkpoint, channels, {
                                    name,
                                    writes: writes,
                                    triggers: [trigger],
                                    path: taskPath,
                                }, select_, fresh_),
                                [constants_js_1.CONFIG_KEY_CHECKPOINTER]: checkpointer ?? configurable[constants_js_1.CONFIG_KEY_CHECKPOINTER],
                                [constants_js_1.CONFIG_KEY_CHECKPOINT_MAP]: {
                                    ...configurable[constants_js_1.CONFIG_KEY_CHECKPOINT_MAP],
                                    [parentNamespace]: checkpoint.id,
                                },
                                [constants_js_1.CONFIG_KEY_SCRATCHPAD]: _scratchpad({
                                    pendingWrites: pendingWrites ?? [],
                                    taskId,
                                    currentTaskInput: val,
                                    resumeMap: config.configurable?.[constants_js_1.CONFIG_KEY_RESUME_MAP],
                                    namespaceHash: (0, hash_js_1.XXH3)(taskCheckpointNamespace),
                                }),
                                [constants_js_1.CONFIG_KEY_PREVIOUS_STATE]: checkpoint.channel_values[constants_js_1.PREVIOUS],
                                checkpoint_id: undefined,
                                checkpoint_ns: taskCheckpointNamespace,
                            },
                        }),
                        triggers: [trigger],
                        retry_policy: proc.retryPolicy,
                        cache_key: proc.cachePolicy
                            ? {
                                key: (0, hash_js_1.XXH3)((proc.cachePolicy.keyFunc ?? JSON.stringify)([val])),
                                ns: [constants_js_1.CACHE_NS_WRITES, proc.name ?? "__dynamic__", name],
                                ttl: proc.cachePolicy.ttl,
                            }
                            : undefined,
                        id: taskId,
                        path: taskPath,
                        writers: proc.getWriters(),
                    };
                }
            }
            else {
                return {
                    id: taskId,
                    name,
                    interrupts: [],
                    path: taskPath,
                };
            }
        }
    }
    return undefined;
}
/**
 *  Function injected under CONFIG_KEY_READ in task config, to read current state.
 *  Used by conditional edges to read a copy of the state with reflecting the writes
 *  from that node only.
 *
 * @internal
 */
function _procInput(proc, channels, forExecution) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let val;
    if (typeof proc.channels === "object" && !Array.isArray(proc.channels)) {
        val = {};
        for (const [k, chan] of Object.entries(proc.channels)) {
            if (proc.triggers.includes(chan)) {
                try {
                    val[k] = (0, io_js_1.readChannel)(channels, chan, false);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }
                catch (e) {
                    if (e.name === errors_js_1.EmptyChannelError.unminifiable_name) {
                        return undefined;
                    }
                    else {
                        throw e;
                    }
                }
            }
            else if (chan in channels) {
                try {
                    val[k] = (0, io_js_1.readChannel)(channels, chan, false);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }
                catch (e) {
                    if (e.name === errors_js_1.EmptyChannelError.unminifiable_name) {
                        continue;
                    }
                    else {
                        throw e;
                    }
                }
            }
        }
    }
    else if (Array.isArray(proc.channels)) {
        let successfulRead = false;
        for (const chan of proc.channels) {
            try {
                val = (0, io_js_1.readChannel)(channels, chan, false);
                successfulRead = true;
                break;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }
            catch (e) {
                if (e.name === errors_js_1.EmptyChannelError.unminifiable_name) {
                    continue;
                }
                else {
                    throw e;
                }
            }
        }
        if (!successfulRead) {
            return undefined;
        }
    }
    else {
        throw new Error(`Invalid channels type, expected list or dict, got ${proc.channels}`);
    }
    // If the process has a mapper, apply it to the value
    if (forExecution && proc.mapper !== undefined) {
        val = proc.mapper(val);
    }
    return val;
}
function _scratchpad({ pendingWrites, taskId, currentTaskInput, resumeMap, namespaceHash, }) {
    const nullResume = pendingWrites.find(([writeTaskId, chan]) => writeTaskId === constants_js_1.NULL_TASK_ID && chan === constants_js_1.RESUME)?.[2];
    const resume = (() => {
        const result = pendingWrites
            .filter(([writeTaskId, chan]) => writeTaskId === taskId && chan === constants_js_1.RESUME)
            .flatMap(([_writeTaskId, _chan, resume]) => resume);
        if (resumeMap != null && namespaceHash in resumeMap) {
            const mappedResume = resumeMap[namespaceHash];
            result.push(mappedResume);
        }
        return result;
    })();
    const scratchpad = {
        callCounter: 0,
        interruptCounter: -1,
        resume,
        nullResume,
        subgraphCounter: 0,
        currentTaskInput,
        consumeNullResume: () => {
            if (scratchpad.nullResume) {
                delete scratchpad.nullResume;
                pendingWrites.splice(pendingWrites.findIndex(([writeTaskId, chan]) => writeTaskId === constants_js_1.NULL_TASK_ID && chan === constants_js_1.RESUME), 1);
                return nullResume;
            }
            return undefined;
        },
    };
    return scratchpad;
}
//# sourceMappingURL=algo.js.map