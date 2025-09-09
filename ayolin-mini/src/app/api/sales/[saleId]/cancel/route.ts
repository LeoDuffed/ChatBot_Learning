import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";
import { verifySalesPassword } from "@/lib/salesPassword";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params : Promise<{ saleId: string}> }

export async function POST(req: NextRequest, { params }: Ctx){
    const bot = await getOrCreateMyBot()

    const { password } = await req.json().catch(() => ({}) )
    if(!(await verifySalesPassword(password ?? "", bot.salesPassHash))){
        return NextResponse.json({ error: "Contraseña inválida"}, { status: 403})
    }

    const { saleId } = await params
    const sale = await db.sale.findFirst({
        where: { id: saleId, chatbotId: bot.id },
        include: { product: true },
    })
    if(!sale) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    if(sale.status !== "pending_payment" ){
        return NextResponse.json({ error: "Solo se puede cancelar 'pending_payment'"}, {status: 409})
    }

    await db.$transaction([
        db.product.update({
            where: {id: sale.productId },
            data: { stock: { increment: sale.qty }},
        }),
        db.inventoryLedger.create({
            data: {
                chatbotId: bot.id,
                productId: sale.productId,
                delta: sale.qty,
                reason: "cancel",
                ref: sale.id,
            },
        }),
        db.sale.update({
            where: { id: sale.id },
            data: { status: "cancelled"},
        }),
    ])
    return NextResponse.json({ ok: true })


}
