/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse, NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(req: NextRequest){
    try{
        const bot = await getOrCreateMyBot()
        const body = await req.json().catch(() => ({}) )
        let methods: any = body?.methods

        if(!Array.isArray(methods)) methods = []
        // Hay que normalizar strings simples
        methods = methods.map((m: any) => String(m || "").trim().toLowerCase()).filter((m: string) => m.length > 0 ) 

        const allowed = new Set(["cash", "transfer", "card" ])
        methods = methods.filter((m: string) => allowed.has(m))

        const update = await db.chatbot.update({
            where: { id: bot.id },
            data: { paymentMethods: methods },
            select: { id: true, paymentMethods: true },
        })
        return NextResponse.json({ ok: true, bot: update })
    } catch(e) {
        console.error(e)
        return NextResponse.json({ error: "Server error" }, { status: 500})
    }
}

export async function GET(){
    try{
        const bot = await getOrCreateMyBot()
        const fresh = await db.chatbot.findFirst({
            where: { id: bot.id },
            select: { id: true, paymentMethods: true },
        })
        return NextResponse.json({ ok: true, bot: fresh })
    } catch(e) {
        console.error(e)
        return NextResponse.json({ error: "Server error"}, { status: 500 })
    }
}