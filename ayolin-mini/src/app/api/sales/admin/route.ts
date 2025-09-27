/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest){
    try{
        const bot = await getOrCreateMyBot()
        const { searchParams } = new URL(req.url)

        const statusParam = searchParams.get("status")
        const limitParam = Number(searchParams.get("limit") || 50)

        const allowedStatus = new Set(["pending_payment", "paid", "cancelled"])
        const where: any = { chatbotId: bot.id }       
        if(statusParam && allowedStatus.has(statusParam)) where.status = statusParam

        const items = await db.sale.findMany({
            where, orderBy: { createdAt: "desc" }, include: { items: true }, take: Math.min(Math.max(limitParam, 1), 100)
        })

        return NextResponse.json({ ok: true, items })
    } catch(e){
        console.error(e)
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500})
    }
}