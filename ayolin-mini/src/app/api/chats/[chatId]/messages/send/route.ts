/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getOrCreateMyBot } from "@/lib/bot";
import { parseOrder } from "@/lib/orderParser";

// Rol que le vamos a dar a nuestra ia
const SYSTEM_PROMPT = 'Eres AYOLIN, un sistente personal claro y util. Responde en español de forma concisa y práctica.'

type Pending = { sku: string; productId?: string; qty: number }
const pendingByChat = new Map<string, Pending>() // Estado temporal en memoria (sirve para mini-ayolin)

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

        // Tenemos confirmaciones pendientes?
        const normalized = text.trim().toLowerCase()
        const hasPending = pendingByChat.has(chatId)

        if(hasPending && (normalized === "si" || normalized === "sí" || normalized === "confirmo" || normalized === "si, confirmo")){
            const bot = await getOrCreateMyBot()
            const pend = pendingByChat.get(chatId)! // { sku, qty, productId}
            pendingByChat.delete(chatId)

            let product = null as any
            if(pend.productId){
                product = await db.product.findFirst({ where: { id: pend.productId, chatbotId: bot.id } })
            }
            if(!product){
                product = await db.product.findFirst({ where: { id: pend.productId, chatbotId: bot.id } })
            }
            if(!product){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: "No encontrél el producto al confirmar, vuelve a intentar"},
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messages: assistantMessage})
            }
            
            // Restar el stock
            const want = Math.max(1, pend.qty)
            const dec = await db.product.updateMany({
                where: { id: product.id, chatbotId: bot.id, stock: { gte: want } },
                data: {stock: { decrement: want } },
            })
            if(dec.count !== 1){
                const fresh = await db.product.findFirst({ where: { id: product.id } })
                const assistantMessage = await db.message.create({
                    data: {
                        chatId,
                        role: "assistant",
                        content: `Ya no tengo stock suficiente. Disponible ahora: ${fresh?.stock ?? 0}.`,
                    },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messages: assistantMessage })
            }

            // Ponemos venta pendiente de pago + apartamos inventario
            const sale = await db.sale.create({
                data: {
                    chatbotId: bot.id,
                    productId: product.id,
                    qty: want,
                    status: "pending_payment",
                    paymentMethod: "cash", // Por ahora es el defaul
                },
            })
            await db.inventoryLedger.create({
                data: {
                    chatbotId: bot.id,
                    productId: product.id,
                    delta: -want,
                    reason: "sale",
                    ref: sale.id,
                }
            })

            const reply = `Listo. Aparté ${want} × ${product.name}. Tu pedido quedó **pendiente de pago**. Método: efectivo (por defecto).`
            const [assistantMessage] = await Promise.all([
                db.message.create({
                    data: { chatId, role: "assistant", content: reply },
                    select: { id: true, role: true, content: true, createdAt: true },
                }),
                (!chat.title || chat.title === "Nuevo chat") && db.chat.update({ where: {id: chatId }, data: { title: `Pedido ${product.sku} × ${want}`} }),
            ])
            return NextResponse.json({ message: assistantMessage })
        }

        // Vemos si la persona si quiere comprar o no (deteccion de compra)
        const parsed = parseOrder(text)
        if(parsed){
            const bot = await getOrCreateMyBot()
            const product = await db.product.findUnique({
                where: { chatbotId_sku: { chatbotId: bot.id, sku: parsed.sku } },
            })

            if(!product){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `No encontré el SKU ${parsed.sku}.` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(product.stock < parsed.qty){
                const assistantMessage = await db.message.create({
                    data: {
                        chatId,
                        role: "assistant",
                        content: `Solo tengo ${product.stock} de ${product.name}. ¿Quieres ajustar la cantidad?`,
                    },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            // Guardamos en la memoria que esta pendiente algo
            pendingByChat.set(chatId, { sku: product.sku, productId: product.id, qty: parsed.qty })

            const total = ((product.priceCents * parsed.qty)/100).toFixed(2)
            const confirmPrompt = `Tengo ${parsed.qty} × ${product.name} por $${total} en total. ¿Confirmas la compra? (responde "sí" o "no")`

            const [assistantMessage] = await Promise.all([
                db.message.create({
                    data: { chatId, role: "assistant", content: confirmPrompt },
                    select: { id: true, role: true, content: true, createdAt: true },
                }),
                (!chat.title || chat.title === "Nuevo chat" ) && db.chat.update({ where: {id: chatId }, data: {title: `Intento de compra ${product.sku}` } }),
            ])
            return NextResponse.json({message: assistantMessage})
        }

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
            model: openai('gpt-4.1-nano'),
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
