/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod"
import type { Tool } from "./types"
import type { ToolContext } from "./types"
import { searchProductsText } from "@/lib/textSearch"

export const productsSearchTool: Tool<z.ZodObject<any>> = {
    name: "product_search",
    description: "Búsqueda por texto usando índice $text (name/description/sku) con relevancia. Retorna top-N.",
    inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().positive().max(20).default(8),
        in_stock_only: z.boolean().optional().default(false),
    }),
    async execute({ query, limit, in_stock_only }, ctx: ToolContext){
        const items = await searchProductsText({
            db: ctx.db,
            botId: ctx.botId,
            query,
            limit,
            inStockOnly: !!in_stock_only,
        })

        if(items.length === 0){
            const q = query.trim()
            const safe = await ctx.db.product.findMany({
                where: {
                    chatbotId: ctx.botId,
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { sku: { contains: q.toUpperCase() } },
                        { description: { contains: q, mode: "insensitive" } },
                    ],
                    ...(in_stock_only ? { stock: { gt: 0 } } : {}),
                },
                take: limit, 
                orderBy: { updatedAt: "desc" },
            })

            return {
                items: safe.map((p) => ({
                    id: String(p.id),
                    sku: p.sku,
                    name: p.name,
                    description: p.description ?? null,
                    priceCents: p.priceCents,
                    stock: p.stock ?? 0,
                    score: undefined,
                })),
                meta: { tokens: [], strategy: "contains" as const }
            }
        }

        return {
            items, 
            meta: { tokens: [], strategy: "text" as const }
        }
    },
}

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
                    { name: { contains: q, mode: "insensitive" } },
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

export const listAllProductsTool: Tool<z.ZodObject<any>> = {
    name: "list_all_products",
    description: "Lista todos los productos del catálogo del bot (sin término de búsqueda). Útil cuando el usuario pide 'muéstrame todo lo que vendes'. Soporta filtro de solo en-stock y paginación por cursor.",
    inputSchema: z.object({
        in_stock_only: z.boolean().optional().default(false),
        limit: z.number().int().positive().max(50).default(20),
        after_id: z.string().optional(),
        order_by: z.enum(["name_asc", "name_desc", "created_desc", "updated_desc"]).optional().default("name_asc")
    }),
    async execute({ in_stock_only, limit, after_id, order_by }, ctx: ToolContext){
        const orderBy = order_by === "name_desc" 
        ? { name: "desc" as const }
        : order_by === "created_desc"
        ? { createdAt: "desc" as const }
        : order_by === "updated_desc"
        ? { updatedAt: "desc" as const }
        : { name: "asc" as const }

        const where: any = {
            chatbotId: ctx.botId,
            ...(in_stock_only ? { stock: { gt: 0 } } : {}),
        }

        const useCursor = !!after_id
        const queryBase: any = {
            where,
            take: limit,
            orderBy,
            select: { id: true, sku: true, name: true, description: true, priceCents: true, stock: true, updatedAt: true, createdAt: true }
        }

        if(useCursor){
            queryBase.cursor = { id: after_id as string }
            queryBase.skip = 1
        }

        const rows = await ctx.db.product.findMany(queryBase)

        let next_after_id: string | null = null
        if(rows.length === limit){
            const last = rows[rows.length - 1]
            const probe = await ctx.db.product.findMany({
                where, 
                take: 1, 
                skip: 1, 
                cursor: { id: last.id as string },
                orderBy,
                select: { id: true },
            })
            if(probe.length > 0) next_after_id = String(last.id)
        }

        const items = rows.map((p: any) => ({
            id: String(p.id),
            sku: p.sku,
            name: p.name,
            description: p.description ?? null,
            priceCents: p.priceCents,
            stock: p.stock ?? 0,
        }))

        return{
            items, 
            page_info: {
                limit, 
                next_after_id,
                has_more: !!next_after_id,
                order_by,
                in_stock_only: !!in_stock_only
            }
        }
    }
}