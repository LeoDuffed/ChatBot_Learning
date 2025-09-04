import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

// Rol que le vamos a dar a nuestra ia
const SYSTEM_PROMPT = 'Eres ATOLIN, un sistente personal claro y util. Responde en español de forma concisa y práctica.'

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }){ // Endpoint dinamico
    try{
        const { chatId } = await params
        const { text } = await req.json() as { text: string } // Leemos el chatId y el mns del usuario

        if(!text || !text.trim() ){
            return NextResponse.json({ error: 'Texto vació' }, { status: 400 })
        } // Si esta vacio respondemos con un Bad Request

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
            messages, // Historial del chat
            temperature: 0.7, // Equilibrio de creatividad y consistencia
            maxOutputTokens: 200,
        })

        /* .trim()
        Es un método de JavaScript que elimina los espacios en blanco al inicio y al final de un string.
        Sirve para asegurarse de que el texto esté "limpio" antes de guardarlo en la base de datos o mostrarlo en pantalla.
        */
        const reply = result.text?.trim() || '...' // Si texto generado por la ia viene vacia o no existe responemod ...

        const [assistantMessage ] = await Promise.all([ // Con Promise.all hacemos estas dos cosas al mismo timepo
            db.message.create({
                data: { chatId, role: 'assistant', content: reply },
                select: { id: true, role: true, content: true, createdAt: true},
            }), // Guardamos el mensaje de respuesta en la bd del chatbot
            (!chat.title || chat.title === "Nuevo chat" ) && 
                db.chat.update({
                    where: {id: chatId },
                    data: { title: text.slice(0,40) },
            }), // Si aun no tiene titulo se lo ponemos con los primeros 40 caracteres
        ])

        return NextResponse.json({
            message: assistantMessage,
            usage: result.totalUsage,
        }) // Devolevemos al fontend el mns del chatbot + estaditicas de uso de token
    } catch(e){
        console.error(e)
        return NextResponse.json({error: 'Server error' }, { status: 500 })
    }
}
