import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

const SYSTEM_PROMPT = 'Eres ATOLIN, un sistente personal claro y util. Responde en español de forma concisa y práctica.'

export async function POST(req: NextRequest, { params }: { params: { chatId: string } }){
    try{
        const { chatId } = params
        const { text } = await req.json() as { text: string }

        if(!text || !text.trim() ){
            return NextResponse.json({ error: 'Texto vació' }, { status: 400 })
        }

        // Validamos que exista el chat
        const chat = await db.chat.findUnique({ where: { id: chatId } })
        if(!chat) return NextResponse.json({ error: 'Chat not found '}, { status: 404 })

        // Guardar mensajes del usuario
        await db.message.create({
            data: { chatId, role: 'user', content: text.trim() },
        })

        // Tomamos los ultimos 30 mensajes de contexto
        const history = await db.message.findMany({
            where: { chatId },
            orderBy: { createdAt: 'asc' },
            take: 30,
        })

        //Convertir al formato del AI SDK
        const messages = history.map((m) => ({
            role: m.role === 'user' ? ('user' as const) : ('assistant' as const ),
            content: m.content, 
        }))

        //Llamamos a OpenAI
        const result = await generateText({
            model: openai('gpt-4.1-mini'),
            system: SYSTEM_PROMPT,
            messages,
            temperature: 0.7,
            maxOutputTokens: 200,
        })

        const reply = result.text?.trim() || '...'

        const [assistantMessage ] = await Promise.all([
            db.message.create({
                data: { chatId, role: 'assistant', content: reply },
                select: { id: true, role: true, content: true, createdAt: true},
            }),
            (!chat.title || chat.title === "Nuevo chat" ) && 
                db.chat.update({
                    where: {id: chatId },
                    data: { title: text.slice(0,40) },
            }),
        ])

        return NextResponse.json({
            message: assistantMessage,
            usage: result.totalUsage,
        })
    } catch(e){
        console.error(e)
        return NextResponse.json({error: 'Server error' }, { status: 500 })
    }
}