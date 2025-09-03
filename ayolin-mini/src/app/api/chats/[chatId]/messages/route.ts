import { NextResponse, NextRequest } from "next/server";
import { db } from "@/lib/db";

// Ruta para poder obtener mensajes de un chat
export async function GET(_req: NextRequest, { params }: { params: {chatId: string } }){
    const { chatId } = params
    const chat = await db.chat.findUnique({ where: { id:chatId } } )
    if(!chat) return NextResponse.json({error: 'Chat not found' }, { status: 404})
    
    const messages = await db.message.findMany({
        where: { chatId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
    })
    return NextResponse.json({ messages })
}