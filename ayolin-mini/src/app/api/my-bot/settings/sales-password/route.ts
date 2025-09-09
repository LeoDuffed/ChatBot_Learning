import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";
import { hashSalesPassword } from "@/lib/salesPassword";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(req: NextRequest){
    const { password } = await req.json().catch(() => ({}))
    if(!password || typeof password !== "string" || password.length < 4){
        return NextResponse.json({ error: "Contraseña inválida"}, { status: 400})
    }

    const bot = await getOrCreateMyBot()
    const salesPassHash = await hashSalesPassword(password)

    await db.chatbot.update({
        where: { id: bot.id},
        data: { salesPassHash},
    })

    return NextResponse.json({ok: true})
 
}
