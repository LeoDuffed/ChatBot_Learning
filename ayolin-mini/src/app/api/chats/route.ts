import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db" // Para interactuar con la db

// Ruta para listar chats
export async function GET(){
    const chats = await db.chat.findMany({ // Conseguimos todos los chats de la coleccion chat
        orderBy: { updatedAt: 'desc' }, // Ponemos primero los ultimos editados
        select: { id: true, title: true, createdAt: true, updatedAt: true }, // Solo devolvemos los campos necesarios
    })
    return NextResponse.json({ chats })
} // Con este metodo cuando hagamos un fetch en el frontend obtenemos las listas de chats

// Ruta para crear nuevo chat
export async function POST(req: NextRequest){
    const { title } = await req.json().catch(() => ({}) ) // Leemos la cuerpo de la peticion
    const chat = await db.chat.create({
        data: { title: title?.trim() || 'Nuevo chat' }, // Si no trae nombre le ponemos el default
        select: { id: true, title: true, createdAt: true, updatedAt: true },
    }) // Creamos un nuevo registro en la coleccion chat
    return NextResponse.json({ chat }, {status: 201 }) // 201, codigo estandar para creado con exito
}