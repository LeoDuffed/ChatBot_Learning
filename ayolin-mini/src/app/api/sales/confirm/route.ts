/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest){
    const bot = await getOrCreateMyBot()
    const { sku, productId, qty = 1, paymentMethod = "cash", customerRef } = await req.json().catch(() => ({}))

    const want = Number(qty) || 1
    const normSku = sku ? String(sku).toUpperCase().trim() : null
    
    let product: any = null
    if(productId){
        product = await db.product.findFirst({where: {id: String(productId), chatbotId: bot.id } })
    } else if(normSku){
        product = await db.product.findUnique({
            where: { chatbotId_sku: { chatbotId: bot.id, sku: normSku }}
        })
    }

    if(!product) return NextResponse.json({ error: "Producto no encontrado"}, {status: 404 })
    if(want <= 0) return NextResponse.json({ error: "Cantidad invalida "}, { status: 400 })

    const dec = await db.product.updateMany({
        where: { id: product.id, chatbotId: bot.id, stock: { gte: want }},
        data: { stock: { decrement: want }},
    })
    if(dec.count !== 1){
        const fresh = await db.product.findFirst({ where: { id: product.id }})
        return NextResponse.json(
            {error: "Stock insuficiente", available: fresh?.stock ?? 0 },
            {status: 409 }
        )
    }

    const sale = await db.sale.create({
        data: {
            chatbotId: bot.id,
            productId: product.id,
            qty: want,
            status: "pending_payment",
            paymentMethod,
            customerRef: customerRef ?? null,
        },
    })
    await db.inventoryLedger.create({
        data: {
            chatbotId: bot.id,
            productId: product.id,
            delta: -want,
            reason: "sale",
            ref: sale.id,
        },
    })

    return NextResponse.json({
        ok: true,
        sale, 
        prompt: `Listo. Pedido "pendiente de pago": ${want} × ${product.name}. ¿Cómo deseas pagar?`,
    })
}