"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseChannel = void 0;
exports.isBaseChannel = isBaseChannel;
exports.getOnlyChannels = getOnlyChannels;
exports.emptyChannels = emptyChannels;
exports.createCheckpoint = createCheckpoint;
const langgraph_checkpoint_1 = require("@langchain/langgraph-checkpoint");
const errors_js_1 = require("../errors.cjs");
function isBaseChannel(obj) {
    return obj != null && obj.lg_is_channel === true;
}
class BaseChannel {
    constructor() {
        Object.defineProperty(this, "ValueType", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "UpdateType", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        /** @ignore */
        Object.defineProperty(this, "lg_is_channel", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: true
        });
    }
    /**
     * Mark the current value of the channel as consumed. By default, no-op.
     * A channel can use this method to modify its state, preventing the value
     * from being consumed again.
     *
     * Returns True if the channel was updated, False otherwise.
     */
    consume() {
        return false;
    }
    /**
     * Notify the channel that the Pregel run is finishing. By default, no-op.
     * A channel can use this method to modify its state, preventing finish.
     *
     * Returns True if the channel was updated, False otherwise.
     */
    finish() {
        return false;
    }
    /**
     * Return True if the channel is available (not empty), False otherwise.
     * Subclasses should override this method to provide a more efficient
     * implementation than calling get() and catching EmptyChannelError.
     */
    isAvailable() {
        try {
            this.get();
            return true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }
        catch (error) {
            if (error.name === errors_js_1.EmptyChannelError.unminifiable_name) {
                return false;
            }
            throw error;
        }
    }
}
exports.BaseChannel = BaseChannel;
const IS_ONLY_BASE_CHANNEL = Symbol.for("LG_IS_ONLY_BASE_CHANNEL");
function getOnlyChannels(channels) {
    // @ts-expect-error - we know it's a record of base channels
    if (channels[IS_ONLY_BASE_CHANNEL] === true)
        return channels;
    const newChannels = {};
    for (const k in channels) {
        if (!Object.prototype.hasOwnProperty.call(channels, k))
            continue;
        const value = channels[k];
        if (isBaseChannel(value))
            newChannels[k] = value;
    }
    Object.assign(newChannels, { [IS_ONLY_BASE_CHANNEL]: true });
    return newChannels;
}
function emptyChannels(channels, checkpoint) {
    const filteredChannels = getOnlyChannels(channels);
    const newChannels = {};
    for (const k in filteredChannels) {
        if (!Object.prototype.hasOwnProperty.call(filteredChannels, k))
            continue;
        const channelValue = checkpoint.channel_values[k];
        newChannels[k] = filteredChannels[k].fromCheckpoint(channelValue);
    }
    Object.assign(newChannels, { [IS_ONLY_BASE_CHANNEL]: true });
    return newChannels;
}
function createCheckpoint(checkpoint, channels, step, options) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let values;
    if (channels === undefined) {
        values = checkpoint.channel_values;
    }
    else {
        values = {};
        for (const k in channels) {
            if (!Object.prototype.hasOwnProperty.call(channels, k))
                continue;
            try {
                values[k] = channels[k].checkpoint();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }
            catch (error) {
                if (error.name === errors_js_1.EmptyChannelError.unminifiable_name) {
                    // no-op
                }
                else {
                    throw error; // Rethrow unexpected errors
                }
            }
        }
    }
    const newVersionsSeen = {};
    for (const k in checkpoint.versions_seen) {
        if (!Object.prototype.hasOwnProperty.call(checkpoint.versions_seen, k))
            continue;
        newVersionsSeen[k] = { ...checkpoint.versions_seen[k] };
    }
    return {
        v: 4,
        id: options?.id ?? (0, langgraph_checkpoint_1.uuid6)(step),
        ts: new Date().toISOString(),
        channel_values: values,
        channel_versions: { ...checkpoint.channel_versions },
        versions_seen: newVersionsSeen,
    };
}
//# sourceMappingURL=base.js.map