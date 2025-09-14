/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AgentState, Candidate, Intent } from "./state";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { parseUtterance } from "@/lib/nlu";
import { db } from "@/lib/db";
import { semanticSearchProducts, getProductBySku } from "@/lib/search";
import { ChatOpenAI } from "@langchain/openai";
import { readMem, writeMem, clearMem, type Pending as MemPending } from "@/lib/memory";
import { getOrCreateMyBot } from "@/lib/bot";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function toCandidate(p: any): Candidate {
  return {
    id: String(p.id),
    sku: p.sku,
    name: p.name,
    description: p.description ?? null,
    priceCents: p.priceCents,
    stock: p.stock,
    score: (p as any).score,
  };
}

/** 1) Clasificar intención (NLU) */
export async function classify_intent(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const nlu = await parseUtterance(state.userMessage);
    const intent = (nlu.intent ?? "unknown") as Intent;
    return {
      intent,
      sku: nlu.sku ?? null,
      qty: nlu.qty ?? null,
      product_query: (nlu.product_query ?? null) || null,
    };
  } catch {
    return { intent: "unknown", error: "NLU error" };
  }
}

/** 2) Recuperar producto/candidatos */
export async function retrieve(state: AgentState): Promise<Partial<AgentState>> {
  const need = ["ask_inventory", "ask_availability", "ask_stock", "ask_price", "buy"].includes(state.intent ?? "unknown");
  if (!need) return {};

  const bot = await getOrCreateMyBot();

  // Si hay pending en memoria, mantenemos el contexto del producto
  const mem = readMem(state.chatId);
  if (!state.sku && !state.product && mem.pending?.productId) {
    const p = await db.product.findFirst({ where: { id: mem.pending.productId, chatbotId: bot.id } });
    if (p) return { product: toCandidate(p) };
  }

  let product: Candidate | null = null;
  if (state.sku) {
    const bySku = await getProductBySku(bot.id, state.sku);
    if (bySku) product = toCandidate(bySku);
  }

  let candidates: Candidate[] = [];
  const q = state.product_query || state.userMessage;
  if (!product && q) {
    const sem = await semanticSearchProducts(bot.id, q, 8);
    candidates = sem.map(toCandidate);
    if (!product && candidates.length > 0) product = candidates[0] ?? null;
  }

  return { product, candidates };
}

/** 3) Negocio + herramientas + memoria */
export async function maybe_tool_call(state: AgentState): Promise<Partial<AgentState>> {
  const facts: string[] = [];
  const intent = state.intent ?? "unknown";
  const listLines = (items: Candidate[]) => items.map(i => `• ${i.sku} — ${i.name} — ${money(i.priceCents)} — stock ${i.stock}`).join("\n");

  const bot = await getOrCreateMyBot();
  const low = state.userMessage.trim().toLowerCase();

  // --- Manejo de pending en memoria ---
  const mem = readMem(state.chatId).pending;

  // Helper: confirmar sí/no
  const isYes = /^(s[ií](\b|,)|va\b|dale\b|confirmo\b)/i.test(low);
  const isNo  = /^(no\b|nel\b|nopi\b)/i.test(low);
  // Helper: qty en texto (nlu.qty ya ayuda; esto es fallback)
  const qtyInText = state.qty ?? (low.match(/\b(\d{1,3})\b/) ? parseInt(RegExp.$1, 10) : null);

  if (mem) {
    // Cargar producto de contexto
    const p = await db.product.findFirst({ where: { id: mem.productId, chatbotId: bot.id } });
    if (!p) {
      clearMem(state.chatId);
      facts.push("No encuentro el producto pendiente. Intentemos de nuevo con SKU o nombre.");
      return { facts };
    }

    if (mem.step === "await_qty") {
      if (qtyInText && qtyInText > 0) {
        const want = Math.max(1, qtyInText);
        // pasamos a confirmación
        const next: MemPending = { step: "await_confirm", productId: mem.productId, sku: mem.sku, qty: want };
        writeMem(state.chatId, { pending: next });

        const total = money(p.priceCents * want);
        facts.push(`Tengo ${want} × ${p.name} (SKU ${p.sku}) por ${total}. ¿Confirmas la compra? (sí/no)`);
        return { facts };
      }
      // todavía sin qty
      facts.push(`${p.name} (SKU ${p.sku}) cuesta ${money(p.priceCents)}. ¿Cuántas unidades necesitas?`);
      return { facts };
    }

    if (mem.step === "await_confirm") {
      // permite “sí 5” para ajustar qty on-the-fly
      let want = mem.qty;
      if (qtyInText && qtyInText !== want) want = Math.max(1, qtyInText);

      if (isYes) {
        // intentar bajar stock de forma segura
        const dec = await db.product.updateMany({
          where: { id: p.id, chatbotId: bot.id, stock: { gte: want } },
          data: { stock: { decrement: want } },
        });
        if (dec.count !== 1) {
          const fresh = await db.product.findFirst({ where: { id: p.id } });
          facts.push(`El stock cambió. Disponible ahora: ${fresh?.stock ?? 0}.`);
          clearMem(state.chatId);
          return { facts };
        }

        const sale = await db.sale.create({
          data: { chatbotId: bot.id, productId: p.id, qty: want, status: "pending_payment", paymentMethod: "cash" },
        });
        await db.inventoryLedger.create({
          data: { chatbotId: bot.id, productId: p.id, delta: -want, reason: "sale", ref: sale.id },
        });

        clearMem(state.chatId);
        facts.push(`Listo. Aparté ${want} × ${p.name} (SKU ${p.sku}). Pedido pendiente de pago.`);
        return { facts };
      }

      if (isNo) {
        clearMem(state.chatId);
        facts.push("Sin problema, no realizo la compra. ¿Buscamos otra cosa?");
        return { facts };
      }

      // Pregunta stock durante confirm
      if (/\b(cuantos|cuantas|cuánto|stock|quedan?)\b/i.test(low)) {
        facts.push(p.stock > 0
          ? `De ${p.name} (SKU ${p.sku}) tengo ${p.stock} disponibles.`
          : `De ${p.name} (SKU ${p.sku}) no hay stock ahora.`
        );
        return { facts };
      }

      // Si no entendí, re-pregunto confirmar
      const total = money(p.priceCents * want);
      facts.push(`Tengo ${want} × ${p.name} por ${total}. ¿Confirmas la compra? (sí/no)`);
      return { facts };
    }
  }

  // --- Flujo normal sin pending ---
  switch (intent) {
    case "ask_inventory": {
      if (!state.product && (!state.candidates || state.candidates.length === 0)) {
        const some = await db.product.findMany({ where: { chatbotId: bot.id }, orderBy: { createdAt: "desc" }, take: 5 });
        if (some.length === 0) { facts.push("No hay productos cargados todavía."); break; }
        facts.push("Opciones:", listLines(some.map(toCandidate)));
        break;
      }
      if (state.product) {
        const p = state.product;
        facts.push(`1 match: ${p.sku} — ${p.name} — ${money(p.priceCents)} — stock ${p.stock}`);
      } else if (state.candidates?.length) {
        facts.push("Opciones:", listLines(state.candidates));
      }
      break;
    }

    case "ask_availability":
    case "ask_stock":
    case "ask_price": {
      const item = state.product ?? state.candidates?.[0] ?? null;
      if (!item) { facts.push("No encontré productos para esa descripción. Pide por SKU o da más detalles."); break; }
      facts.push(`${item.name} (SKU ${item.sku})`, `precio: ${money(item.priceCents)}`, `stock: ${item.stock}`);
      break;
    }

    case "buy": {
      const item = state.product ?? state.candidates?.[0] ?? null;
      if (!item) { facts.push("No encontré productos con esa descripción. Comparte el SKU o un nombre más específico."); break; }

      const want = Math.max(1, state.qty ?? 0);
      if (!want) {
        // guardo pending para preguntar cantidad
        writeMem(state.chatId, { pending: { step: "await_qty", productId: item.id, sku: item.sku } });
        facts.push(`Perfecto, ${item.name} (SKU ${item.sku}) cuesta ${money(item.priceCents)}. ¿Cuántas unidades necesitas?`);
        break;
      }
      if (item.stock < want) { facts.push(`Solo hay ${item.stock} de ${item.name}. ¿Deseas ajustar la cantidad?`); break; }

      // guardo pending confirm
      writeMem(state.chatId, { pending: { step: "await_confirm", productId: item.id, sku: item.sku, qty: want } });
      const total = money(item.priceCents * want);
      facts.push(`Tengo ${want} × ${item.name} por ${total}. ¿Confirmas la compra? (sí/no)`);
      break;
    }

    case "chit_chat":
    default: {
      facts.push("Puedo ayudarte a buscar productos por nombre o SKU, consultar stock/precio y apartar pedidos.");
      break;
    }
  }

  return { facts };
}

/** 4) Redacción segura */
export async function compose_answer(state: AgentState): Promise<Partial<AgentState>> {
  const factsText = (state.facts ?? []).join("\n");
  if (!factsText.trim()) return { answer: "No cuento con datos suficientes para responder." };

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.2, maxTokens: 140 });
  const res = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Hechos (usa SOLO esto):\n${factsText}\n\nRedacta una respuesta breve y clara en español basada únicamente en los hechos.` },
  ]);

  const answer =
    typeof res?.content === "string"
      ? res.content
      : Array.isArray(res?.content)
      ? res.content.map((c: any) => c.text ?? "").join("").trim()
      : "";

  return { answer: answer || factsText };
}

/** 5) Owner gate (futuro) */
export async function owner_gate(_state: AgentState): Promise<Partial<AgentState>> {
  return {};
}

/** 6) Persistencia de memoria al final (por ahora no-op; ya escribimos in-node) */
export async function memory_update(_state: AgentState): Promise<Partial<AgentState>> {
  return {};
}
