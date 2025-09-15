import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";
import { parseOrder } from "@/lib/orderParser";
import { extractKeywords, detectIntent, parseQuantityFromText } from "@/lib/textQuery";
import { Prisma } from "@/generated/prisma";
import { runMiniAyolinTurn } from "@/ai/agent";

type Pending =
  | { step: "await_qty"; productId: string; sku: string }
  | { step: "await_confirm"; productId: string; sku: string; qty: number };

const pendingByChat = new Map<string, Pending>(); // Estado temporal en memoria (mini-ayolin)

function priceStr(cents: number) {
  return (cents / 100).toFixed(2);
}
function listLines(products: { sku: string; name: string; priceCents: number; stock: number }[]) {
  return products.map((p) => `• ${p.sku} — ${p.name} — $${priceStr(p.priceCents)} — stock ${p.stock}`).join("\n");
}

function buildWhereAND(botId: string, tokens: string[]): Prisma.ProductWhereInput {
  const AND: Prisma.ProductWhereInput[] = tokens.map((tok) => ({
    OR: [
      { name: { contains: tok, mode: "insensitive" as const } },
      { sku: { contains: tok.toUpperCase() } },
    ],
  }));
  return { chatbotId: botId, AND };
}

function buildWhereOR(botId: string, tokens: string[]): Prisma.ProductWhereInput {
  const OR: Prisma.ProductWhereInput[] = tokens.flatMap((tok) => [
    { name: { contains: tok, mode: "insensitive" as const } },
    { sku: { contains: tok.toUpperCase() } },
  ]);
  return { chatbotId: botId, OR };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await params;
    const { text } = (await req.json()) as { text: string };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Texto vacío" }, { status: 400 });
    }

    // Validar chat
    const chat = await db.chat.findUnique({ where: { id: chatId } });
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    // Guardar mensaje del usuario
    await db.message.create({ data: { chatId, role: "user", content: text.trim() } });

    const bot = await getOrCreateMyBot();
    const normalized = text.trim().toLowerCase();
    const intent = detectIntent(text);
    const tokens = extractKeywords(text);

    // 1) Conversación pendiente (confirmación/cantidad/stock)
    const pending = pendingByChat.get(chatId);
    if (pending) {
      // Si piden cantidad mientras confirma, actualiza qty detectada
      const qtyInText = parseQuantityFromText(text);
      if (pending.step === "await_confirm" && qtyInText && qtyInText !== pending.qty) {
        pending.qty = qtyInText;
        pendingByChat.set(chatId, pending);
      }

      // Pregunta de stock mientras hay pendiente
      if (/\b(cuantos|cuantas|cuánto|stock|quedan?)\b/i.test(text)) {
        const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } });
        if (!p) {
          pendingByChat.delete(chatId);
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: "No encuentro el producto ahora. Intentemos de nuevo." },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }
        const msg =
          p.stock > 0
            ? `De ${p.name} (SKU ${p.sku}) tengo ${p.stock} disponibles.`
            : `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.`;
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: msg },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }

      // Confirmación "sí"
      if (/(^|\b)s[ií]\b/.test(normalized)) {
        const pend = pending as Extract<Pending, { step: "await_confirm" }>;
        if (pend?.step !== "await_confirm") {
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: "¿Cuántas unidades necesitas?" },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        pendingByChat.delete(chatId);

        const product = await db.product.findFirst({ where: { id: pend.productId, chatbotId: bot.id } });
        if (!product) {
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: "No encontré el producto al confirmar. Inténtalo de nuevo." },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        const want = Math.max(1, pend.qty);
        const dec = await db.product.updateMany({
          where: { id: product.id, chatbotId: bot.id, stock: { gte: want } },
          data: { stock: { decrement: want } },
        });
        if (dec.count !== 1) {
          const fresh = await db.product.findFirst({ where: { id: product.id } });
          const assistantMessage = await db.message.create({
            data: {
              chatId,
              role: "assistant",
              content: `Ya no tengo stock suficiente. Disponible ahora: ${fresh?.stock ?? 0}.`,
            },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        const sale = await db.sale.create({
          data: {
            chatbotId: bot.id,
            productId: product.id,
            qty: want,
            status: "pending_payment",
            paymentMethod: "cash",
          },
        });
        await db.inventoryLedger.create({
          data: { chatbotId: bot.id, productId: product.id, delta: -want, reason: "sale", ref: sale.id },
        });

        const reply = `Listo. Aparté ${want} × ${product.name} (SKU ${product.sku}). Pedido **pendiente de pago**.`;
        const [assistantMessage] = await Promise.all([
          db.message.create({
            data: { chatId, role: "assistant", content: reply },
            select: { id: true, role: true, content: true, createdAt: true },
          }),
          (!chat.title || chat.title === "Nuevo chat") &&
            db.chat.update({ where: { id: chatId }, data: { title: `Pedido ${product.sku} × ${want}` } }),
        ]);
        return NextResponse.json({ message: assistantMessage });
      }

      // Negación "no"
      if (/^no\b/i.test(normalized)) {
        pendingByChat.delete(chatId);
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }

      // Si cambió de intención, seguimos abajo con búsqueda normal
    }

    // 2) Búsqueda/venta directa por texto (SKU + cantidad en el mismo texto)
    const parsedBySku = parseOrder(text);
    if (parsedBySku) {
      const product = await db.product.findUnique({
        where: { chatbotId_sku: { chatbotId: bot.id, sku: parsedBySku.sku } },
      });
      if (!product) {
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: `No encontré el SKU ${parsedBySku.sku}.` },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }
      if (product.stock < parsedBySku.qty) {
        const assistantMessage = await db.message.create({
          data: {
            chatId,
            role: "assistant",
            content: `Solo tengo ${product.stock} de ${product.name}. ¿Quieres ajustar la cantidad?`,
          },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }
      // Dejar confirmación pendiente
      pendingByChat.set(chatId, { step: "await_confirm", productId: product.id, sku: product.sku, qty: parsedBySku.qty });
      const total = priceStr(product.priceCents * parsedBySku.qty);
      const confirm = `Tengo ${parsedBySku.qty} × ${product.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`;
      const assistantMessage = await db.message.create({
        data: { chatId, role: "assistant", content: confirm },
        select: { id: true, role: true, content: true, createdAt: true },
      });
      return NextResponse.json({ message: assistantMessage });
    }

    // 2b) Búsqueda por palabras clave (intents)
    const whereAND = tokens.length
      ? buildWhereAND(bot.id, tokens)
      : ({ chatbotId: bot.id } as Prisma.ProductWhereInput);

    let results = await db.product.findMany({
      where: whereAND,
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // Si AND no trae nada, probar OR
    if (results.length === 0 && tokens.length) {
      const whereOR = buildWhereOR(bot.id, tokens);
      results = await db.product.findMany({
        where: whereOR,
        orderBy: { createdAt: "desc" },
        take: 5,
      });
    }

    if (intent) {
      if (results.length === 0) {
        const assistantMessage = await db.message.create({
          data: {
            chatId,
            role: "assistant",
            content: "No encontré productos con esa descripción. ¿Tienes el SKU exacto o un nombre más específico?",
          },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        return NextResponse.json({ message: assistantMessage });
      }

      if (results.length === 1) {
        const p = results[0];

        if (intent === "ask_price") {
          const msg = `${p.name} (SKU ${p.sku}) cuesta $${priceStr(p.priceCents)}.`;
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        if (intent === "ask_stock" || intent === "ask_availability") {
          const disp = p.stock > 0 ? `Sí, tengo ${p.stock} disponibles` : "No, está agotado";
          const msg = `${disp} de ${p.name} (SKU ${p.sku}). Precio: $${priceStr(p.priceCents)}.`;
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }

        // Intento de compra por nombre → pedir cantidad
        if (intent === "buy") {
          pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku });
          const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr(p.priceCents)}. ¿Cuántas unidades necesitas?`;
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return NextResponse.json({ message: assistantMessage });
        }
      }

      // Varias coincidencias
      const msg = `Encontré varias opciones:\n${listLines(results)}\n\nElige por SKU (ej: ${
        results[0].sku
      })${intent === "buy" ? " y dime cuántas" : "" }.`;
      const assistantMessage = await db.message.create({
        data: { chatId, role: "assistant", content: msg },
        select: { id: true, role: true, content: true, createdAt: true },
      });
      return NextResponse.json({ message: assistantMessage });
    }

    // 3) Fallback —> agente con tools (anti-alucinaciones)
    // Tomamos últimos 30 mensajes como contexto
    const history = await db.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
      take: 30,
    });

    const priorMessages = history.map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const { content } = await runMiniAyolinTurn({
      userMessage: text,
      priorMessages,
      ctx: { db, botId: bot.id, userId: null },
    });

    const reply = content?.trim() || "¿En qué te puedo ayudar?";
    const [assistantMessage] = await Promise.all([
      db.message.create({
        data: { chatId, role: "assistant", content: reply },
        select: { id: true, role: true, content: true, createdAt: true },
      }),
      (!chat.title || chat.title === "Nuevo chat") &&
        db.chat.update({ where: { id: chatId }, data: { title: text.slice(0, 40) } }),
    ]);

    return NextResponse.json({ message: assistantMessage });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
