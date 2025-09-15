/* eslint-disable @typescript-eslint/no-explicit-any */
import OpenAI from "openai";
import { getOpenAIFunctions, dispatchToolCall } from "./tools/registry";
import type { ToolContext } from "./tools/types";
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const SYSTEM_PROMPT = `
Eres AYOLIN (mini-ayolin), asistente de ventas.

REGLAS ESTRICTAS:
1) NUNCA inventes SKUs, nombres, precios ni stock.
2) Para cualquier dato de catálogo (nombre, precio, stock, SKU) SIEMPRE usa tools antes de responder.
3) Si las tools no devuelven resultados, di claramente que no lo encuentras y sugiere buscar por SKU o nombre más específico.
4) Responde en español, breve y claro.

Si el usuario hace preguntas de charla general (no productos), puedes responder normalmente,
pero si la pregunta toca el catálogo, debes invocar tools.
`

export async function runMiniAyolinTurn({
    userMessage,
    priorMessages,
    ctx,
    maxToolHops = 4,
} : {
    userMessage: string
    priorMessages: { role: "user" | "assistant" | "system"; content: string; name?: string }[]
    ctx: ToolContext;
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

    for(let hop = 0; hop < maxToolHops; hop++){
        const resp = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools: functions.map((f) => ({ type: "function", function: f })) as any,
            tool_choice: "auto",
            temperature: 0.1,
        })

        const msg = resp.choices[0]?.message

        // Si por alguna razon no viene mensaje, cortamos
        if(!msg) return { content: "No pude obtener una respuesta.", messages }

        // Si pide usar herramientas
        if(msg.tool_calls && msg.tool_calls.length > 0){
            // Primero empujamos el mensaje del assitente con las tool_calls
            const assistantWithCalls: ChatCompletionAssistantMessageParam = {
                role: "assistant",
                content: msg.content ?? "",
                tool_calls: msg.tool_calls,
            }
            messages.push(assistantWithCalls)

            // Respondemos a cada tool_call con un mensaje de rol
            for(const tc of msg.tool_calls){
                if(tc.type !== "function") continue

                const callId = tc.id
                const toolName = tc.function?.name
                if(!callId || !toolName) continue

                let args: unknown = {}
                try{
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
    
        return { content: msg.content ?? "", messages}
    }

    return { content: "No pude completar la consulta", messages}
}
