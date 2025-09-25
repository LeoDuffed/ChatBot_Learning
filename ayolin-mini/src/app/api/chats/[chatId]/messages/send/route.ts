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
