import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getOrCreateMyBot } from "@/lib/bot";
import { parseUtterance } from "@/lib/nlu";
import { semanticSearchProducts, getProductBySku } from "@/lib/search";

type Pending = | { step: "await_qty"; productId: string; sku: string } | { step: "await_confirm"; productId: string; sku: string; qty: number}
const pendingByChat = new Map<string, Pending>() // Estado temporal en memoria (sirve para mini-ayolin)

function priceStr(cents: number){
    return (cents/100).toFixed(2)
}
function listLines(products: {sku: string; name: string; priceCents: number; stock: number}[]){
    return products.map(p => `• ${p.sku} — ${p.name} — $${priceStr(p.priceCents)} — stock ${p.stock}`).join("\n");
}

const SAFE_RESPONDER_SYSTEM = `
Eres AYOLIN. Redacta natural en español SOLO con los "hechos" que te paso.
Si un dato (precio, stock) no aparece en hechos, NO LO INVENTES.
No ofrezcas acciones que no existen (fotos, enlaces, tracking).
`.trim()

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }){ // Endpoint dinámico
    try{
        const { chatId } = await params
        const { text } = await req.json() as { text: string } // Leemos el chatId y el mensaje del usuario

        if(!text?.trim()) return NextResponse.json({ error: "Texto vacio"} , { status: 400 })

        // Validamos que exista el chat
        const chat = await db.chat.findUnique({ where: { id: chatId } })
        if(!chat) return NextResponse.json({ error: 'Chat not found '}, { status: 404 })

        // Guardar mensaje del usuario
        await db.message.create({
            data: { chatId, role: 'user', content: text.trim() },
        })

        const bot = await getOrCreateMyBot()

        // 1 - Conversación pendiente
        const pending = pendingByChat.get(chatId)
        if(pending){
            const low = text.trim().toLowerCase()

            // cantidad mientras confirmamos: "si 3" / "quiero 5"
            const qtyMatch = low.match(/\b(\d{1,3})\b/)
            if(pending.step === "await_confirm" && qtyMatch){
                pending.qty = Math.max(1, parseInt(qtyMatch[1], 10))
                pendingByChat.set(chatId, pending)
            }

        }

        // 2 - Búsqueda en la base de datos e intención
        // Intento directo de compra: SKU en el mismo texto
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
                return NextResponse.json({ message: assistantMessage })
            }
            if(product.stock < parsedBySku.qty){
                const assistantMessage = await db.message.create({
                    data: { chatId, role: "assistant", content: `Solo tengo ${product.stock} de ${product.name}. ¿Quieres ajustar la cantidad?` },
                    select: { id: true, role: true, content: true, createdAt: true },
                })
                return NextResponse.json({ message: assistantMessage })
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

        // Búsqueda por palabras clave dependiendo de la intención
        const whereAND = tokens.length ? buildWhereAND(bot.id, tokens) : { chatbotId: bot.id } as Prisma.ProductWhereInput

        let results = await db.product.findMany({
            where: whereAND,
            orderBy: { createdAt: "desc" },
            take: 5,
        })

        // Si AND no trae nada, intentamos con OR
        if(results.length === 0 && tokens.length){
            const whereOR = buildWhereOR(bot.id, tokens)
            results = await db.product.findMany({
                where: whereOR,
                orderBy: { createdAt: "desc" },
                take: 5,
            })
        }

        // Si la intención es sobre inventario, precio, stock o compra, responde basado en la DB
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

                if(intent === "ask_stock" || intent === "ask_availability"){
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

            // Código para coincidencias
            const msg = `Encontré varias opciones:\n${listLines(results)}\n\nElige por SKU (ej: ${results[0].sku})${ intent === "buy" ? " y dime cuántas" : "" }.`
            const assistantMessage = await db.message.create({
                data: { chatId, role: "assistant", content: msg },
                select: { id: true, role: true, content: true, createdAt: true },
            })
            return NextResponse.json({ message: assistantMessage })
        }

        // 3 - Fallback LLM si no hay intención clara

        // Tomamos los ultimos 30 mensajes de contexto
        const history = await db.message.findMany({
            where: { chatId },
            orderBy: { createdAt: 'asc' },
            take: 30,
        })

        // Convertir al formato del AI SDK
        const messages = history.map((m) => ({
            role: m.role === 'user' ? ('user' as const) : ('assistant' as const ),
            content: m.content, 
        }))

        // Llamamos a OpenAI
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
        const reply = result.text?.trim() || '¿En qué te puedo ayudar?' // Si el texto generado por la IA viene vacío o no existe, respondemos...

        const [assistantMessage ] = await Promise.all([ // Con Promise.all hacemos estas dos cosas al mismo tiempo
            db.message.create({
                data: { chatId, role: 'assistant', content: reply },
                select: { id: true, role: true, content: true, createdAt: true},
            }), // Guardamos el mensaje de respuesta en la BD del chatbot
            (!chat.title || chat.title === "Nuevo chat" ) && 
                db.chat.update({
                    where: {id: chatId },
                    data: { title: text.slice(0,40) },
            }), // Si aún no tiene título se lo ponemos con los primeros 40 caracteres
        ])

        return NextResponse.json({
            message: assistantMessage,
            usage: result.totalUsage,
        }) // Devolvemos al frontend el mensaje del chatbot + estadísticas de uso de tokens
    } catch(e){
        console.error(e)
        return NextResponse.json({error: 'Server error' }, { status: 500 })
    }
}
