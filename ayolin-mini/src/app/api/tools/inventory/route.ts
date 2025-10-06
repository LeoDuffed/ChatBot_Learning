import { z } from "zod"
import type { Tool } from "@/ai/tools/types"
import type { ToolContext } from "@/ai/tools/types"
import { searchProductsText } from "@/lib/textSearch"
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const POST = async (req: NextRequest) =>{
    const { input, config } = await req.json() as {input: {query: string, limit: number}, config: Record<string, unknown>}
    const q = input.query.trim()
    const items = await db.product.findMany({
        where: {
            OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q.toUpperCase() } },
                { description: { contains: q, mode: "insensitive" } },
            ],
        },
        take: input.limit,
        orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({
        items: items.map((p) => ({
        id: String(p.id),
        sku: p.sku,
        name: p.name,
        description: p.description ?? null,
        priceCents: p.priceCents,
        stock: p.stock ?? 0,
    }))
    })
}