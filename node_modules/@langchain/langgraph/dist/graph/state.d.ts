import { All, type BaseCache, BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";
import { type InteropZodObject } from "@langchain/core/utils/types";
import type { RunnableLike, LangGraphRunnableConfig } from "../pregel/runnable_types.js";
import { BaseChannel } from "../channels/base.js";
import { CompiledGraph, Graph, Branch, AddNodeOptions, NodeSpec } from "./graph.js";
import { Command, END, START } from "../constants.js";
import { AnnotationRoot, SingleReducer, StateDefinition, StateType, UpdateType } from "./annotation.js";
import type { CachePolicy, RetryPolicy } from "../pregel/utils/index.js";
import { type SchemaMetaRegistry, InteropZodToStateDefinition } from "./zod/meta.js";
export type ChannelReducers<Channels extends object> = {
    [K in keyof Channels]: SingleReducer<Channels[K], any>;
};
export interface StateGraphArgs<Channels extends object | unknown> {
    channels: Channels extends object ? Channels extends unknown[] ? ChannelReducers<{
        __root__: Channels;
    }> : ChannelReducers<Channels> : ChannelReducers<{
        __root__: Channels;
    }>;
}
export type StateGraphNodeSpec<RunInput, RunOutput> = NodeSpec<RunInput, RunOutput> & {
    input?: StateDefinition;
    retryPolicy?: RetryPolicy;
    cachePolicy?: CachePolicy;
};
export type StateGraphAddNodeOptions<Nodes extends string = string> = {
    retryPolicy?: RetryPolicy;
    cachePolicy?: CachePolicy | boolean;
    input?: AnnotationRoot<any> | InteropZodObject;
} & AddNodeOptions<Nodes>;
export type StateGraphArgsWithStateSchema<SD extends StateDefinition, I extends StateDefinition, O extends StateDefinition> = {
    stateSchema: AnnotationRoot<SD>;
    input?: AnnotationRoot<I>;
    output?: AnnotationRoot<O>;
};
export type StateGraphArgsWithInputOutputSchemas<SD extends StateDefinition, O extends StateDefinition = SD> = {
    input: AnnotationRoot<SD>;
    output: AnnotationRoot<O>;
};
type ZodStateGraphArgsWithStateSchema<SD extends InteropZodObject, I extends SDZod, O extends SDZod> = {
    state: SD;
    input?: I;
    output?: O;
};
type SDZod = StateDefinition | InteropZodObject;
type ToStateDefinition<T> = T extends InteropZodObject ? InteropZodToStateDefinition<T> : T extends StateDefinition ? T : never;
type NodeAction<S, U, C extends SDZod> = RunnableLike<S, U extends object ? U & Record<string, any> : U, // eslint-disable-line @typescript-eslint/no-explicit-any
LangGraphRunnableConfig<StateType<ToStateDefinition<C>>>>;
declare const PartialStateSchema: unique symbol;
type PartialStateSchema = typeof PartialStateSchema;
type MergeReturnType<Prev, Curr> = Prev & Curr extends infer T ? {
    [K in keyof T]: T[K];
} & unknown : never;
type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};
/**
 * A graph whose nodes communicate by reading and writing to a shared state.
 * Each node takes a defined `State` as input and returns a `Partial<State>`.
 *
 * Each state key can optionally be annotated with a reducer function that
 * will be used to aggregate the values of that key received from multiple nodes.
 * The signature of a reducer function is (left: Value, right: UpdateValue) => Value.
 *
 * See {@link Annotation} for more on defining state.
 *
 * After adding nodes and edges to your graph, you must call `.compile()` on it before
 * you can use it.
 *
 * @example
 * ```ts
 * import {
 *   type BaseMessage,
 *   AIMessage,
 *   HumanMessage,
 * } from "@langchain/core/messages";
 * import { StateGraph, Annotation } from "@langchain/langgraph";
 *
 * // Define a state with a single key named "messages" that will
 * // combine a returned BaseMessage or arrays of BaseMessages
 * const StateAnnotation = Annotation.Root({
 *   sentiment: Annotation<string>,
 *   messages: Annotation<BaseMessage[]>({
 *     reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
 *       if (Array.isArray(right)) {
 *         return left.concat(right);
 *       }
 *       return left.concat([right]);
 *     },
 *     default: () => [],
 *   }),
 * });
 *
 * const graphBuilder = new StateGraph(StateAnnotation);
 *
 * // A node in the graph that returns an object with a "messages" key
 * // will update the state by combining the existing value with the returned one.
 * const myNode = (state: typeof StateAnnotation.State) => {
 *   return {
 *     messages: [new AIMessage("Some new response")],
 *     sentiment: "positive",
 *   };
 * };
 *
 * const graph = graphBuilder
 *   .addNode("myNode", myNode)
 *   .addEdge("__start__", "myNode")
 *   .addEdge("myNode", "__end__")
 *   .compile();
 *
 * await graph.invoke({ messages: [new HumanMessage("how are you?")] });
 *
 * // {
 * //   messages: [HumanMessage("how are you?"), AIMessage("Some new response")],
 * //   sentiment: "positive",
 * // }
 * ```
 */
export declare class StateGraph<SD extends SDZod | unknown, S = SD extends SDZod ? StateType<ToStateDefinition<SD>> : SD, U = SD extends SDZod ? UpdateType<ToStateDefinition<SD>> : Partial<S>, N extends string = typeof START, I extends SDZod = SD extends SDZod ? ToStateDefinition<SD> : StateDefinition, O extends SDZod = SD extends SDZod ? ToStateDefinition<SD> : StateDefinition, C extends SDZod = StateDefinition, NodeReturnType = unknown> extends Graph<N, S, U, StateGraphNodeSpec<S, U>, ToStateDefinition<C>> {
    channels: Record<string, BaseChannel>;
    waitingEdges: Set<[N[], N]>;
    /** @internal */
    _schemaDefinition: StateDefinition;
    /** @internal */
    _schemaRuntimeDefinition: InteropZodObject | undefined;
    /** @internal */
    _inputDefinition: I;
    /** @internal */
    _inputRuntimeDefinition: InteropZodObject | PartialStateSchema | undefined;
    /** @internal */
    _outputDefinition: O;
    /** @internal */
    _outputRuntimeDefinition: InteropZodObject | undefined;
    /**
     * Map schemas to managed values
     * @internal
     */
    _schemaDefinitions: Map<any, any>;
    /** @internal */
    _metaRegistry: SchemaMetaRegistry;
    /** @internal Used only for typing. */
    _configSchema: ToStateDefinition<C> | undefined;
    /** @internal */
    _configRuntimeSchema: InteropZodObject | undefined;
    constructor(fields: SD extends StateDefinition ? StateGraphArgsWithInputOutputSchemas<SD, ToStateDefinition<O>> : never, contextSchema?: C | AnnotationRoot<ToStateDefinition<C>>);
    constructor(fields: SD extends StateDefinition ? AnnotationRoot<SD> | StateGraphArgsWithStateSchema<SD, ToStateDefinition<I>, ToStateDefinition<O>> : never, contextSchema?: C | AnnotationRoot<ToStateDefinition<C>>);
    /** @deprecated Use `Annotation.Root` or `zod` for state definition instead. */
    constructor(fields: SD extends StateDefinition ? SD | StateGraphArgs<S> : StateGraphArgs<S>, contextSchema?: C | AnnotationRoot<ToStateDefinition<C>>);
    constructor(fields: SD extends InteropZodObject ? SD | ZodStateGraphArgsWithStateSchema<SD, I, O> : never, contextSchema?: C | AnnotationRoot<ToStateDefinition<C>>);
    get allEdges(): Set<[string, string]>;
    _addSchema(stateDefinition: SDZod): void;
    addNode<K extends string, NodeMap extends Record<K, NodeAction<S, U, C>>>(nodes: NodeMap): StateGraph<SD, S, U, N | K, I, O, C, MergeReturnType<NodeReturnType, {
        [key in keyof NodeMap]: NodeMap[key] extends NodeAction<S, infer U, C> ? U : never;
    }>>;
    addNode<K extends string, NodeInput = S, NodeOutput extends U = U>(nodes: [
        key: K,
        action: NodeAction<NodeInput, NodeOutput, C>,
        options?: StateGraphAddNodeOptions
    ][]): StateGraph<SD, S, U, N | K, I, O, C, MergeReturnType<NodeReturnType, {
        [key in K]: NodeOutput;
    }>>;
    addNode<K extends string, NodeInput = S, NodeOutput extends U = U>(key: K, action: NodeAction<NodeInput, NodeOutput, C>, options?: StateGraphAddNodeOptions): StateGraph<SD, S, U, N | K, I, O, C, MergeReturnType<NodeReturnType, {
        [key in K]: NodeOutput;
    }>>;
    addNode<K extends string, NodeInput = S>(key: K, action: NodeAction<NodeInput, U, C>, options?: StateGraphAddNodeOptions): StateGraph<SD, S, U, N | K, I, O, C, NodeReturnType>;
    addEdge(startKey: typeof START | N | N[], endKey: N | typeof END): this;
    addSequence<K extends string, NodeInput = S, NodeOutput extends U = U>(nodes: [
        key: K,
        action: NodeAction<NodeInput, NodeOutput, C>,
        options?: StateGraphAddNodeOptions
    ][]): StateGraph<SD, S, U, N | K, I, O, C, MergeReturnType<NodeReturnType, {
        [key in K]: NodeOutput;
    }>>;
    addSequence<K extends string, NodeMap extends Record<K, NodeAction<S, U, C>>>(nodes: NodeMap): StateGraph<SD, S, U, N | K, I, O, C, MergeReturnType<NodeReturnType, {
        [key in keyof NodeMap]: NodeMap[key] extends NodeAction<S, infer U, C> ? U : never;
    }>>;
    compile({ checkpointer, store, cache, interruptBefore, interruptAfter, name, description, }?: {
        checkpointer?: BaseCheckpointSaver | boolean;
        store?: BaseStore;
        cache?: BaseCache;
        interruptBefore?: N[] | All;
        interruptAfter?: N[] | All;
        name?: string;
        description?: string;
    }): CompiledStateGraph<Prettify<S>, Prettify<U>, N, I, O, C, NodeReturnType>;
}
/**
 * Final result from building and compiling a {@link StateGraph}.
 * Should not be instantiated directly, only using the StateGraph `.compile()`
 * instance method.
 */
export declare class CompiledStateGraph<S, U, N extends string = typeof START, I extends SDZod = StateDefinition, O extends SDZod = StateDefinition, C extends SDZod = StateDefinition, NodeReturnType = unknown> extends CompiledGraph<N, S, U, StateType<ToStateDefinition<C>>, UpdateType<ToStateDefinition<I>>, StateType<ToStateDefinition<O>>, NodeReturnType> {
    builder: StateGraph<unknown, S, U, N, I, O, C, NodeReturnType>;
    /**
     * The description of the compiled graph.
     * This is used by the supervisor agent to describe the handoff to the agent.
     */
    description?: string;
    /** @internal */
    _metaRegistry: SchemaMetaRegistry;
    constructor({ description, ...rest }: {
        description?: string;
    } & ConstructorParameters<typeof CompiledGraph<N, S, U, StateType<ToStateDefinition<C>>, UpdateType<ToStateDefinition<I>>, StateType<ToStateDefinition<O>>, NodeReturnType>>[0]);
    attachNode(key: typeof START, node?: never): void;
    attachNode(key: N, node: StateGraphNodeSpec<S, U>): void;
    attachEdge(starts: N | N[] | "__start__", end: N | "__end__"): void;
    attachBranch(start: N | typeof START, _: string, branch: Branch<S, N>, options?: {
        withReader?: boolean;
    }): void;
    protected _validateInput(input: UpdateType<ToStateDefinition<I>>): Promise<UpdateType<ToStateDefinition<I>>>;
    protected _validateContext(config: Partial<Record<string, unknown>>): Promise<Partial<Record<string, unknown>>>;
}
type TypedNodeAction<SD extends StateDefinition, Nodes extends string, C extends StateDefinition = StateDefinition> = RunnableLike<StateType<SD>, UpdateType<SD> | Command<unknown, UpdateType<SD>, Nodes>, LangGraphRunnableConfig<StateType<C>>>;
export declare function typedNode<SD extends SDZod, Nodes extends string, C extends SDZod = StateDefinition>(_state: SD extends StateDefinition ? AnnotationRoot<SD> : never, _options?: {
    nodes?: Nodes[];
    config?: C extends StateDefinition ? AnnotationRoot<C> : never;
}): (func: TypedNodeAction<ToStateDefinition<SD>, Nodes, ToStateDefinition<C>>, options?: StateGraphAddNodeOptions<Nodes>) => TypedNodeAction<ToStateDefinition<SD>, Nodes, ToStateDefinition<C>>;
export declare function typedNode<SD extends SDZod, Nodes extends string, C extends SDZod = StateDefinition>(_state: SD extends InteropZodObject ? SD : never, _options?: {
    nodes?: Nodes[];
    config?: C extends InteropZodObject ? C : never;
}): (func: TypedNodeAction<ToStateDefinition<SD>, Nodes, ToStateDefinition<C>>, options?: StateGraphAddNodeOptions<Nodes>) => TypedNodeAction<ToStateDefinition<SD>, Nodes, ToStateDefinition<C>>;
export {};
