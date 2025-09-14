import { describe, expect, it, vi } from "vitest";
import { wrap, tasksWithWrites, _readChannels } from "./debug.js";
import { LastValue } from "../channels/last_value.js";
import { EmptyChannelError } from "../errors.js";
import { ERROR, INTERRUPT, PULL } from "../constants.js";
describe("wrap", () => {
    it("should wrap text with color codes", () => {
        const color = {
            start: "\x1b[34m", // blue
            end: "\x1b[0m",
        };
        const text = "test text";
        const result = wrap(color, text);
        expect(result).toBe(`${color.start}${text}${color.end}`);
    });
});
describe("_readChannels", () => {
    it("should read values from channels", () => {
        const channels = {
            channel1: new LastValue(),
            channel2: new LastValue(),
        };
        // Update channels with values
        channels.channel1.update(["value1"]);
        channels.channel2.update(["42"]);
        const results = Array.from(_readChannels(channels));
        expect(results).toEqual([
            ["channel1", "value1"],
            ["channel2", "42"],
        ]);
    });
    it("should skip empty channels", () => {
        const mockEmptyChannel = {
            lc_graph_name: "MockChannel",
            lg_is_channel: true,
            ValueType: "",
            UpdateType: [],
            get: vi.fn().mockImplementation(() => {
                throw new EmptyChannelError("Empty channel");
            }),
            update: vi.fn().mockReturnValue(true),
            checkpoint: vi.fn(),
            fromCheckpoint: vi
                .fn()
                .mockReturnThis(),
            consume: vi.fn().mockReturnValue(false),
            finish: vi.fn().mockReturnValue(false),
            isAvailable: vi.fn().mockReturnValue(false),
        };
        const channels = {
            channel1: new LastValue(),
            emptyChannel: mockEmptyChannel,
        };
        // Update channel with value
        channels.channel1.update(["value1"]);
        const results = Array.from(_readChannels(channels));
        expect(results).toEqual([["channel1", "value1"]]);
    });
    it("should propagate non-empty channel errors", () => {
        const mockErrorChannel = {
            lc_graph_name: "MockChannel",
            lg_is_channel: true,
            ValueType: "",
            UpdateType: [],
            get: vi.fn().mockImplementation(() => {
                throw new Error("Other error");
            }),
            update: vi.fn().mockReturnValue(true),
            checkpoint: vi.fn(),
            fromCheckpoint: vi
                .fn()
                .mockReturnThis(),
            consume: vi.fn().mockReturnValue(false),
            finish: vi.fn().mockReturnValue(false),
            isAvailable: vi.fn().mockImplementation(() => {
                throw new Error("Other error");
            }),
        };
        const channels = {
            channel1: new LastValue(),
            errorChannel: mockErrorChannel,
        };
        channels.channel1.update(["value1"]);
        expect(() => Array.from(_readChannels(channels))).toThrow("Other error");
    });
});
describe("tasksWithWrites", () => {
    it("should return task descriptions with no writes", () => {
        const tasks = [
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
            },
            {
                id: "task2",
                name: "Task 2",
                path: [PULL, "Task 2"],
                interrupts: [],
            },
        ];
        const pendingWrites = [];
        const result = tasksWithWrites(tasks, pendingWrites, undefined, [
            "Task 1",
            "Task 2",
        ]);
        expect(result).toEqual([
            { id: "task1", name: "Task 1", path: [PULL, "Task 1"], interrupts: [] },
            { id: "task2", name: "Task 2", path: [PULL, "Task 2"], interrupts: [] },
        ]);
    });
    it("should include error information", () => {
        const tasks = [
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
            },
            {
                id: "task2",
                name: "Task 2",
                path: [PULL, "Task 2"],
                interrupts: [],
            },
        ];
        const pendingWrites = [
            ["task1", ERROR, { message: "Test error" }],
        ];
        const result = tasksWithWrites(tasks, pendingWrites, undefined, [
            "Task 1",
            "Task 2",
        ]);
        expect(result).toEqual([
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                error: { message: "Test error" },
                interrupts: [],
            },
            { id: "task2", name: "Task 2", path: [PULL, "Task 2"], interrupts: [] },
        ]);
    });
    it("should include state information", () => {
        const tasks = [
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
            },
            {
                id: "task2",
                name: "Task 2",
                path: [PULL, "Task 2"],
                interrupts: [],
            },
        ];
        const pendingWrites = [];
        const states = {
            task1: { configurable: { key: "value" } },
        };
        const result = tasksWithWrites(tasks, pendingWrites, states, [
            "Task 1",
            "Task 2",
        ]);
        expect(result).toEqual([
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
                state: { configurable: { key: "value" } },
            },
            { id: "task2", name: "Task 2", path: [PULL, "Task 2"], interrupts: [] },
        ]);
    });
    it("should include interrupts", () => {
        const tasks = [
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
            },
        ];
        const pendingWrites = [
            ["task1", INTERRUPT, { value: "Interrupted", when: "during" }],
        ];
        const result = tasksWithWrites(tasks, pendingWrites, undefined, ["task1"]);
        expect(result).toEqual([
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [{ value: "Interrupted", when: "during" }],
            },
        ]);
    });
    it("should include results", () => {
        const tasks = [
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
            },
            {
                id: "task2",
                name: "Task 2",
                path: [PULL, "Task 2"],
                interrupts: [],
            },
            {
                id: "task3",
                name: "Task 3",
                path: [PULL, "Task 3"],
                interrupts: [],
            },
        ];
        const pendingWrites = [
            ["task1", "Task 1", "Result"],
            ["task2", "Task 2", "Result 2"],
        ];
        const result = tasksWithWrites(tasks, pendingWrites, undefined, [
            "Task 1",
            "Task 2",
        ]);
        expect(result).toEqual([
            {
                id: "task1",
                name: "Task 1",
                path: [PULL, "Task 1"],
                interrupts: [],
                result: { "Task 1": "Result" },
            },
            {
                id: "task2",
                name: "Task 2",
                path: [PULL, "Task 2"],
                interrupts: [],
                result: { "Task 2": "Result 2" },
            },
            {
                id: "task3",
                name: "Task 3",
                path: [PULL, "Task 3"],
                interrupts: [],
                result: undefined,
            },
        ]);
    });
});
//# sourceMappingURL=debug.test.js.map