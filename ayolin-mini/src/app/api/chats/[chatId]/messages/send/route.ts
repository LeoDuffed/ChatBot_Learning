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
    fuzzyPick,
} from "@/lib/textQuery" 
import { runMiniAyolinTurn } from "@/ai/agent" 
import { searchProductsText } from "@/lib/textSearch"

type Pending = 
    | { step: "await_qty"; productId: string; sku: string; suggestedQty?: number }
    | { step: "await_confirm"; productId: string; sku: string; qty: number; suggestedQty?: number }
    | { step: "await_name"; productId: string; sku: string; qty: number }
    | { step: "await_payment"; productId: string; sku: string; qty: number; customerName: string }
    | { step: "await_shipping"; productId: string; sku: string; qty: number; customerName: string; paymentMethod: string }
    | { step: "await_shipping_details"; productId: string; sku: string; qty: number; customerName: string; paymentMethod: string; shippingMethod: string }
    | { step: "await_final_confirm"; productId: string; sku: string; qty: number; customerName: string; paymentMethod: string; shippingMethod: string; shippingDetails?: any }
    | { step: "chg_shipping"; saleId: string }
    | { step: "chg_shipping_details"; saleId: string; shippingMethod: string }
    | { step: "chg_final_confirm"; saleId: string; shippingMethod: string; shippingDetails?: any }

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

function methodFromText(text: string): "domicilio" | "punto_medio" | "recoleccion" | null{
    const t = text.toLowerCase()
    if (/\b(domicilio|a\s+domicilio)\b/.test(t)) return "domicilio"
    if (/\b(punto\s+medio|punto)\b/.test(t)) return "punto_medio"
    if (/\b(recolecci[oó]n|recoger|pickup|pick\s*up|recoleccion)\b/.test(t)) return "recoleccion"
    return null
}

function wantsToChangeShipping(text: string): boolean{
    const t = text.toLowerCase().trim()
    if (/\b(cambiar|cambio|modificar|editar|ajustar|otro|distinto|diferente)\b/.test(t) &&
      /\b(env[ií]o|envio|entrega|punto|direcci[oó]n|recolecci[oó]n|domicilio)\b/.test(t)) {
    return true
    }
    // o que directamente mencione un método conocido (cuando ya hay una venta abierta)
    return methodFromText(t) !== null
}

function formatShippingOptions(shipping: string[], cfg: any): string{
    const parts: string[] = []
    if(shipping.includes("domicilio")) parts.push("• Envío a domicilio")
    if(shipping.includes("punto_medio")){
        const zones = Array.isArray(cfg?.meetupAreas) && cfg.meetupAreas.length ? ` (zonas sugeridas: ${cfg.meetupAreas.join(", ")})` : ""
        parts.push(`• Punto medio${zones}`)
    }
    if(shipping.includes("recoleccion")){
        const addr = cfg?.pickupAddress ? ` en ${cfg.pickupAddress}` : ""
        const hours = cfg?.pickupHours ? ` (${cfg.pickupHours})` : ""
        parts.push(`• Recolección${addr}${hours}`)
    }
    return parts.join("\n")
}

type ShippingKind = "domicilio" | "punto_medio" | "recoleccion"

function normalizeShippingString(value?: string | null): string{
    if(!value) return ""
    return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
}

function detectShippingKind(value?: string | null): ShippingKind | null{
    if(!value) return null
    return methodFromText(value) ?? methodFromText(value.replace(/[_-]+/g, " "))
}

function resolveShippingOption(options: string[], candidate?: string | null): string | null{
    if(!candidate) return null
    for(const option of options){
        if(!option) continue
        if(option === candidate) return option
        const optionNorm = normalizeShippingString(option)
        const candidateNorm = normalizeShippingString(candidate)
        if(optionNorm && optionNorm === candidateNorm) return option
        const optionKind = detectShippingKind(option)
        const candidateKind = detectShippingKind(candidate)
        if(optionKind && optionKind === candidateKind) return option
    }
    return null
}

function canonicalizeShipping(raw?: string | null): { method: string; kind: ShippingKind | null }{
    if(!raw) return { method: "", kind: null }
    const kind = detectShippingKind(raw)
    if(kind) return { method: kind, kind }
    const normalized = normalizeShippingString(raw)
    return { method: normalized.slice(0, 60), kind: null }
}

function humanizeShippingMethod(method?: string | null): string{
    const kind = detectShippingKind(method)
    if(kind === "domicilio") return "Envío a domicilio"
    if(kind === "punto_medio") return "Punto medio"
    if(kind === "recoleccion") return "Recolección"
    if(!method) return "Entrega"
    const cleaned = method.replace(/[_-]+/g, " ").trim()
    if(!cleaned) return "Entrega"
    return cleaned
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

function shippingDetailLabel(kind: ShippingKind | null): string{
    if(kind === "domicilio") return "Dirección"
    if(kind === "punto_medio") return "Punto"
    return "Detalle"
}

function pickupHint(cfg: any): string{
    const addr = cfg?.pickupAddress ? ` en ${cfg.pickupAddress}` : ""
    const hours = cfg?.pickupHours ? ` (${cfg.pickupHours})` : ""
    return addr || hours ? `\nRetiro${addr}${hours}.` : ""
}

export const runtime = "nodejs" 
export const dynamic = "force-dynamic" 

export async function POST(req: NextRequest, context: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await context.params 
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

    // Utilidades de configuracion checkout
    async function getCheckoutSettings(){
        const fresh = await db.chatbot.findFirst({ where: { id: bot.id } })
        return{
            payments: (fresh?.paymentMethods as string[]) ?? [],
            shipping: (fresh?.shippingMethods as string[]) ?? [],
            cfg: (fresh?.shippingConfig as any) ?? null
        }
    }

    async function sayPaymentMethods(){
        const { payments } = await getCheckoutSettings()
        const msg = payments.length ? `Métodos de pago disponibles: ${payments.join(", ")}.` : "Por ahora no tengo métodos de pago configurados."
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
    }

    async function sayShippingMethods(){
        const { shipping, cfg } = await getCheckoutSettings()
        if(shipping.length === 0){
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Por ahora no tengo métodos de envío/entrega configurados." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }
        const partsMsg = formatShippingOptions(shipping, cfg)
        const msg = `Opciones de envío/entrega:\n${partsMsg}`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
    }

    const openSale = await db.sale.findFirst({
        where: { chatbotId: bot.id, customerRef: chatId, status: "pending_payment" },
        orderBy: { createdAt: "desc" },
        include: { product: true },
    })

    // Si el usuario pide cambiar entrega y hay venta abierta, iniciams el cambio
    if(!pendingByChat.get(chatId) && openSale && wantsToChangeShipping(text)){
        const { shipping, cfg } = await getCheckoutSettings()
        if(!shipping.length){
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No tengo métodos de envío/entrega configurados para cambiar." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Intento de selección directa de método
        const fuzzyMatch = fuzzyPick(shipping, text)
        const resolvedFromIntent = methodFromText(text)
        const matchedOption = fuzzyMatch ?? resolveShippingOption(shipping, resolvedFromIntent)

        if(matchedOption){
            const { method: canonicalMethod, kind } = canonicalizeShipping(matchedOption)

            if(kind === "recoleccion"){
                // Confirmación directa (no necesita detalles)
                pendingByChat.set(chatId, { step: "chg_final_confirm", saleId: openSale.id, shippingMethod: canonicalMethod })
                const hint = pickupHint(cfg)
                const guide = `Perfecto, cambiamos a **${humanizeShippingMethod(canonicalMethod)}**.${hint}\n¿Confirmas el cambio? (sí/no)`
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: guide },
                    select: { id: true, role: true, content: true, createdAt: true }
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(kind === "domicilio" || kind === "punto_medio"){
                // Pedimos detalles específicos del método
                pendingByChat.set(chatId, { step: "chg_shipping_details", saleId: openSale.id, shippingMethod: canonicalMethod })
                let ask = "Compárteme la dirección de entrega y una referencia."
                if(kind === "punto_medio"){
                    const zones = Array.isArray(cfg?.meetupAreas) && cfg.meetupAreas.length ? `\nZonas sugeridas: ${cfg.meetupAreas.join(", ")}` : ""
                    ask = `¿En qué punto medio nos vemos?${zones ? `${zones}\n` : " "}Puedes elegir una de las zonas sugeridas o proponer otra.`
                }
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: ask.trim() },
                    select: { id: true, role: true, content: true, createdAt: true }
                })
                return NextResponse.json({ message: assistantMessage })
            }

            // Métodos no catalogados: pedimos detalle genérico
            pendingByChat.set(chatId, { step: "chg_shipping_details", saleId: openSale.id, shippingMethod: canonicalMethod })
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Compárteme los detalles para la entrega (dirección, referencias, etc.)." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Si no especifico metodo -> mostramos las opciones 
        pendingByChat.set(chatId, { step: "chg_shipping", saleId: openSale.id })
        const partsMsg = formatShippingOptions(shipping, cfg)
        const msg = `¿Cómo deseas cambiar la entrega?\n${partsMsg}`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
    }

    // Intents pago/entrega 
    const asksPayment = intent === "ask_payment_methods"
    const asksShipping = intent === "ask_shipping_methods"

    if(asksPayment || asksShipping){
        if(asksPayment && asksShipping){
            const { payments, shipping, cfg } = await getCheckoutSettings()
            const payMsg = payments.length ? `Métodos de pago disponibles: ${payments.join(", ")}.` : "Por ahora no tengo métodos de pago configurados."
            const shipMsg = shipping.length ? `Opciones de envío/entrega:\n${formatShippingOptions(shipping, cfg)}` : "Por ahora no tengo métodos de envío/entrega configurados."
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: `${payMsg}\n\n${shipMsg}` },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }
        if(asksPayment) return await sayPaymentMethods()
        if(asksShipping) return await sayShippingMethods()
    }

    // Si hay candidatos recordados y No hay pending -> intentamos una selccion natural
    const remembered = getCandidates(chatId)
    if(remembered && remembered.length > 0 && !pendingByChat.get(chatId)){
        if(remembered.length === 1){
            const p = await db.product.findFirst({ where: { id: remembered[0], chatbotId: bot.id } })
            if(p){
                if(wantsAllAvailable(text)){
                    const want = p.stock ?? 0
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
                        const available = p.stock ?? 0
                        if(available <= 0){
                            const assistantMessage = await db.message.create({
                                data: { chatId, role: "assistant", content: `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.` },
                                select: { id: true, role: true, content: true, createdAt: true },
                            })
                            return NextResponse.json({ message: assistantMessage })
                        }
                        pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku, suggestedQty: available })
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content: `Solo tengo ${available} de ${p.name}. ¿Ajustamos a ${available}?` },
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
                    const want = chosen.stock ?? 0
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
                        const available = chosen.stock ?? 0
                        if(available <= 0){
                            const assistantMessage = await db.message.create({
                                data: { chatId, role: "assistant", content: `De ${chosen.name} (SKU ${chosen.sku}) no tengo stock ahora.` },
                                select: { id: true, role: true, content: true, createdAt: true },
                            })
                            return NextResponse.json({ message: assistantMessage })
                        }
                        pendingByChat.set(chatId, { step: "await_qty", productId: chosen.id, sku: chosen.sku, suggestedQty: available })
                        const assistantMessage = await db.message.create({
                            data: { chatId, role: "assistant", content: `Solo tengo ${available} de ${chosen.name}. ¿Ajustamos a ${available}?` },
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

      if(pending.step === "chg_shipping"){
        const sale = await db.sale.findFirst({ where: { id: pending.saleId, chatbotId: bot.id, status: "pending_payment" } })
        if(!sale){
            pendingByChat.delete(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No encontré tu pedido abierto para cambiar la entrega." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const { shipping, cfg } = await getCheckoutSettings()
        if(!shipping.length){
            pendingByChat.delete(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No tengo métodos de envío/entrega configurados para cambiar." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const fuzzyMatch = fuzzyPick(shipping, text)
        const resolvedFromIntent = methodFromText(text)
        const matchedOption = fuzzyMatch ?? resolveShippingOption(shipping, resolvedFromIntent)

        if(!matchedOption){
            const partsMsg = formatShippingOptions(shipping, cfg)
            const msg =  `No entendí la opción. ¿Cuál eliges?\n${partsMsg}`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: msg },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const { method: canonicalMethod, kind } = canonicalizeShipping(matchedOption)

        if(kind === "recoleccion"){
            pendingByChat.set(chatId, { step: "chg_final_confirm", saleId: sale.id, shippingMethod: canonicalMethod })
            const guide = `Perfecto, cambiamos a **${humanizeShippingMethod(canonicalMethod)}**.${pickupHint(cfg)}\n¿Confirmas el cambio? (sí/no)`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: guide },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        pendingByChat.set(chatId, { step: "chg_shipping_details", saleId: sale.id, shippingMethod: canonicalMethod })
        let ask = "Compárteme la dirección de entrega y una referencia."
        if(kind === "punto_medio"){
            const zones = Array.isArray(cfg?.meetupAreas) && cfg.meetupAreas.length ? `\nZonas sugeridas: ${cfg.meetupAreas.join(", ")}` : ""
            ask = `¿En qué punto medio nos vemos?${zones ? `${zones}\n` : " "}Puedes elegir una de las zonas sugeridas o proponer otra.`
        } else if(kind === null){
            ask = "Compárteme los detalles para la entrega (dirección, referencias, etc.)."
        }
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: ask.trim() },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
      }

      if(pending.step === "chg_shipping_details"){
        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Entendido, no realizo el cambio de entrega." },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }
        const detailsText = text.trim().slice(0, 300)
        const methodKind = detectShippingKind(pending.shippingMethod)
        const shippingDetails = methodKind === "domicilio" ? { address: detailsText } : { meetupPlace: detailsText }
        pendingByChat.set(chatId, { step: "chg_final_confirm", saleId: pending.saleId, shippingMethod: pending.shippingMethod, shippingDetails })

        const guide = `¿Confirmas cambiar la entrega a **${humanizeShippingMethod(pending.shippingMethod)}**?\n${shippingDetailLabel(methodKind)}: ${detailsText}\n(responde sí/no)`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: guide },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
      }

      if(pending.step === "chg_final_confirm"){
        const sale = await db.sale.findFirst({
            where: { id: pending.saleId, chatbotId: bot.id, status: "pending_payment" },
            include: { product: true },
        })
        if(!sale){
            pendingByChat.delete(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "No encontré tu pedido abierto para aplicar el cambio." },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(yesRe.test(normalized)){
            await db.sale.update({
                where: { id: sale.id }, 
                data: { shippingMethod: pending.shippingMethod, shippingDetails: pending.shippingDetails ?? null },
                include: { product: true }
            })

            const { cfg } = await getCheckoutSettings()
            const contactLine = cfg?.sellerContact ? `\nContacto del vendedor: ${cfg.sellerContact}` : ""
            const methodKind = detectShippingKind(pending.shippingMethod)
            const detailValue = pending.shippingDetails?.address ?? pending.shippingDetails?.meetupPlace ?? ""
            const detailLine = methodKind === "recoleccion"
                ? pickupHint(cfg)
                : detailValue
                ? `\n${shippingDetailLabel(methodKind)}: ${detailValue}`
                : ""

            pendingByChat.delete(chatId)
            const reply = `Listo. Actualicé tu pedido a **${humanizeShippingMethod(pending.shippingMethod)}**.${detailLine}${contactLine}`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: reply },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Entendido, no cambio la entrega." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const msg = "¿Confirmas el cambio de entrega? (sí/no)"
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
      }

      // Preguntar de stock en cualquier estado 
      if(stockQRe.test(text)){
        const p = await db.product.findFirst({ where: { id: (pending as any).productId, chatbotId: bot.id } })
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

        const available = p.stock ?? 0
        const qty = parseQuantityFromText(text)
        if(qty && qty > 0){
            if(qty > available){
                if(available <= 0){
                    pendingByChat.delete(chatId)
                    clearCandidates(chatId)
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.` },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                pendingByChat.set(chatId, { step: "await_qty", productId: pending.productId, sku: pending.sku, suggestedQty: available })
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${available} de ${p.name}. ¿Ajustamos a ${available}?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

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

        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(pending.suggestedQty && yesRe.test(normalized)){
            const acceptQty = pending.suggestedQty
            if(acceptQty <= 0 || acceptQty > available){
                pendingByChat.delete(chatId)
                clearCandidates(chatId)
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Ya no tengo stock suficiente de ${p.name}.` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            pendingByChat.set(chatId, {
                step: "await_confirm",
                productId: pending.productId,
                sku: pending.sku,
                qty: acceptQty,
            })
            const total = priceStr(p.priceCents * acceptQty)
            const confirm = `Quedarían ${acceptQty} × ${p.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: confirm },
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

        const prompt = pending.suggestedQty && pending.suggestedQty > 0
            ? `Solo me falta la cantidad. ¿Te parece bien ajustar a ${pending.suggestedQty} unidades o prefieres otra cantidad?`
            : "Solo me falta la cantidad ¿cuántas unidades quieres?"
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: prompt },
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
            const available = p.stock ?? 0
            if(changedQty > available){
                if(available <= 0){
                    pendingByChat.delete(chatId)
                    clearCandidates(chatId)
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.` },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                pendingByChat.set(chatId, {
                    step: "await_confirm",
                    productId: pending.productId,
                    sku: pending.sku,
                    qty: pending.qty,
                    suggestedQty: available,
                })
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${available}. ¿Ajustamos a ${available}?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
            pending.qty = changedQty
            delete pending.suggestedQty
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
            const acceptedQty = pending.suggestedQty && pending.suggestedQty > 0 ? pending.suggestedQty : pending.qty
            if(acceptedQty > (p.stock ?? 0)){
                pendingByChat.delete(chatId)
                clearCandidates(chatId)
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Ya no tengo stock suficiente de ${p.name}. Disponible ahora: ${p.stock ?? 0}.` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            // Pasamos a checkout: nombre
            pendingByChat.set(chatId, {
                step: "await_name",
                productId: pending.productId,
                sku: pending.sku,
                qty: acceptedQty,
            })
            const guide = "Perfecto. Para continuar, ¿a nombre de quién registro el pedido? (Ej: “Me llamo Ana Pérez”)."
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: guide },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const qtyForPrompt = pending.suggestedQty && pending.suggestedQty > 0 ? pending.suggestedQty : pending.qty
        const total = priceStr(p.priceCents * qtyForPrompt)
        const guide = pending.suggestedQty && pending.suggestedQty > 0
            ? `Solo puedo apartar ${pending.suggestedQty} × ${p.name} por $${total}. ¿Te parece bien? (sí/no). Puedes escribir otra cantidad si prefieres.`
            : `¿Confirmas ${pending.qty} × ${p.name} por $${total}? (sí/no). Puedes cambiar la cantidad escribiendo “mejor 3”.`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: guide },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage })
      }

      if(pending.step === "await_name"){
        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Perfecto, cancelamos. ¿Buscamos otra cosa?" },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const name = text.trim().replace(/^(me\s+llamo|soy|mi\s+nombre\s+es)\s*/i, "").slice(0, 80) || "Client"
        const { payments } = await getCheckoutSettings()
        const list = payments.length ? payments.join(", ") : "-"

        pendingByChat.set(chatId, {
            step: "await_payment",
            productId: pending.productId,
            sku: pending.sku, 
            qty: pending.qty,
            customerName: name,
        })
        const msg = payments.length ? `Gracias, ${name}. ¿Cómo deseas pagar? Métodos disponibles: ${list}.` : `Gracias, ${name}. ¿Cómo deseas pagar? (Por ahora no tengo métodos configurados, puedes escribir tu método preferido)`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
      }

      // await_payment
      if(pending.step === "await_payment"){
        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Entendido, no continúo con el pedido." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }
        
        const { payments, shipping, cfg } = await getCheckoutSettings()
        const trimmedPayment = text.trim()
        const pick = payments.length ? fuzzyPick(payments, trimmedPayment) : null
        const fallbackPayment = trimmedPayment || ""
        const paymentMethod = (pick ?? fallbackPayment).slice(0, 60)

        pendingByChat.set(chatId, {
            step: "await_shipping",
            productId: pending.productId,
            sku: pending.sku, 
            qty: pending.qty,
            customerName: pending.customerName,
            paymentMethod,
        })

        const methodLabelForMsg = paymentMethod || "(sin especificar)"
        const msg = shipping.length
            ? `Recibido: pago por ${methodLabelForMsg}. ¿Cómo deseas la entrega?\n${formatShippingOptions(shipping, cfg)}`
            : `Recibido: pago por ${methodLabelForMsg}. ¿Cómo deseas la entrega? (No tengo métodos configurados, escribe tu preferencia).`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: msg },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
      }

      if(pending.step === "await_shipping"){
        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Listo, cancelamos el pedido." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const { shipping, cfg } = await getCheckoutSettings()
        const trimmedInput = text.trim()
        const fuzzyMatch = shipping.length ? fuzzyPick(shipping, trimmedInput) : null
        const resolvedFromIntent = methodFromText(trimmedInput)
        const matchedOption = shipping.length ? (fuzzyMatch ?? resolveShippingOption(shipping, resolvedFromIntent)) : null

        if(shipping.length && !matchedOption){
            const partsMsg = formatShippingOptions(shipping, cfg)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: `No entendí la opción. Estas son las alternativas:\n${partsMsg}` },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const rawChoice = matchedOption ?? trimmedInput
        if(!rawChoice){
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Necesito que me indiques cómo deseas la entrega (domicilio, punto medio, recolección, etc.)." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const { method: shippingMethod, kind } = canonicalizeShipping(rawChoice)
        const needsDetails = kind === "domicilio" || kind === "punto_medio"
        const methodLabel = humanizeShippingMethod(shippingMethod)

        if(!needsDetails && kind === "recoleccion"){
            pendingByChat.set(chatId, {
                step: "await_final_confirm",
                productId: pending.productId,
                sku: pending.sku,
                qty: pending.qty,
                customerName: pending.customerName,
                paymentMethod: pending.paymentMethod,
                shippingMethod,
            })
            const guide = `Perfecto: ${methodLabel}.${pickupHint(cfg)}\n¿Confirmas tu pedido? (sí/no)`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: guide },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        pendingByChat.set(chatId, {
            step: "await_shipping_details",
            productId: pending.productId,
            sku: pending.sku,
            qty: pending.qty,
            customerName: pending.customerName,
            paymentMethod: pending.paymentMethod,
            shippingMethod,
        })

        let ask = "Compárteme los detalles para la entrega (dirección, referencias, etc.)."
        if(kind === "domicilio") ask = "Compárteme la dirección de entrega y una referencia."
        if(kind === "punto_medio"){
            const zones = Array.isArray(cfg?.meetupAreas) && cfg.meetupAreas.length ? `\nZonas sugeridas: ${cfg.meetupAreas.join(", ")}` : ""
            ask = `¿En qué punto medio nos vemos?${zones ? `${zones}\n` : " "}Puedes elegir una zona sugerida o proponer otra.`
        }
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: ask.trim() },
            select: { id: true, role: true, content: true, createdAt: true },
        })
        return NextResponse.json({ message: assistantMessage })
      }

      if(pending.step === "await_shipping_details"){
        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content:  "Entendido, lo dejamos hasta aquí." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }
        const detailsText = text.trim().slice(0, 300)
        const methodKind = detectShippingKind(pending.shippingMethod)
        const shippingDetails = methodKind === "domicilio" ? { address: detailsText } : { meetupPlace: detailsText }

        pendingByChat.set(chatId, {
            step: "await_final_confirm",
            productId: pending.productId,
            sku: pending.sku,
            qty: pending.qty,
            customerName: pending.customerName,
            paymentMethod: pending.paymentMethod,
            shippingMethod: pending.shippingMethod,
            shippingDetails,
        })

        const summaryLines = [
            "Gracias. ¿Confirmas tu pedido? (sí/no)",
            `Nombre: ${pending.customerName}`,
            `Pago: ${pending.paymentMethod}`,
            `Entrega: ${humanizeShippingMethod(pending.shippingMethod)}`,
            `${shippingDetailLabel(methodKind)}: ${detailsText}`,
        ]
        const guide = summaryLines.join("\n")
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: guide },
            select: { id: true, role: true, content: true, createdAt: true }
        })
        return NextResponse.json({ message: assistantMessage })
      }

      // Await Respuesta final (confirm)
      if(pending.step === "await_final_confirm"){
        const p = await db.product.findFirst({
            where: { id: pending.productId, chatbotId: bot.id },
        })
        if(!p){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Perdí referencia del producto. Intentemos de nuevo." },
                select: { id: true, role: true, content: true, createdAt: true }
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(yesRe.test(normalized)){
            // Intentamos decrementar stock y creamos una venta
            const want = pending.qty
            if(want <= 0){
                pendingByChat.delete(chatId)
                clearCandidates(chatId)
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: "La cantidad no es válida, intentemos de nuevo." },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
            const dec = await db.product.updateMany({
                where: { id: p.id, chatbotId: bot.id, stock: { gte: want } },
                data: { stock: {decrement: want } }
            })
            if(dec.count !== 1){
                const fresh = await db.product.findFirst({ where: { id: p.id } })
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Ya no tengo stock suficiente. Disponible ahora: ${ fresh?.stock ?? 0 }.` },
                    select: { id: true, role: true, content: true, createdAt: true }
                })
                return NextResponse.json({ message: assistantMessage })
            }
            
            const totalCents = p.priceCents * want
            const sale = await db.sale.create({
                data: {
                    chatbotId: bot.id,
                    productId: p.id,
                    qty: want,
                    status: "pending_payment",
                    paymentMethod: pending.paymentMethod,
                    customerRef: chatId, 
                    customerName: pending.customerName,
                    shippingMethod: pending.shippingMethod,
                    shippingDetails: pending.shippingDetails ?? null,
                    totalCents,
                }
            })
            await db.inventoryLedger.create({
                data:{
                    chatbotId: bot.id,
                    productId: p.id,
                    delta: -want,
                    reason: "sale",
                    ref: sale.id,
                }
            })

            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const { cfg } = await getCheckoutSettings()
            const methodKind = detectShippingKind(pending.shippingMethod)
            const methodLabel = humanizeShippingMethod(pending.shippingMethod)
            const detailValue = pending.shippingDetails?.address ?? pending.shippingDetails?.meetupPlace ?? ""
            const summaryLines: string[] = [
                `Listo, ${pending.customerName}. Aparté ${want} × ${p.name} (SKU ${p.sku}).`,
                `Pago: ${pending.paymentMethod}.`,
                `Entrega: ${methodLabel}.`
            ]
            if(methodKind === "recoleccion"){
                const pickupLine = pickupHint(cfg).trim()
                if(pickupLine) summaryLines.push(pickupLine)
            }
            if(detailValue){
                summaryLines.push(`${shippingDetailLabel(methodKind)}: ${detailValue}.`)
            }
            summaryLines.push("Pedido **pendiente de pago**.")
            const reply = summaryLines.join("\n")
            const [assistantMessage] = await Promise.all([
                db.message.create({
                    data: { chatId, role: "assistant", content: reply },
                    select: { id: true, role: true, content: true, createdAt: true }
                }),
                (!chat.title || chat.title === "Nuevo chat") && db.chat.update({
                    where: { id: chatId },
                    data: { title: `Pedido ${p.sku} × ${want}` },
                }),
            ])
            return NextResponse.json({ message: assistantMessage })
        }

        if(isCleanNegative(normalized)){
            pendingByChat.delete(chatId)
            clearCandidates(chatId)
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: "Listo, no confirmo el pedido. ¿Buscamos otra cosa?" },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        const total = priceStr(p.priceCents * pending.qty)
        const methodKind = detectShippingKind(pending.shippingMethod)
        const methodLabel = humanizeShippingMethod(pending.shippingMethod)
        const detailValue = pending.shippingDetails?.address ?? pending.shippingDetails?.meetupPlace ?? ""
        const detailLine = detailValue ? `\n${shippingDetailLabel(methodKind)}: ${detailValue}` : ""
        const guide = `¿Confirmas ${pending.qty} × ${p.name} por $${total}? (sí/no). Puedes cambiar la cantidad escribiendo “mejor 3”.\nEntrega: ${methodLabel}${detailLine}`
        const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: guide },
            select: { id: true, role: true, content: true, createdAt: true }
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
        const available = product.stock ?? 0
        if(available <= 0){
          const assistantMessage = await db.message.create({
            data: { chatId, role: "assistant", content: `${product.name} está agotado actualmente.` },
            select: { id: true, role: true, content: true, createdAt: true },
          }) 
          return NextResponse.json({ message: assistantMessage }) 
        }
        setCandidates(chatId, [product.id])
        pendingByChat.set(chatId, { step: "await_qty", productId: product.id, sku: product.sku, suggestedQty: available })
        const assistantMessage = await db.message.create({
          data: { chatId, role: "assistant", content: `Solo tengo ${available} de ${product.name}. ¿Ajustamos a ${available}?` },
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
      // Guardamos el candidato único por si el usuario dice que quiere más
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
                const available = strong.stock ?? 0
                if(available <= 0){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: `${strong.name} está agotado actualmente.` },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                pendingByChat.set(chatId, { step: "await_qty", productId: strong.id, sku: strong.sku, suggestedQty: available })
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${available} de ${strong.name}. ¿Ajustamos a ${available}?`  },
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
