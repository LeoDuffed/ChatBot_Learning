import { NextRequest, NextResponse } from "next/server" 
import { db } from "@/lib/db" 
import { getOrCreateMyBot } from "@/lib/bot" 
import { parseOrder } from "@/lib/orderParser" 
import { 
    extractKeywords,
    detectIntent, 
    parseQuantityFromText,
    singularizeBasic, 
} from "@/lib/textQuery" 
import { Prisma } from "@/generated/prisma" 
import { runMiniAyolinTurn } from "@/ai/agent" 

type Pending = | { step: "await_qty";  productId: string;  sku: string } | { step: "await_confirm";  productId: string;  sku: string;  qty: number }

const pendingByChat = new Map<string, Pending>() // Estado temporal en memoria (mini-ayolin)

const candidatesByChat = new Map<string, { productId: string[]; ts: number }>()

function setCandidates(chatId: string, ids: string[]){
    candidatesByChat.set(chatId, { productId: ids, ts: Date.now() })
}

function clearCandidates(chatId: string){
    candidatesByChat.delete(chatId)
}

function getCandidates(chatId: string): string[] | null{
    const v = candidatesByChat.get(chatId)
    if(!v) return null
    if(Date.now() - v.ts > 10 * 60 * 1000){
        candidatesByChat.delete(chatId)
        return null
    }
    return v.productId
}

function priceStr(cents: number) {
  return (cents / 100).toFixed(2)
}
function listLines(products: { sku: string;  name: string;  priceCents: number;  stock: number }[]) {
  return products.map((p) => `• ${p.sku} — ${p.name} — $${priceStr(p.priceCents)} — stock ${p.stock}`).join("\n") 
}

function buildWhereAND(botId: string, tokens: string[]): Prisma.ProductWhereInput {
    const AND: Prisma.ProductWhereInput[] = tokens.map((tok) => {
        const t = tok
        const s = singularizeBasic(tok)
        const set = Array.from(new Set([t, s].filter(Boolean)))
        return{
            OR: set.flatMap((w) => [
                { name: { contains: w, mode: "insensitive" as const } },
                { sku: { contains: w.toUpperCase() } },
            ]),
        }
    }) 
  return { chatbotId: botId, AND } 
}

function buildWhereOR(botId: string, tokens: string[]): Prisma.ProductWhereInput {
    const pairs = tokens.flatMap((tok) => {
        const t = tok
        const s = singularizeBasic(tok)
        const set = Array.from(new Set([t, s].filter(Boolean)))
        return set.flatMap((w) => [
            { name: { contains: w, mode: "insensitive" as const } },
            { sku: { contains: w.toUpperCase() } },
        ])
    })
    return { chatbotId: botId, OR: pairs }
}

// Negativas "limpias"
function isCleanNegative(normalize: string){
    const t = normalize.trim()
    if (/^(no|no\s+gracias)[.!]?$/.test(t)) return true
    if (/^(mejor\s+no|ya\s+no|olvidalo|olvídalo)[.!]?$/.test(t)) return true
    if (/\b(cancela|cancelar|cancela\s+pedido|cancelar\s+pedido)\b/.test(t)) return true
    return false
}

// Por ahora solo los primero tres para seleccionar, hay que ver como hacer para mas
function parseOrdinalIndex(text: string): number | null{
    const t = text.toLowerCase()
    if (/\b(primero|1(?:ro|°)?|#?1)\b/.test(t)) return 0;
    if (/\b(segundo|2(?:do|°)?|#?2)\b/.test(t)) return 1;
    if (/\b(tercero|3(?:ro|°)?|#?3)\b/.test(t)) return 2;
    return null
}

function wantsAllAvailable(text: string){
    const t = text.toLowerCase()
    return ( /\b(los\s+dos|los\s+2|ambos|todo(?:\s+el)?\s+stock|todos|me\s+llevo\s+todos|me\s+llevo\s+los\s+dos)\b/.test(t) )
}

export const runtime = "nodejs" 
export const dynamic = "force-dynamic" 

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await params 
    const { text } = (await req.json()) as { text: string } 

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Texto vacío" }, { status: 400 }) 
    }

    // Validar chat
    const chat = await db.chat.findUnique({ where: { id: chatId } }) 
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 }) 

    // Guardar mensaje del usuario
    await db.message.create({ data: { chatId, role: "user", content: text.trim() } }) 

    const bot = await getOrCreateMyBot() 
    const normalized = text.trim().toLowerCase() 
    const intent = detectIntent(text) 
    const tokens = extractKeywords(text) 

    // Si hay candidatos recordados y No hay pending -> intentamos una selccion natural
    const remembered = getCandidates(chatId)
    if(remembered && remembered.length > 0 && !pendingByChat.get(chatId)){
        if(remembered.length === 1){
            const p = await db.product.findFirst({ where: { id: remembered[0], chatbotId: bot.id } })
            if(p){

                if(wantsAllAvailable(text)){
                    const want = Math.max(1, p.stock)
                    if(want <= 0){
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content:`De ${p.name} (SKU ${p.sku}) no tengo stock ahora.` },
                            select: { id: true, role: true, content: true, createdAt: true },
                        })
                        return NextResponse.json({ message: assistantMessage })
                    }
                    pendingByChat.set(chatId, { step: "await_confirm", productId: p.id, sku: p.sku, qty: want })
                    const total = priceStr(p.priceCents * want)
                    const confirm = `Tengo ${want} × ${p.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: confirm },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                const qtyInText = parseQuantityFromText(text)
                if(qtyInText && qtyInText > 0){
                    if(qtyInText > (p.stock ?? 0)){
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content: `Solo tengo ${p.stock} de ${p.name}. ¿Ajustamos a ${p.stock}?` },
                            select: { id: true, role: true, content: true, createdAt: true },
                        })
                        return NextResponse.json({ message: assistantMessage })
                    }
                    pendingByChat.set(chatId, { step: "await_confirm", productId: p.id, sku: p.sku, qty: qtyInText })
                    const total = priceStr(p.priceCents * qtyInText )
                    const confirm = `Tengo ${qtyInText} × ${p.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: confirm },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                // Si no dan cantidad -> la pedimos
                if(p.stock <= 0){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.` },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku })
                const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr(p.priceCents)}. ¿Cuántas unidades necesitas?`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messgae: assistantMessage })
            }
        } else {
            const idx = parseOrdinalIndex(text)
            if(idx !== null && remembered[idx]){
                const p = await db.product.findFirst({ where: { id: remembered[idx], chatbotId: bot.id } })
                if(p){
                    if(p.stock <= 0){
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content: `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.` },
                            select: { id: true, role: true, content: true, createdAt: true },
                        })
                        return NextResponse.json({ message: assistantMessage })
                    }
                    pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku })
                    const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr(p.priceCents)}. ¿Cuántas unidades necesitas?`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: msg },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ messgae: assistantMessage })
                }
            }
        }
    }

    // 1) Conversación pendiente (confirmación/cantidad/stock)
    const pending = pendingByChat.get(chatId) 
    const yesRe = /(^|\b)(s[ií]|sí|si|claro|dale|va|ok|okay|confirmo|lo\s+compro)\b/i;
    const stockQRe = /\b(cuantos|cuantas|cuánto|stock|quedan?)\b/i;

    if (pending) {
      // Preguntar de stock en cualquier estado 
      if(stockQRe.test(text)){
        const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } })
        if(!p){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No encuentro el producto ahora. Intentemos de nuevo." },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }
        const msg = p.stock > 0 ? `De ${p.name} (SKU ${p.sku}) tengo ${p.stock} disponibles.` : `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ messge: assistantMessage })
      }

      // Estado: esperando cantidad
      if(pending.step === "await_qty"){
        const qtyInText = parseQuantityFromText(text)
        if(qtyInText && qtyInText > 0){
            const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } })
            if(!p){
                pendingByChat.delete(chatId)
                clearCandidates(chatId)
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: "No encuentro el producto ahora, Intentemos de nuevo." },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
            if(qtyInText > (p.stock ?? 0)){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${p.stock} de ${p.name}. ¿Ajustamos a ${p.stock}?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            // Pasamos confirmacion
            pendingByChat.set(chatId, {
                step: "await_confirm",
                productId: pending.productId,
                sku: pending.sku,
                qty: qtyInText,
            })
            const total = priceStr(p.priceCents * qtyInText)
            const confirm = `Tengo ${qtyInText} × ${p.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: confirm },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Cancelamos solo con negativa 
        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }
        if(yesRe.test(normalized)){
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "¿Cuántas unidades necesitas?" },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Mensaje guia por defecto en este estado
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content:"Solo me falta la cantidad ¿cuántas unidades quieres?" },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage })
      }

      // Estado de confirmacion
      if(pending.step === "await_confirm"){
        const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } })
        if(!p){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No encontré el producto al confirmar. Inténtalo de nuevo." },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Ajuste de qty al confirmar
        const qtyInText = parseQuantityFromText(text)
        if(qtyInText && qtyInText !== pending.qty){
            if(qtyInText > (p.stock ?? 0)){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${p.stock}. ¿Ajustamos a ${p.stock}?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messgae: assistantMessage })
            }
            pending.qty = qtyInText
            pendingByChat.set(chatId, pending)
            const total = priceStr(p.priceCents * pending.qty)
            const msg =  `Quedaría ${pending.qty} × ${p.name} por $${total}. ¿Confirmas? (sí/no)`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: msg },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(yesRe.test(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const want = Math.max(1, pending.qty)
            const dec = await db.product.updateMany({
                where: { id: p.id, chatbotId: bot.id, stock: { gte: want } },
                data: { stock: { decrement: want } },
            })
            if(dec.count !== 1){
                const fresh = await db.product.findFirst({ where: { id: p.id } })
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Ya no tengo stock suficiente. Disponible ahora: ${fresh?.stock ?? 0}.` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            const sale = await db.sale.create({
                data: {
                    chatbotId: bot.id,
                    productId: p.id,
                    qty: want,
                    status: "pending_payment",
                    paymentMethod: "cash", 
                },
            })
            await db.inventoryLedger.create({
                data: { chatbotId: bot.id, productId: p.id, delta: -want, reason: "sale", ref: sale.id },
            })

            const reply = `Listo. Aparté ${want} × ${p.name} (SKU ${p.sku}). Pedido **pendiente de pago**.`
            const [ assistantMessage ] = await Promise.all([
                db.message.create({
                    data: { chatId, role: "assistant", content: reply },
                    select: { id: true, role: true, content: true, createdAt: true },
                }),
                (!chat.title || chat.title === "Nuevo chat") && db.chat.update({ where: { id: chatId }, data: { title: `Pedido ${p.sku} × ${want}` } }),
            ])
            return NextResponse.json({ message: assistantMessage})
        }

        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const total = priceStr(p.priceCents * pending.qty)
        const guide = `¿Confirmas ${pending.qty} × ${p.name} por $${total}? (sí/no). Puedes cambiar la cantidad escribiendo “mejor 3”.`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: guide },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage })
      }
    }

    // 2) Búsqueda/venta directa por texto (SKU + cantidad en el mismo texto)
    const parsedBySku = parseOrder(text) 
    if (parsedBySku) {
      const product = await db.product.findUnique({
        where: { chatbotId_sku: { chatbotId: bot.id, sku: parsedBySku.sku } },
      }) 
      if (!product) {
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: `No encontré el SKU ${parsedBySku.sku}.` },
          select: { id: true, role: true, content: true, createdAt: true },
        }) 
        return NextResponse.json({ message: assistantMessage }) 
      }
      if (product.stock < parsedBySku.qty) {
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: `Solo tengo ${product.stock} de ${product.name}. ¿Quieres ajustar la cantidad?` },
          select: { id: true, role: true, content: true, createdAt: true },
        }) 
        return NextResponse.json({ message: assistantMessage }) 
      }
      if(product.stock <= 0){
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: `${product.name} está agotado actualmente.` },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage })
      }
      // Guarmdamos el candidato unico por si el usuarios dice que quiere mas
      setCandidates(chatId, [product.id])
      // Dejar confirmación pendiente
      pendingByChat.set(chatId, { step: "await_confirm", productId: product.id, sku: product.sku, qty: parsedBySku.qty }) 
      const total = priceStr(product.priceCents * parsedBySku.qty) 
      const confirm = `Tengo ${parsedBySku.qty} × ${product.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")` 
      const assistantMessage = await db.message.create({
        data: { chatId, role: "assistant", content: confirm },
        select: { id: true, role: true, content: true, createdAt: true },
      }) 
      return NextResponse.json({ message: assistantMessage }) 
    }

    // 2b) Inventario general
    if(intent === "ask_inventory"){
        const inStock = await db.product.findMany({
            where: { chatbotId: bot.id, stock: { gt: 0 } },
            orderBy: { updatedAt: "desc" },
            take: 8,
        })

        if(inStock.length === 0){
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Ahora mismo no tengo productos en stock. Si tienes un SKU o nombre específico, lo busco." },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Hay que recordale los candidatos
        setCandidates(chatId, inStock.map((p) => p.id ))

        const msg = `Esto es lo que tengo disponible:\n${listLines(inStock)}\n\nElige por SKU (ej: ${inStock[0].sku})`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage})
    }

    // 2c) Busqueda por palabras clabes
    const whereAND = tokens.length ? buildWhereAND(bot.id, tokens) : ({ chatbotId: bot.id } as Prisma.ProductWhereInput)

    let results = await db.product.findMany({
        where: whereAND,
        orderBy: { createdAt: "desc" },
        take: 5,
    })

    if(results.length === 0 && tokens.length){
        const whereOR = buildWhereOR(bot.id, tokens)
        results = await db.product.findMany({
            where: whereOR,
            orderBy: { createdAt: "desc" },
            take: 5,
        })
    }

    if(intent){
        if(results.length === 0){
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No encontré productos con esa descripción. ¿Tienes el SKU exacto o quieres que te muestre lo que tengo en stock?" },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(results.length === 1){
            const p = results[0]

            if(p.stock <= 0){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `${p.name} está agotado actualmente.` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messgae: assistantMessage })
            }

            // Guardamos el candidato unico para qty    
            setCandidates(chatId, [p.id])

            if(intent === "ask_price"){
                const msg = `${p.name} (SKU ${p.sku}) cuesta $${priceStr(p.priceCents)}.`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(intent === "ask_stock" || intent == "ask_availability"){
                const disp = p.stock > 0 ? `Sí, tengo ${p.stock} disponibles` : "No, está agotado"
                const msg = `${disp} de ${p.name} (SKU ${p.sku}). Precio: $${priceStr(p.priceCents)}.`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(intent === "buy"){
                pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku })
                const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr(p.priceCents)}. ¿Cuántas unidades necesitas?`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messaqe: assistantMessage })
            }
        }

        // Si hay varias coincidencias -> recordamos candidato/s
        setCandidates(chatId, results.map((p) => p.id))

        const msg = `Encontré varias opciones:\n${listLines(results)}\n\nElige por SKU (ej: ${ results[0].sku }) ${intent === "buy" ? " y dime cuántas" : "" }.`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage })
    }
    
    // 3) Fallback —> agente con tools (anti-alucinaciones)
    // Tomamos últimos 30 mensajes como contexto
    const history = await db.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
        take: 30,
    }) 

    const priorMessages = history.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
    })) 

    const { content } = await runMiniAyolinTurn({
        userMessage: text,
        priorMessages,
        ctx: { db, botId: bot.id, userId: null },
    }) 

    const reply = content?.trim() || "¿En qué te puedo ayudar?" 
    const [assistantMessage] = await Promise.all([
        db.message.create({
            data: { chatId, role: "assistant", content: reply },
            select: { id: true, role: true, content: true, createdAt: true },
        }),
        (!chat.title || chat.title === "Nuevo chat") && db.chat.update({ where: { id: chatId }, data: { title: text.slice(0, 40) } }),
    ]) 
    return NextResponse.json({ message: assistantMessage }) 

  } catch (e) {
    console.error(e) 
    return NextResponse.json({ error: "Server error" }, { status: 500 }) 
  }
}
