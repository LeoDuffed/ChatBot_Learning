/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest){
    const bot = await getOrCreateMyBot()

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status") as "pending_payment" | "paid" | "cancelled" | null

    const where: any = { chatbotId: bot.id}
    if(status) where.status = status
    
    const items = await db.sale.findMany({
        where,
        orderBy: {createdAt: "desc"},
        include: {product: true },
        take: 50,
    })

    return NextResponse.json({ items})
}