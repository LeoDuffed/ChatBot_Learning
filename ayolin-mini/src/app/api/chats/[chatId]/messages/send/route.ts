import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getOrCreateMyBot } from "@/lib/bot";
import { parseOrder } from "@/lib/orderParser";
import { extractKeywords, detectIntent, parseQuantityFromText } from "@/lib/textQuery";
import { Prisma } from "@/generated/prisma";

// Rol que le vamos a dar a nuestra ia
const SYSTEM_PROMPT =   
    "Eres AYOLIN, un asistente claro y útil. Responde en español de forma concisa y práctica. " +
    "Cuando te pregunten por productos, EXISTEN solo los que están en la base de datos. " +
    "No ofrezcas fotos, enlaces, ni acciones que no puedas realizar."

type Pending = | { step: "await_qty"; productId: string; sku: string } | { step: "await_confirm"; productId: string; sku: string; qty: number}
const pendingByChat = new Map<string, Pending>() // Estado temporal en memoria (sirve para mini-ayolin)

function priceStr(cents: number){
    return (cents/100).toFixed(2)
}
function listLines(products: {sku: string; name: string; priceCents: number; stock: number}[]){
    return products.map(p => `• ${p.sku} — ${p.name} — $${priceStr(p.priceCents)} — stock ${p.stock}`).join("\n");
}

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

        const bot = await getOrCreateMyBot()
        const normalized = text.trim().toLowerCase()

        // 1 - Conversacion pendiente
        const pending = pendingByChat.get(chatId)
        if(pending){
            if(pending.step === "await_qty"){
                const qty = parseQuantityFromText(text)
                if(!qty){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: "Cuantas unidades necesitas?"},
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({message: assistantMessage })
                }

                pendingByChat.set(chatId, { step: "await_confirm", productId: pending.productId, sku:pending.sku, qty })
                const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } })
                if(!p){
                    pendingByChat.delete(chatId)
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: "Se me perdió el producto. Inténtalo otra vez." },
                        select: { id: true, role: true, content: true, createdAt: true }
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                const total = priceStr(p.priceCents * qty)
                const confirm =  `Perfecto. ¿Confirmas ${qty} × ${p.name} (SKU ${p.sku}) por $${total}? (responde "sí" o "no")`
                const assistantMessage = await db.message.create({
                    data: {chatId, role: "assistant", content: confirm },
                    select: {id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }

            // Esperamos al confirm ( await_confirm)
            if(/(\bsi\b|\bsí\b|confirmo)/i.test(normalized)){
                const pend = pending as Extract<Pending, { step: "await_confirm"}>
                pendingByChat.delete(chatId)

                // Hay que revalidar el stok y le restamos
                const product = await db.product.findFirst({ where: {id: pend.productId, chatbotId: bot.id }})
                if(!product){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: "No encontre el producto al confirmar, intenta de nuevo" },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                const dec = await db.product.updateMany({
                    where: { id: product.id, chatbotId: bot.id, stock: { gte: pend.qty } },
                    data: { stock: { decrement: pend.qty } }
                })
                if(dec.count !== 1){
                    const fresh = await db.product.findFirst({ where: { id: product.id } })
                    const assistantMessage = await db.message .create({
                        data: {
                            chatId, 
                            role: "assistant",
                            content:  `Ya no tengo stock suficiente. Disponible ahora: ${fresh?.stock ?? 0}.`,
                        },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                const sale = await db.sale.create({
                    data: {
                        chatbotId: bot.id,
                        productId: product.id,
                        qty: pend.qty,
                        status: "pending_payment",
                        paymentMethod: "cash",
                    },
                })
                await db.inventoryLedger.create({
                    data: {
                        chatbotId: bot.id,
                        productId: product.id,
                        delta: -pending.qty,
                        reason: "sale",
                        ref: sale.id,
                    },
                })

                const reply = `Listo. Aparté ${pend.qty} × ${product.name} (SKU ${product.sku}). Pedido **pendiente de pago**.`
                const [ assistantMessage ] = await Promise.all([
                    db.message.create({
                        data: { chatId, role: "assistant", content: reply },
                        select: { id: true, role: true, content: true, createdAt: true },
                    }),
                    (!chat.title || chat.title === "Nuevo chat") && db.chat.update({ where: { id: chatId }, data: { title: `Pedido ${product.sku} × ${pend.qty}`  } })
                ])
                return NextResponse.json({ message: assistantMessage })
            }

            if(/^no\b/i.test(normalized)){
                pendingByChat.delete(chatId)
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: "Perfecto, no realizo la compra. ¿Buscamos otra cosa?" },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
            }
            // Si el usuario escribe otra cosa sigue la conversacion sin cerrar el payment_pending
        }

        // 2 - Busqueda en la base de datos 
        const intent = detectIntent(text)

        // Intento directo de compra son SKU en el mismo texto
        const parsedBySku = parseOrder(text)
        if(parsedBySku){
            const product = await db.product.findUnique({
                where: { chatbotId_sku: { chatbotId: bot.id, sku: parsedBySku.sku }},
            })
            if(!product){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `No encontré el SKU ${parsedBySku.sku}.` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messages: assistantMessage })
            }
            if(product.stock < parsedBySku.qty){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${product.stock} de ${product.name}. ¿Quieres ajustar la cantidad?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messages: assistantMessage })
            }
            // Dejamos la confirmacion pendiente
            pendingByChat.set(chatId, { step: "await_confirm", productId: product.id, sku: product.sku, qty: parsedBySku.qty })
            const total = priceStr(product.priceCents * parsedBySku.qty )
            const confirm = `Tengo ${parsedBySku.qty} × ${product.name} por $${total}. ¿Confirmas la compra? (responde "sí" o "no")`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: confirm },
                select: { id: true, role: true, content: true, createdAt: true},
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // Busqeuda por key words dependiendo de la intencion
        const tokens = extractKeywords(text)
        const AND: Prisma.ProductWhereInput[] = tokens.map((tok) => ({
            OR: [
                { name: { contains: tok, mode: Prisma.QueryMode.insensitive} },
                { sku: { contains: tok.toUpperCase() } },
            ],
        }))

        const results = await db.product.findMany({
            where: tokens.length ? { chatbotId: bot.id, AND: AND } : { chatbotId: bot.id },
            orderBy: { createdAt: "desc" },
            take: 5,
        })

        // Respuestas naturales dependiendo de la intencion del cliente
        if(intent === "ask_inventory" || (!intent && tokens.length === 0)){
            if(results.length === 0){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: "Aún no tengo productos cargados. Puedes darme un SKU o nombre para buscar." },
                    select: { id: true, role: true, content: true, createdAt: true }, 
                })
                return NextResponse.json({ message: assistantMessage })
            }
            const msg = `Tengo estas opciones:\n${listLines(results)}\n\nSi quieres uno, dime su SKU (ej. ${results[0].sku}) o di “quiero 2 de ${results[0].sku}”.`
            const assistantMessage = await db.message.create({
                data: {chatId, role: "assistant", content: msg },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        if(intent === "ask_availability" || intent === "ask_stock" || intent === "ask_price" || intent === "buy" ){
            if(results.length === 0){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: "No encontré productos con esa descripción. ¿Tienes el SKU?" },
                    select: { id: true, role: true, content: true, createdAt: true},
                })
                return NextResponse.json({ message: assistantMessage })
            }

            if(results.length === 1){
                const p = results[0]
                if(intent === "ask_price"){
                    const msg = `${p.name} (SKU ${p.sku}) cuesta $${priceStr(p.priceCents)}.`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: msg },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                if(intent === "ask_stock" || intent === "ask_availability"){
                    const disp = p.stock > 0 ? `Sí, tengo ${p.stock} disponibles` : "No, está agotado"
                    const msg = `${disp} de ${p.name} (SKU ${p.sku}). Precio: $${priceStr(p.priceCents)}.` 
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: msg },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
                if(intent === "buy"){
                    pendingByChat.set(chatId, {step: "await_qty", productId: p.id, sku: p.sku})
                    const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr(p.priceCents)}. ¿Cuántas unidades necesitas?`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: msg },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
            }

            const msg = `Encontré varias opciones:\n${listLines(results)}\n\nElige por SKU (ej: ${results[0].sku})${intent === "buy" ? " y dime cuántas" : ""}.`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: msg },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // 3 - Fallback LLM si no hay intencion clara

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
