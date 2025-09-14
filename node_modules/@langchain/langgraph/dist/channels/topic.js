import { EmptyChannelError } from "../errors.js";
import { BaseChannel } from "./base.js";
/**
 * @internal
 */
export class Topic extends BaseChannel {
    constructor(fields) {
        super();
        Object.defineProperty(this, "lc_graph_name", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "Topic"
        });
        Object.defineProperty(this, "unique", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "accumulate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "seen", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "values", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.unique = fields?.unique ?? this.unique;
        this.accumulate = fields?.accumulate ?? this.accumulate;
        // State
        this.seen = new Set();
        this.values = [];
    }
    fromCheckpoint(checkpoint) {
        const empty = new Topic({
            unique: this.unique,
            accumulate: this.accumulate,
        });
        if (typeof checkpoint !== "undefined") {
            empty.seen = new Set(checkpoint[0]);
            // eslint-disable-next-line prefer-destructuring
            empty.values = checkpoint[1];
        }
        return empty;
    }
    update(values) {
        let updated = false;
        if (!this.accumulate) {
            updated = this.values.length > 0;
            this.values = [];
        }
        const flatValues = values.flat();
        if (flatValues.length > 0) {
            if (this.unique) {
                for (const value of flatValues) {
                    if (!this.seen.has(value)) {
                        updated = true;
                        this.seen.add(value);
                        this.values.push(value);
                    }
                }
            }
            else {
                updated = true;
                this.values.push(...flatValues);
            }
        }
        return updated;
    }
    get() {
        if (this.values.length === 0) {
            throw new EmptyChannelError();
        }
        return this.values;
    }
    checkpoint() {
        return [[...this.seen], this.values];
    }
    isAvailable() {
        return this.values.length !== 0;
    }
}
//# sourceMappingURL=topic.js.map