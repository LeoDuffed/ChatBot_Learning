import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getOrCreateMyBot } from "@/lib/bot";
import { parseUtterance } from "@/lib/nlu";
import { semanticSearchProducts, getProductBySku } from "@/lib/search";

type Pending =
  | { step: "await_qty"; productId: string; sku: string }
  | { step: "await_confirm"; productId: string; sku: string; qty: number };

const pendingByChat = new Map<string, Pending>();

function priceStr(cents: number) { return (cents / 100).toFixed(2); }
function listLines(items: { sku: string; name: string; priceCents: number; stock: number }[]) {
  return items.map(i => `• ${i.sku} — ${i.name} — $${priceStr(i.priceCents)} — stock ${i.stock}`).join("\n");
}

const SAFE_RESPONDER_SYSTEM = `
Eres AYOLIN. Redacta natural en español SOLO con los "hechos" que te paso.
Si un dato (precio, stock) no aparece en hechos, NO LO INVENTES.
No ofrezcas acciones que no existen (fotos, enlaces, tracking).
`.trim();

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await params;
    const { text } = (await req.json()) as { text: string };
    if (!text?.trim()) return NextResponse.json({ error: "Texto vacío" }, { status: 400 });

    const chat = await db.chat.findUnique({ where: { id: chatId } });
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    // guarda mensaje user
    await db.message.create({ data: { chatId, role: "user", content: text.trim() } });

    const bot = await getOrCreateSingletonBot();

    // ===== 1) Confirmación pendiente (sí/no/qty)
    const pending = pendingByChat.get(chatId);
    if (pending) {
      const low = text.trim().toLowerCase();

      // qty inline: "sí 3" / "quiero 5"
      const qtyMatch = low.match(/\b(\d{1,3})\b/);
      if (pending.step === "await_confirm" && qtyMatch) {
        pending.qty = Math.max(1, parseInt(qtyMatch[1], 10));
        pendingByChat.set(chatId, pending);
      }

      // ----------- Aqui vamos ---------
      // stock question mientras hay pending → responde del MISMO producto
      if (/\b(cuantos|cuantas|cuánto|stock|quedan?)\b/.test(low)) {
        const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } });
        const msg = p ? (p.stock > 0
          ? `De ${p.name} (SKU ${p.sku}) tengo ${p.stock} disponibles.`
          : `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.`)
          : "No encuentro el producto ahora.";
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: msg },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }

      if (/^s[ií]\b/.test(low)) {
        // confirmar compra
        if (pending.step !== "await_confirm") {
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: "¿Cuántas unidades necesitas?" },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }
        pendingByChat.delete(chatId);

        const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } });
        if (!p) {
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: "No encontré el producto al confirmar. Inténtalo de nuevo." },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        const want = Math.max(1, pending.qty);
        const dec = await db.product.updateMany({
          where: { id: p.id, chatbotId: bot.id, stock: { gte: want } },
          data: { stock: { decrement: want } },
        });
        if (dec.count !== 1) {
          const fresh = await db.product.findUnique({ where: { id: p.id } });
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: `Ya no tengo stock suficiente. Disponible ahora: ${fresh?.stock ?? 0}.` },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        const sale = await db.sale.create({
          data: { chatbotId: bot.id, productId: p.id, qty: want, status: "pending_payment", paymentMethod: "cash" },
        });
        await db.inventoryLedger.create({
          data: { chatbotId: bot.id, productId: p.id, delta: -want, reason: "sale", ref: sale.id },
        });

        const reply = `Listo. Aparté ${want} × ${p.name} (SKU ${p.sku}). Pedido **pendiente de pago**.`;
        const [assistantMessage] = await Promise.all([
          db.message.create({ data: { chatId, role: "assistant", content: reply }, select: { id: true, role: true, content: true, createdAt: true } }),
          (!chat.title || chat.title === "Nuevo chat") &&
            db.chat.update({ where: { id: chatId }, data: { title: `Pedido ${p.sku} × ${want}` } }),
        ]);
        return NextResponse.json({ message: assistantMessage });
      }

      if (/^no\b/.test(low)) {
        pendingByChat.delete(chatId);
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }
      // si el usuario cambia de tema, seguimos abajo
    }

    // ===== 2) NLU: entender intención/sku/qty/consulta
    const nlu = await parseUtterance(text);

    // ===== 3) Resolver con herramientas/BD (sin inventar)
    let facts: string[] = [];
    let answer: string | null = null;

    // A) SKU directo → prioriza exact match
    let product = nlu.sku ? await getProductBySku(bot.id, nlu.sku) : null;

    // B) Search semántico si no hay SKU o queremos confirmar nombre
    let candidates = !product && (nlu.product_query || nlu.intent === "ask_inventory")
      ? await semanticSearchProducts(bot.id, nlu.product_query || "inventario")
      : [];

    // Reglas por intención
    switch (nlu.intent) {
      case "ask_inventory": {
        if (!product && candidates.length === 0) {
          // sin query ⇒ lista corta general (con stock > 0 si hay)
          const some = await db.product.findMany({
            where: { chatbotId: bot.id },
            orderBy: { createdAt: "desc" },
            take: 5,
          });
          if (some.length === 0) {
            answer = "Aún no tengo productos cargados. Puedes darme un nombre o SKU para buscar.";
            break;
          }
          facts.push("Opciones:", listLines(some));
          break;
        }
        if (product) {
          facts.push(`1 match: ${product.sku} — ${product.name} — $${priceStr(product.priceCents)} — stock ${product.stock}`);
        } else {
          const items = candidates.map(c => ({ sku: c.sku, name: c.name, priceCents: c.priceCents, stock: c.stock }));
          facts.push("Opciones:", listLines(items));
        }
        break;
      }

      case "ask_availability":
      case "ask_stock":
      case "ask_price": {
        const item = product ?? candidates[0];
        if (!item) { answer = "No encontré productos para esa descripción. ¿Tienes el SKU exacto o un nombre más específico?"; break; }
        facts.push(`${item.name} (SKU ${item.sku})`, `precio: $${priceStr(item.priceCents)}`, `stock: ${item.stock}`);
        break;
      }

      case "buy": {
        const item = product ?? candidates[0];
        if (!item) { answer = "No encontré productos con esa descripción. ¿Puedes compartir el SKU o un nombre más específico?"; break; }

        const qty = Math.max(1, nlu.qty ?? 0);
        if (!qty) {
          // pedir cantidad primero
          pendingByChat.set(chatId, { step: "await_qty", productId: item.id, sku: item.sku });
          answer = `Perfecto, ${item.name} (SKU ${item.sku}) cuesta $${priceStr(item.priceCents)}. ¿Cuántas unidades necesitas?`;
          break;
        }

        // tenemos qty => pedir confirmación
        if (item.stock < qty) {
          answer = `Solo tengo ${item.stock} de ${item.name}. ¿Quieres ajustar la cantidad?`;
          break;
        }
        pendingByChat.set(chatId, { step: "await_confirm", productId: item.id, sku: item.sku, qty });
        const total = priceStr(item.priceCents * qty);
        answer = `Tengo ${qty} × ${item.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`;
        break;
      }

      case "chit_chat":
      default:
        // charlar normal: aquí sí podemos usar LLM sin datos de BD
        const history = await db.message.findMany({
          where: { chatId }, orderBy: { createdAt: "asc" }, take: 30,
        });
        const messages = history.map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.content,
        }));
        const llm = await generateText({
          model: openai("gpt-4.1-mini"),
          system: "Eres AYOLIN, amigable y conciso.",
          messages,
          temperature: 0.6,
          maxOutputTokens: 180,
        });
        answer = llm.text?.trim() || "¿En qué te ayudo?";
    }

    // ===== 4) Redacción segura (si no definimos answer con plantilla)
    if (!answer) {
      const factsText = facts.join("\n");
      const llm = await generateText({
        model: openai("gpt-4.1-mini"),
        system: SAFE_RESPONDER_SYSTEM,
        prompt: `Hechos:\n${factsText}\n\nRedacta una respuesta corta y útil basada SOLO en esos hechos.`,
        temperature: 0.2,
        maxOutputTokens: 140,
      });
      answer = llm.text?.trim() || "¿Te ayudo con algo más?";
    }

    const [assistantMessage] = await Promise.all([
      db.message.create({ data: { chatId, role: "assistant", content: answer }, select: { id: true, role: true, content: true, createdAt: true } }),
      (!chat.title || chat.title === "Nuevo chat") &&
        db.chat.update({ where: { id: chatId }, data: { title: text.slice(0, 40) } }),
    ]);

    return NextResponse.json({ message: assistantMessage });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

