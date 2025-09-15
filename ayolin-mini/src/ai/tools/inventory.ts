/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod"
import type { Tool } from "./types"
import type { ToolContext } from "./types"

export const searchInventoryTool: Tool<z.ZodObject<any>> = {
    name: "search_inventory",
    description: "Busca productos del catálogo del bot por texto (nombre/sku). Devuelve hasta N resultados del bot actual.",
    inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().positive().max(20).default(8),
    }),
    async execute({ query, limit }, ctx: ToolContext){
        const q = query.trim()
        const items = await ctx.db.product.findMany({
            where: {
                chatbotId: ctx.botId,
                OR: [
                    { name: {contains: q, mode: "insensitive" } },
                    { sku: { contains: q.toUpperCase() } },
                    { description: { contains: q, mode: "insensitive" } },
                ],
            },
            take: limit,
            orderBy: { createdAt: "desc" },
        })

        return items.map((p) => ({
            id: String(p.id),
            sku: p.sku,
            name: p.name,
            description: p.description ?? null,
            priceCents: p.priceCents,
            stock: p.stock ?? 0,
        }))
    },
}

export const getBySkuTool: Tool = {
    name: "get_product_by_sku",
    description: "Obtiene un producto del catálogo del bot por SKU exacto.",
    inputSchema: z.object({ sku: z.string().min(1) }),
    async execute({ sku }, ctx ){
        const p = await ctx.db.product.findUnique({
            where: { chatbotId_sku: { chatbotId: ctx.botId, sku } },
        })
        if(!p) return null
        return {
            id: String(p.id),
            sku: p.sku,
            name: p.name,
            description: p.description ?? null,
            priceCents: p.priceCents,
            stock: p.stock ?? 0,
        }
    },
}

export const checkStockTool: Tool = {
    name: "check_stock",
    description: "Verifica si hay stock suficiente para un SKU y cantidad dada (en el bot actual).",
    inputSchema: z.object({ sku: z.string(), qty: z.number().int().positive().default(1) }),
    async execute({ sku, qty }, ctx ){
        const p = await ctx.db.product.findUnique({
            where: { chatbotId_sku: { chatbotId: ctx.botId, sku } },
        })
        if(!p) return { ok: false, reason: "SKU no encontrado" }
        const stock = p.stock ?? 0
        return { ok: stock >= qty, available: stock, request: qty, name: p.name, priceCents: p.priceCents }
    }
}