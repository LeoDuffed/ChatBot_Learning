import { generateObject } from "ai";
import { models } from "./llm";
import { z } from "zod"

export const NLU_SCHEMA = z.object({
    intent: z.enum(["ask_inventory","ask_availability","ask_stock","ask_price","buy","chit_chat"]),
    product_query: z.string().min(1).optional().nullable(),
    sku: z.string().min(1).optional().nullable(),
    qty: z.number().int().positive().nullable(),
    attributes: z.object({ color: z.string().optional(), size: z.string().optional() ,}).partial().optional().nullable(),
})

export type NluResult = z.infer<typeof NLU_SCHEMA>

const SYSTEM = `
Eres un parser NLU. Devuelve SOLO JSON válido acorde al esquema.
No inventes SKU ni cantidades. Si no hay, deja null/omítelo.`.trim()

export async function parseUtterance(input: string): Promise<NluResult>{
    const { object } = await generateObject({
        model: models.chat(),
        system: SYSTEM,
        prompt: `Usuario: ${input}`,
        schema: NLU_SCHEMA,
        temperature: 0,
    })
    return object
}

