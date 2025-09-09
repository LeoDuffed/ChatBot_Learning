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

function buildWhereAND(botId: string, tokens: string[]): Prisma.ProductWhereInput {
    const AND: Prisma.ProductWhereInput[] = tokens.map((tok) => ({
        OR: [
            { name: { contains: tok, mode: "insensitive" as const } },
            { sku: { contains: tok.toUpperCase() } },
        ]
    }))
    return { chatbotId: botId, AND }
}

function buildWhereOR(botId: string, tokens: string[]): Prisma.ProductWhereInput {
    const OR: Prisma.ProductWhereInput[] = tokens.flatMap((tok) => ([
        { name: { contains: tok, mode: "insensitive" as const } },
        { sku: { contains: tok.toUpperCase() } },
    ]))
    return { chatbotId: botId, OR}
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
        const intent = detectIntent(text)
        const tokens = extractKeywords(text)

        // 1 - Conversacion pendiente
        const pending = pendingByChat.get(chatId)
        if(pending){
            // Si piden cantidad mientras confirma la compra, cambiamos qty
            const qtyInText = parseQuantityFromText(text)
            if(pending.step === "await_confirm" && qtyInText && qtyInText !== pending.qty){
                pending.qty = qtyInText
                pendingByChat.set(chatId, pending)
            }

            // Si preguntamos stock mientras esta pening, responde el stock de ese producto
            if(/\b(cuantos|cuantas|cuánto|stock|quedan?)\b/i.test(text)){
                const p = await db.product.findFirst({ where: { id: pending.productId, chatbotId: bot.id } })
                if(!p){
                    pendingByChat.delete(chatId)
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: "No encuentro el producto ahora. Intentemos de nuevo." },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ messages: assistantMessage })
                }
                const msg = p.stock > 0 ? `De ${p.name} (SKU ${p.sku}) tengo ${p.stock} disponibles.` : `De ${p.name} (SKU ${p.sku}) no tengo stock ahora.`;
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: msg },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ messages: assistantMessage })
            }

            // En la confirmacion si puso nueva cantidad la actualizamod
            if(/(^|\b)s[ií]\b/.test(normalized)){
                const pend = pending as Extract<Pending, { step: "await_confirm"}>
                // Si estaba en await_qty, hay que pedir cantidad primero
                if(pend?.step !== "await_confirm"){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: "¿Cuántas unidades necesitas?" },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                pendingByChat.delete(chatId)

                const product = await db.product.findFirst({ where: { id: pend.productId, chatbotId: bot.id } })
                if(!product){
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: "No encontré el producto al confirmar. Inténtalo de nuevo."},
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                const want = Math.max(1, pend.qty)
                const dec = await db.product.updateMany({
                    where: { id: product.id, chatbotId: bot.id, stock: { gte: want } },
                    data: { stock: { decrement: want } },
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
                    return NextResponse.json({ message: assistantMessage })
                }

                const sale = await db.sale.create({
                    data: {
                        chatbotId: bot.id,
                        productId: product.id,
                        qty: want,
                        status: "pending_payment",
                        paymentMethod: "cash",
                    },
                })
                await db.inventoryLedger.create({
                    data: {
                        chatbotId: bot.id,
                        productId: product.id,
                        delta: -want,
                        reason: "sale",
                        ref: sale.id,
                    },
                })

                const reply = `Listo. Aparté ${want} × ${product.name} (SKU ${product.sku}). Pedido **pendiente de pago**.`
                const [assistantMessage] = await Promise.all([
                    db.message.create({
                        data: { chatId, role: "assistant", content: reply },
                        select: { id: true, role: true, content: true, createdAt: true },
                    }),
                    (!chat.title || chat.title === "Nuevo chat") && db.chat.update({ where: { id: chatId }, data: { title:`Pedido ${product.sku} × ${want}` } }),
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

            // Si el usuario cambio de intencion, seguimos abajo con busqeuda normal
        }

        // 2 - Busqueda en la base de datos e Intencion
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
        const whereAND = tokens.length ? buildWhereAND(bot.id, tokens) : { chatbotId: bot.id } as Prisma.ProductWhereInput

        let results = await db.product.findMany({
            where: whereAND,
            orderBy: { createdAt: "desc" },
            take: 5,
        })

        // Si and no trae nada, intentamos con or
        if(results.length === 0 && tokens.length){
            const whereOR = buildWhereOR(bot.id, tokens)
            results = await db.product.findMany({
                where: whereOR,
                orderBy: { createdAt: "desc" },
                take: 5,
            })
        }

        // Si la itencion es sobre el inventario, precio, stock o compra, responde basado en ls db
        if(intent){
            if(results.length === 0){
                const assistantMessage = await db.message.create({
                    data: {
                        chatId,
                        role: "assistant",
                        content: "No encontré productos con esa descripción. ¿Tienes el SKU exacto o un nombre más específico?",
                    },
                    select: { id: true, role: true, content: true, createdAt: true },
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

                if(intent ==="ask_stock" || intent === "ask_availability"){
                    const disp = p.stock > 0 ? `Sí, tengo ${p.stock} disponibles` : "No, está agotado"
                    const msg = `${disp} de ${p.name} (SKU ${p.sku}). Precio: $${priceStr(p.priceCents)}.`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: msg },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }

                // Comprar por nombre, pedimos cantidad
                if(intent === "buy"){
                    pendingByChat.set(chatId, { step: "await_qty", productId: p.id, sku: p.sku })
                    const msg = `Perfecto, ${p.name} (SKU ${p.sku}) está a $${priceStr(p.priceCents)}. ¿Cuántas unidades necesitas?`
                    const assistantMessage = await db.message.create({
                        data: { chatId, role: "assistant", content: msg },
                        select: { id: true, role: true, content: true, createdAt: true },
                    })
                    return NextResponse.json({ message: assistantMessage })
                }
            }

            // Codigo para la coincidencias
            const msg = `Encontré varias opciones:\n${listLines(results)}\n\nElige por SKU (ej: ${results[0].sku})${ intent === "buy" ? " y dime cuantas" : "" }.`
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
        const reply = result.text?.trim() || 'En que te puedo ayudar?' // Si texto generado por la ia viene vacia o no existe responemod ...

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
