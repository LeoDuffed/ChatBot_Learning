/* eslint-disable @typescript-eslint/no-explicit-any */

import OpenAI from "openai"
import { getOpenAIFunctions, dispatchToolCall } from "./tools/registry"
import type { ToolContext } from "./tools/types"
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const SYSTEM_PROMPT = `
Eres AYOLIN, mi asistente en venta de ropa.

REGLAS ESTRICTAS:
1) NUNCA inventes SKUs, nombres, precios ni stock.
2) Para catálogo (nombre, precio, stock, SKU) **SIEMPRE** usa tools de inventario.
3) Para configuración (métodos de pago y envío) **SIEMPRE** usa tools get_payment_methods y get_shipping_methods.
4) Flujo de compra **obligatorio** (carrito):
   - Cuando el usuario pida comprar/agregar cantidades: usa \`cart_add_item\` y luego \`cart_get\`.
   - Antes de confirmar: debes tener \`payment_method\`, \`shipping_method\` y \`contact\`. Si falta algo, PREGUNTA y llama \`cart_set_*\`.
   - Para registrar la compra: **SIEMPRE** llama \`checkout_submit\`. No confirmes sin esa tool.
5) Para pago por transferencia: NO inventes datos. Si existen, usa \`get_payment_instructions\`.
6) No calcules totales manualmente. Léelos del carrito o venta. Responde breve y claro en español.
7) Si el usuario pide ver TODO el catálogo o “todo lo que vendes” sin términos de búsqueda, usa list_all_products (con in_stock_only=true si pide “disponible”).
`

export async function runMiniAyolinTurn({
    userMessage,
    priorMessages,
    ctx,
    maxToolHops = 8, 
}: {
    userMessage: string
    priorMessages: { role: "user" | "assistant" | "system"; content: string; name?: string }[]
    ctx: ToolContext
    maxToolHops?: number
}) {

    const functions = getOpenAIFunctions()

    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...priorMessages.map((m) => ({
        role: m.role,
        content: m.content,
        })),
        { role: "user", content: userMessage },
    ]

    for (let hop = 0; hop < maxToolHops; hop++) {
        const resp = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools: functions.map((f) => ({ type: "function", function: f })) as any,
            tool_choice: "auto",
            temperature: 0.1,
        })

        const msg = resp.choices[0]?.message
        if (!msg) return { content: "No pude obtener una respuesta.", messages }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            const assistantWithCalls: ChatCompletionAssistantMessageParam = {
                role: "assistant",
                content: msg.content ?? "",
                tool_calls: msg.tool_calls,
            }
            messages.push(assistantWithCalls)

            for (const tc of msg.tool_calls) {
                if (tc.type !== "function") continue
                const callId = tc.id
                const toolName = tc.function?.name
                if (!callId || !toolName) continue

                let args: unknown = {}
                try {
                    args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
                } catch {
                    args = {}
                }

                const result = await dispatchToolCall(toolName, args, ctx)

                const toolMsg: ChatCompletionToolMessageParam = {
                    role: "tool",
                    tool_call_id: callId,
                    content: JSON.stringify(result),
                }
                messages.push(toolMsg)
            }
            continue
        }
        return { content: msg.content ?? "", messages }
    }
    return { content: "No pude completar la consulta", messages }
}
