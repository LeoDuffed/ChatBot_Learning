/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest){
    try{
        const bot = await getOrCreateMyBot()

        const body = await req.json().catch(() => ({}))
        const { 
            sku,
            productId,
            qty = 1,
            paymentMethod = "cash",
            chatId,
            notes,
        } = body as {
            sku?: string
            productId?: string
            qty?: number
            paymentMethod?: string
            chatId?: string
            notes?: string
        }

        // Validaciones basicas
        const want = Number(qty) || 1
        if(!chatId){
            return NextResponse.json({ error: "ChatId es requerido" }, { status: 400 })
        }
        if(want <= 0){
            return NextResponse.json({ error: "Cantidad inválida"}, { status: 400 })
        }

        const normSku = sku ? String(sku).toUpperCase().trim() : null

        let product: any = null
        if(productId){
            product = await db.product.findFirst({
                where: { id: String(productId), chatbotId: bot.id }, 
            })
        } else if(normSku){
            product = await db.product.findUnique({
                where: { chatbotId_sku: { chatbotId: bot.id, sku: normSku } },
            })
        }

        if(!product){
            return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 })
        }

        // Total
        const totalCents = product.priceCents * want

        // Reservar stock, creamos venta + item
        const result = await db.$transaction(async (tx) => {
            // Diminuimos el stock de forma condicional
            const dec = await tx.product.updateMany({
                where: { id: product.id, chatbotId: bot.id, stock: { gte: want } },
                data: { stock: { decrement: want } },
            })
            if(dec.count !== 1){
                const fresh = await tx.product.findFirst({ where: { id: product.id } })
                throw NextResponse.json(
                    { error: "Stock insuficiente", available: fresh?.stock ?? 0 },
                    { status: 409 }
                )
            }

            // Crear la vneta con item anidado
            const sale = await tx.sale.create({
                data: {
                    chatbotId: bot.id,
                    chatId,
                    status: "pending_payment",
                    totalCents,
                    paymentMethod,
                    notes: notes ?? null,
                    items: {
                        create: [
                            {
                                productId: product.id,
                                sku: product.sku,
                                nameSnapshot: product.name,
                                priceCentsSnapshot: product.priceCents,
                                qty: want,
                            },
                        ],
                    },
                },
                include: { items: true },
            })

            // Asentar en inventory ledger
            await tx.inventoryLedger.create({
                data: {
                    chatbotId: bot.id,
                    productId: product.id,
                    delta: -want,
                    reason: "sale",
                    ref: sale.id
                },
            })
            return sale
        }).catch((err) => {
            if(err instanceof NextResponse) return err
            throw err
        })

        if(result instanceof NextResponse) return result

        return NextResponse.json({
            ok: true, 
            sale: result,
            prompt: `Listo. Pedido "pendiente de pago": ${want} × ${product.name}. ¿Cómo deseas pagar?`,
        })
    } catch (error) {
        console.error("POST /api/sales/confirm error", error);
        return NextResponse.json({ error: "Error en el servidor" }, { status: 500 });
    }
}
