/* eslint-disable @typescript-eslint/no-explicit-any */

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

// heristico de negocio
// Si en el texto aparece compra/stock/precio o trae algo como el sku mandamos a retrieve
function looksBusinessRoute(s: AgentState){
  const t = (s as any).userMessage?.toLowerCase?.() ?? ""
  const hasSku = /\bsku\b/.test(t) || /\b[A-Z]{1,}[A-Z0-9._-]*\d+\b/.test(t) // tokens con letras+digitos
  const buyVerb = /\b(quiero|comprar|aparta(r)?|reservar|me\s+lo\s+llevo|llevar)\b/.test(t)
  const invVerb = /\b(tienes|hay|manejas|vendes|disponible|disponibles|stock|cuántos|cuanto|precio|cuánto\s+cuesta|vale)\b/.test(t)
  return hasSku || buyVerb || invVerb 
}

/*
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
    .addNode("memory_update", memory_update)

  g = g.addEdge(START, "classify_intent")
  g = g.addEdge("classify_intent", "owner_gate")

  g = g.addConditionalEdges( "owner_gate", (s: AgentState) =>{
    const intent = new Set(["ask_inventory", "ask_availability", "ask_stock", "ask_price", "buy"])
    if(s.intent && intent.has(s.intent as string)) return "retrieve"
    if(looksBusinessRoute(s)) return "retrieve"
    return "maybe_tool_call"
  })

  g = g.addEdge("retrieve", "maybe_tool_call");
  g = g.addEdge("maybe_tool_call", "compose_answer");
  g = g.addEdge("compose_answer", "memory_update");
  g = g.addEdge("memory_update", END);

  return g.compile();
}
