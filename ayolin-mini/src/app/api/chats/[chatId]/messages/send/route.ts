/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server" 
import { db } from "@/lib/db" 
import { getOrCreateMyBot } from "@/lib/bot" 
import { parseOrder } from "@/lib/orderParser" 
import { 
    extractKeywords,
    detectIntent, 
    parseQuantityFromText,
    singularizeBasic, 
    hasBrowserIntent,
} from "@/lib/textQuery" 
import { runMiniAyolinTurn } from "@/ai/agent" 
import { searchProductsText } from "@/lib/textSearch"

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

// Negativas "limpias"
function isCleanNegative(normalize: string){
    const t = normalize.trim()
    // aceptamos negativas comunes en cualquier parte de la frase
    if (/\b(no\s+gracias|no\s+quiero(\s+nada)?|no\s+lo\s+quiero|mejor\s+no|ya\s+no|olvidalo|olvídalo)\b/.test(t)) return true
    if (/^(no)[.!]?$/.test(t)) return true
    if (/\b(cancela(r)?(\s+pedido)?)\b/.test(t)) return true
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

// Helpers de seleccion por nombre
function normTokens(tokens: string[]): string[]{
    return tokens.map((t) => singularizeBasic(t).toLowerCase().trim()).filter((t) => t.length >= 2)
}

function tokensInText(allTokens: string[], s?: string | null): boolean {
    if(!s || allTokens.length === 0) return false
    const low = s.toLowerCase()
    return allTokens.every((t) => low.includes(t))
}

// Si el primer resultado es mejor 
function pickStrongTop<T extends { name: string; description?: string | null; score?: number }>(results: T[], tokens: string[]): T | null{
    if(!results.length) return null
    const top = results[0]
    const secondScore = results[1]?.score ?? 0
    const topScore = top.score ?? 0

    const nameCovers = tokensInText(tokens, top.name) || tokensInText(tokens, top.description)
    const scoreClear = topScore >= secondScore + 0.5 || (secondScore > 0 ? topScore / secondScore >= 1.3 : topScore > 0)
    
    if(nameCovers || scoreClear) return top
    return null
}

async function showInventoryAndRemember(chatId: string, botId: string ){
    const inStock = await db.product.findMany({
        where: { chatbotId: botId, stock: { gt: 0 } },
        orderBy: { updatedAt: "desc" },
        take: 8,
    })

    if(inStock.length === 0){
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: "Ahora mismo no tengo productos en stock. Si tienes un SKU o nombre específico, lo busco." },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
    }

    setCandidates(chatId, inStock.map((p) => p.id))
    const msg = `Esto es lo que tengo disponible:\n${listLines(inStock)}\n\nElige por SKU o nombre (ej: ${inStock[0].sku} o "${inStock[0].name}")`
    const assistantMessage = await db.message.create({
        data: { chatId, role: "assistant", content: msg },
        select: { id: true, role: true, content: true, createdAt: true }
    })
    return NextResponse.json({ message: assistantMessage })
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
    const qtyInText = parseQuantityFromText(text) || 0
    const normToks = normTokens(tokens)

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

                if(qtyInText > 0){
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
                return NextResponse.json({ message: assistantMessage })
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
                    return NextResponse.json({ message: assistantMessage })
                }
            }

            // Auto seleccion por nombre de recordados
            const narrowed = await searchProductsText({
                db, botId: bot.id, query: text.trim(), limit: Math.max(remembered.length, 5),
            })
            const setRec = new Set(remembered)
            const inter = narrowed.filter((r) => setRec.has(r.id))

            let chosen = inter.length === 1 ? inter[0] : null
            if(!chosen && inter.length > 1){
                const strong = pickStrongTop(inter, normToks)
                if(strong) chosen = strong
            }
            if(!chosen && inter.length > 1){
                const strict = inter.filter((p) => tokensInText(normToks, p.name) || tokensInText(normToks, p.description ?? null))
                if(strict.length === 1) chosen = strict[0]
            }
            if(chosen){
                if(wantsAllAvailable(text)){
                    const want = Math.max(1, chosen.stock)
                    if(want <= 0){
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content: `De ${chosen.name} (SKU ${chosen.sku}) no tengo stock ahora.` },
                            select: { id: true, role: true, content: true, createdAt: true },
                        })
                        return NextResponse.json({ message: assistantMessage })
                    }
                    pendingByChat.set(chatId, { step: "await_confirm", productId: chosen.id, sku: chosen.sku, qty: want })
                    const total = priceStr(chosen.priceCents * want)
                    const confirm = `Tengo ${want} × ${chosen.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: confirm },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                if(qtyInText > 0){
                    if(qtyInText > (chosen.stock ?? 0)){
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content: `Solo tengo ${chosen.stock} de ${chosen.name}. ¿Ajustamos a ${chosen.stock}?` },
                            select: { id: true, role: true, content: true, createdAt: true },
                        })
                        return NextResponse.json({ message: assistantMessage })
                    }
                    pendingByChat.set(chatId, {
                        step: "await_confirm", productId: chosen.id, sku: chosen.sku, qty: qtyInText
                    })
                    const total = priceStr(chosen.priceCents * qtyInText)
                    const confirm = `Tengo ${qtyInText} × ${chosen.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: confirm },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                if(chosen.stock <= 0 ){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: `De ${chosen.name} (SKU ${chosen.sku}) no tengo stock ahora.` },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                pendingByChat.set(chatId, { step: "await_qty", productId: chosen.id, sku: chosen.sku })
                const msg = `Perfecto, ${chosen.name} (SKU ${chosen.sku}) está a $${priceStr( chosen.priceCents )}. ¿Cuántas unidades necesitas?`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
        }
    }

    // 1) Conversación pendiente (confirmación/cantidad/stock)
    const pending = pendingByChat.get(chatId) 
    const yesRe = /(^|\b)(s[ií]|sí|si|claro|dale|va|ok|okay|confirmo|lo\s+compro)\b/i
    const stockQRe = /\b(cuantos|cuántos|cuantas|cuánta|cuánto|stock|quedan?)\b/i

    if (pending) {
      // Si el usuario cambia a "browse intent, tenemos que resetear"  
      if(hasBrowserIntent(text)){
        pendingByChat.delete(chatId)
        clearCandidates(chatId)
        return await showInventoryAndRemember(chatId, bot.id)
      }

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
        return NextResponse.json({ message: assistantMessage })
      }

      // Estado: esperando cantidad
      if(pending.step === "await_qty"){
        const qty = parseQuantityFromText(text)
        if(qty && qty > 0){
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
            if(qty > (p.stock ?? 0)){
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
                qty,
            })
            const total = priceStr(p.priceCents * qty)
            const confirm = `Tengo ${qty} × ${p.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
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
        const changedQty = parseQuantityFromText(text)
        if(changedQty && changedQty !== pending.qty){
            if(changedQty > (p.stock ?? 0)){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${p.stock}. ¿Ajustamos a ${p.stock}?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
            pending.qty = changedQty
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
                data: { chatbotId: bot.id, productId: p.id, qty: want, status: "pending_payment", paymentMethod: "cash" },
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
    const intentDetected = intent
    if(intentDetected === "ask_inventory"){
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

        const msg = `Esto es lo que tengo disponible:\n${listLines(inStock)}\n\nElige por SKU o nombre (ej: ${inStock[0].sku} o "${inStock[0].name}")`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage})
    }

    // 2c) Busqueda por palabras clabes
    const qText = text.trim()
    let results = await searchProductsText({
        db, botId: bot.id, query: qText, limit: 5
    })

    // Falback 
    if(results.length === 0 && tokens.length){
        const whereOR = {
            chatbotId: bot.id,
            OR: tokens.flatMap((tok) => {
                const s = singularizeBasic(tok)
                const set = Array.from(new Set([tok, s].filter(Boolean)))
                return set.flatMap((w) => [
                    { name: { contains: w, mode: "insensitive" as const } },
                    { sku: { contains: w.toUpperCase() } },
                    { description: { contains: w, mode: "insensitive" as const } },
                ])
            })
        } as any
    
        const fallback = await db.product.findMany({
            where: whereOR,
            orderBy: { updatedAt: "desc" },
            take: 5,
        })

        results = fallback.map((p) => ({
            id: String(p.id),
            sku: p.sku,
            name: p.name,
            description: p.description ?? null,
            priceCents: p.priceCents,
            stock: p.stock ?? 0,
            score: undefined,
        }))
    }

    if(intentDetected === "buy" && results.length > 0){
        const strong = pickStrongTop(results, normToks)
        if(strong && qtyInText > 0){
            if(qtyInText > (strong.stock ?? 0)){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${strong.stock} de ${strong.name}. ¿Ajustamos a ${strong.stock}?`  },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
            setCandidates(chatId, [strong.id])
            // Directo a confirmacion
            pendingByChat.set(chatId, { step: "await_confirm", productId: strong.id, sku: strong.sku, qty: qtyInText })
            const total = priceStr(strong.priceCents * qtyInText )
            const confirm = `Tengo ${qtyInText} × ${strong.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
            const assistantMessage = await db.message.create({ 
                data: { chatId, role: "assistant", content: confirm },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }
    }

    if(intentDetected){
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
                return NextResponse.json({ message: assistantMessage })
            }

            setCandidates(chatId, [p.id])

            if(intentDetected === "ask_price"){
                const msg = `${p.name} (SKU ${p.sku}) cuesta $${priceStr( p.priceCents )}.`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: {id: true, role: true, content: true, createdAt: true }
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(intentDetected === "ask_stock" || intentDetected === "ask_availability"){
                const disp = p.stock > 0 ? `Sí, tengo ${p.stock} disponibles` : "No, está agotado"
                const msg = `${disp} de ${p.name} (SKU ${p.sku}). Precio: $${priceStr( p.priceCents )}.`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(intentDetected === "buy"){
                pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku })
                const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr( p.priceCents )}. ¿Cuántas unidades necesitas?`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
        }

        setCandidates( chatId, results.map((p) => p.id))
        const nice = results.map((p) => `• ${p.sku} — ${p.name} — $${priceStr(p.priceCents)} — stock ${ p.stock }`).join("\n")
        const msg = `Encontré varias opciones:\n${nice}\n\nElige por **SKU o nombre exacto** (ej: ${ results[0].sku } o "${results[0].name}")${ intentDetected === "buy" ? " y dime cuántas" : "" }.`
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
