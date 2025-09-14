import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentSpec, type AgentState } from "./state";
import {
  classify_intent,
  retrieve,
  maybe_tool_call,
  compose_answer,
  owner_gate,
  memory_update,
} from "./nodes";

/**
 * En TS, StateGraph recibe la SPEC (Annotation.Root),
 * no un objeto "channels: {}". Los nodos devuelven parciales.
 */
export function buildGraph() {
  let g = new StateGraph(AgentSpec)
    .addNode("classify_intent", classify_intent)
    .addNode("owner_gate", owner_gate)
    .addNode("retrieve", retrieve)
    .addNode("maybe_tool_call", maybe_tool_call)
    .addNode("compose_answer", compose_answer)
    .addNode("memory_update", memory_update);

  g = g.addEdge(START, "classify_intent");

  g = g.addEdge("classify_intent", "owner_gate");

  g = g.addConditionalEdges(
    "owner_gate",
    (s: AgentState) =>
      [
        "ask_inventory",
        "ask_availability",
        "ask_stock",
        "ask_price",
        "buy",
      ].includes(s.intent ?? "")
        ? "retrieve"
        : "maybe_tool_call"
  );

  g = g.addEdge("retrieve", "maybe_tool_call");
  g = g.addEdge("maybe_tool_call", "compose_answer");
  g = g.addEdge("compose_answer", "memory_update");
  g = g.addEdge("memory_update", END);

  return g.compile();
}
