import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db"

// Ruta para crear y listar chats
export async function GET(){
    const chats = await db.chat.findMany({
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
    return NextResponse.json({ chats })
}

export async function POST(req: NextRequest){
    const { title } = await req.json().catch(() => ({}) )
    const chat = await db.chat.create({
        data: { title: title?.trim() || 'Nuevo chat' },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
    return NextResponse.json({ chat }, {status: 201 })
}