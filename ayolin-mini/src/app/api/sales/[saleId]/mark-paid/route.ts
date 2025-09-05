import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";
import { verifySalesPassword } from "@/lib/salesPassword";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: { saleId: string }}

export async function POST(req: NextRequest, { params }: Ctx){
    const bot = await getOrCreateMyBot()

    const { password } = await req.json().catch(() => ({}) )
    if(!(await verifySalesPassword(password ?? "", bot.salesPassHash))){
        return NextResponse.json({ error: "Contraseña invalida "}, {status: 403 })
    }

    const sale = await db.sale.findFirst({ where: { id: params.saleId, chatbotId: bot.id } })
    if(!sale) return NextResponse.json({error: "Venta no encontrada"}, { status: 404 })
    if(sale.status !== "pending_payment"){
        return NextResponse.json({ error: "Solo 'pending_payment' -> 'paid'"}, {status: 409 })
    }

    const update = await db.sale.update({ where: { id: sale.id }, data: {status: "paid" } })
    return NextResponse.json({ ok: true, sale: update })
}