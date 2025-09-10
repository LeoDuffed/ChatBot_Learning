/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";
import { productEmbeddingInput, embedText } from "@/lib/embeddings";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest){
    
    const bot = await getOrCreateMyBot()
    const { searchParams } = new URL(req.url)
    const q = searchParams.get("q") ?? ""
    const page = Number(searchParams.get("page") ?? "1")
    const pageSize = Math.min(Number(searchParams.get("pageSize") ?? "20"), 100)

    const where: any = { chatbotId: bot.id }
    if(q){
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q.toUpperCase() } },
            { description: { contains: q, mode: "insensitive"} },
        ]
    }

    const [ items, total ] = await Promise.all([
        db.product.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: ( page -1) * pageSize,
            take: pageSize,
        }),
        db.product.count({where}),
    ])
    return NextResponse.json({ items, total, page, pageSize})
}

export async function POST(req: NextRequest){
    const bot = await getOrCreateMyBot()
    const body = await req.json().catch(() => ({}) )
    const items = Array.isArray(body) ? body : [body]
    const cleaned = items.map((x) => ({
        sku: String(x.sku ?? "").trim().toUpperCase(),
        name: String(x.name ?? "").trim(),
        description: x.description ? String(x.description) : undefined,
        priceCents: Number.isFinite(Number(x.priceCents)) ? Number(x.priceCents) : NaN,
        stock: Number.isFinite(Number(x.stock)) ? Number(x.stock) : 0,
    })).filter((x) => x.sku && x.name && Number.isFinite(x.priceCents))

    if(cleaned.length === 0){
        return NextResponse.json({ error: "Datos inválidos"}, {status: 400})
    }

    const out: any[] = []
    for(const x of cleaned){
        const saved = await db.product.upsert({
            where: { chatbotId_sku: { chatbotId: bot.id, sku: x.sku }},
            update: {
                name: x.name,
                description: x.description,
                priceCents: x.priceCents,
                ...(typeof x.stock === "number" ? { stock: x.stock} : {}),
            },
            create: {
                chatbotId: bot.id,
                sku: x.sku,
                name: x.name,
                description: x.description,
                priceCents: x.priceCents,
                stock: x.stock ?? 0,
            },
        })

        // Generamos/Actualizamod embedding
        const input = productEmbeddingInput({ sku: saved.sku, name: saved.name, description: saved.description ?? "" })
        const emb = await embedText(input)
        const update = await db.product.update({ where: { id: saved.id }, data: { embedding: emb } })
        
        out.push(update)
    }
    return NextResponse.json({ ok: true, count: out.length, items: out})
}
