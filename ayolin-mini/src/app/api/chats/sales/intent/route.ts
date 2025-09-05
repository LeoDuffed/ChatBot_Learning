import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req:NextRequest) {
    const bot = await getOrCreateMyBot()
    const { sku, qty = 1 } = await req.json().catch(() => ({}) )
    const want = Number(qty) || 1
    const normSku = String(sku ?? "").toUpperCase().trim()

    if(!normSku || want <= 0){
        return NextResponse.json({ error: "datos invalidos"}, { status: 400})
    }

    const product = await db.product.findUnique({
        where: { chatbotId_sku: { chatbotId: bot.id, sku: normSku } },
    })
    if(!product) return NextResponse.json({ error: "Producto no encontrado"}, {status: 404})
    
    if(product.stock < want){
        return NextResponse.json({
            ok: false,
            notEnough: true,
            available: product.stock,
            prompt: `Solo tengo ${product.stock} de ${product.name}. ¿Quieres ajustar la cantidad?`,
        })
    }

    const totalCents = product.priceCents * want
    return NextResponse.json({
        ok: true,
        confirm: {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            uniPriceCents: product.priceCents,
            qty: want,
            totalCents,
        },
        prompt: `Tengo ${want} × ${product.name} por $${(totalCents/100).toFixed(2)} en total. ¿Confirmas la compra?`,
    })
}