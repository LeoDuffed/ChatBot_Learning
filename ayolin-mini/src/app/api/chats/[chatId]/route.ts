import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
    try{
        const { chatId } = await params;

        // Verificamos si existe
        const chat = await db.chat.findUnique({ where: { id: chatId } })
        if(!chat) return NextResponse.json({error: "Chat not found"}, {status: 404 })
        
        // Hay que borrar primero los mns y luego el chat
        await db.$transaction([
            db.message.deleteMany({ where: { chatId } }),
            db.chat.delete({ where: { id: chatId } }),
        ])

        return new NextResponse(null, { status: 204 })
    } catch(e){
        console.error(e)
        return NextResponse.json({ error: "Server error"}, { status: 500 })
    }
}
