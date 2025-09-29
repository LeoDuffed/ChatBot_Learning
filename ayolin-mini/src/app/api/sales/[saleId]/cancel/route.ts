import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";
import { verifySalesPassword } from "@/lib/salesPassword";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ saleId: string }> }

export async function POST(req: NextRequest, context: RouteContext){
    try {
        const bot = await getOrCreateMyBot()

        const body = (await req.json().catch(() => null)) as { password?: string } | null
        const password = body?.password ?? ""
        if(!(await verifySalesPassword(password, bot.salesPassHash))){
            return NextResponse.json({ error: "Contraseña inválida"}, { status: 403})
        }

        const { saleId } = await context.params
        const sale = await db.sale.findFirst({
            where: { id: saleId, chatbotId: bot.id },
            include: { items: true },
        })
        if(!sale) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
        if(sale.status !== "pending_payment" ){
            return NextResponse.json({ error: "Solo se puede cancelar 'pending_payment'"}, {status: 409})
        }

        await db.$transaction(async (tx) => {
            for (const item of sale.items){
                if(!item.productId) continue
                const updated = await tx.product.updateMany({
                    where: { id: item.productId, chatbotId: bot.id },
                    data: { stock: { increment: item.qty }},
                })
                if(updated.count === 1){
                    await tx.inventoryLedger.create({
                        data: {
                            chatbotId: bot.id,
                            productId: item.productId,
                            delta: item.qty,
                            reason: "cancel",
                            ref: sale.id,
                        },
                    })
                }
            }

            await tx.sale.update({
                where: { id: sale.id },
                data: { status: "cancelled"},
            })
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error("POST /api/sales/[saleId]/cancel error", error)
        return NextResponse.json({ error: "Error en el servidor" }, { status: 500 })
    }
}
