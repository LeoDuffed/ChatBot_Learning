import { Annotation } from "@langchain/langgraph";

export type Role = "guest" | "owner";

export type Intent =
  | "ask_inventory"
  | "ask_availability"
  | "ask_stock"
  | "ask_price"
  | "buy"
  | "chit_chat"
  | "owner_login"
  | "unknown";

export interface Candidate {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  priceCents: number;
  stock: number;
  score?: number;
}

/**
 * LangGraph (JS/TS) usa Annotations para tipar el estado.
 * Los nodos deben devolver PARCIALES del estado (Partial).
 */
export const AgentSpec = Annotation.Root({
  chatId: Annotation<string>(),
  // Para defaults debes proveer un reducer y una función default
  role: Annotation<Role>({
    reducer: (_prev, next) => next,
    default: () => "guest",
  }),
  userMessage: Annotation<string>(),

  // Campos opcionales: no pases config (solo usa LastValue)
  intent: Annotation<Intent | undefined>(),
  sku: Annotation<string | null | undefined>(),
  qty: Annotation<number | null | undefined>(),
  product_query: Annotation<string | null | undefined>(),

  product: Annotation<Candidate | null | undefined>(),
  candidates: Annotation<Candidate[] | undefined>(),

  facts: Annotation<string[] | undefined>(),
  answer: Annotation<string | undefined>(),
  error: Annotation<string | undefined>(),
});

// Tipo del estado que reciben/retornan los nodos
export type AgentState = typeof AgentSpec.State;
