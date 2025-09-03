import { NextResponse, NextRequest } from "next/server";
import { db } from "@/lib/db";

// Ruta para poder obtener mensajes de un chat
export async function GET(_req: NextRequest, { params }: { params: Promise<{chatId: string }> }){
    const { chatId } = await params // recibimos el chatId, esperamos un objeto { chatId: "valor" }
    const chat = await db.chat.findUnique({ where: { id:chatId } } ) // Vemos si existe un chat en la db
    if(!chat) return NextResponse.json({error: 'Chat not found' }, { status: 404}) // Si no mandamos un Not Found
    
    const messages = await db.message.findMany({
        where: { chatId }, // Buscamos los mns del chat
        orderBy: { createdAt: 'asc' }, // Los ordenamos del mas antiguo al ultimo
        select: { id: true, role: true, content: true, createdAt: true }, // Campos importantes
    }) 
    return NextResponse.json({ messages }) // Devolvemos los mns 
}
