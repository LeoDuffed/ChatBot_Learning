import { AgentAction, AgentFinish } from "@langchain/core/agents";
import { BaseMessage } from "@langchain/core/messages";
import { Runnable } from "@langchain/core/runnables";
import { Tool } from "@langchain/core/tools";
import { ToolExecutor } from "./tool_executor.js";
import type { BaseChannel } from "../channels/base.js";
interface Step {
    action: AgentAction | AgentFinish;
    observation: unknown;
}
/** @ignore */
export interface AgentExecutorState {
    agentOutcome?: AgentAction | AgentFinish;
    steps: Array<Step>;
    input: string;
    chatHistory?: BaseMessage[];
}
/** @ignore */
export declare function createAgentExecutor({ agentRunnable, tools, }: {
    agentRunnable: Runnable;
    tools: Array<Tool> | ToolExecutor;
}): import("../web.js").CompiledStateGraph<{
    agentOutcome?: (AgentAction | AgentFinish) | undefined;
    steps: Array<Step>;
    input: string;
    chatHistory?: BaseMessage[] | undefined;
}, {
    agentOutcome?: (AgentAction | AgentFinish) | undefined;
    steps?: Step[] | undefined;
    input?: string | undefined;
    chatHistory?: BaseMessage[] | undefined;
}, "__start__" | "action" | "agent", {
    agentOutcome?: BaseChannel<AgentAction | AgentFinish | undefined, AgentAction | AgentFinish | undefined, unknown> | undefined;
    steps: BaseChannel<Step[], Step[], unknown>;
    input: BaseChannel<string, string, unknown>;
    chatHistory?: BaseChannel<BaseMessage[] | undefined, BaseMessage[] | undefined, unknown> | undefined;
}, {
    agentOutcome?: BaseChannel<AgentAction | AgentFinish | undefined, AgentAction | AgentFinish | undefined, unknown> | undefined;
    steps: BaseChannel<Step[], Step[], unknown>;
    input: BaseChannel<string, string, unknown>;
    chatHistory?: BaseChannel<BaseMessage[] | undefined, BaseMessage[] | undefined, unknown> | undefined;
}, import("../web.js").StateDefinition, {
    agent: {
        agentOutcome: any;
    };
    action: Partial<AgentExecutorState>;
}>;
export {};
