import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { embedText, productEmbeddingInput, cosineSim } from "./embeddings";

// Tokenizacion simple para fallback textual
function tokens(t: string){
    return (t || "" )
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9._-\s]/g, " ")
        .split(/\s+/).filter(Boolean);
}

function buildWhereAND(botId: string, toks: string[]): Prisma.ProductWhereInput{
    const AND: Prisma.ProductWhereInput[] = toks.map((tok) => ({
        OR: [
            { name: { contains: tok, mode: "insensitive" as const } },
            { sku: { contains: tok.toUpperCase() } },
            { description: { contains: tok, mode: "insensitive" as const } },
        ],
    }))
    return { chatbotId: botId, AND }
}

function buildWhereOR(botId: string, toks: string[]): Prisma.ProductWhereInput{
    const OR: Prisma.ProductWhereInput[] = toks.flatMap((tok) => ([
        { name: { contains: tok, mode: "insensitive" as const } },
        { sku: { contains: tok.toUpperCase() } },
        {description: { contains: tok, mode: "insensitive" as const } },
    ]))
    return { chatbotId: botId, OR }
}

// Exacato por SKU
export async function getProductBySku(botId: string, sku: string){
    return db.product.findUnique({
        where: { chatbotId_sku: { chatbotId: botId, sku: sku.toUpperCase().trim() } },
    })
}

// Semantico por embedding
export async function semanticSearchProducts(botId: string, query: string, k = 8){
    const q = query?.trim()
    if(!q) return []

    const qEmb = await embedText(q)

    // Traemos los productos con embedding (no vacío)
    const candidates = await db.product.findMany({
        where: { chatbotId: botId, embedding: { isEmpty: false } },
        select: { id: true, sku: true, name: true, description: true, priceCents: true, stock: true, embedding: true },
        take : 500,
    })

    const ranked = candidates
        .map((p) => ({ p, score: cosineSim(qEmb, p.embedding as number[]) }))
        .sort((a, b) => b.score - a.score )
        .slice(0, k)
        .map(({p, score}) => ({...p, score }))

    if(ranked.length === 0 || ranked[0].score < 0.2){
        const toks = tokens(q)
        if(toks.length === 0) return []
        let items = await db.product.findMany({
            where: buildWhereAND(botId, toks),
            take: k,
            orderBy: { createdAt: "desc" },
        })
        if(items.length === 0){
            items = await db.product.findMany({
                where: buildWhereOR(botId, toks),
                take: k,
                orderBy: { createdAt: "desc" },
            })
        }
        return items.map((it) => ({ ...it, score: 0.0001 }))
    }
    return ranked
}

// Recaulcular y guardar los embeding de un producto
export async function refreshProductEmbedding(productId:string) {
    const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, sku: true, name: true, description: true } })
    if(!p) return null
    const input = productEmbeddingInput(p)
    const emb = await embedText(input)
    const saved = await db.product.update({ where: { id: p.id }, data: { embedding: emb } })
    return saved
}

// Lo uzamos para generar embeddings de todos los productos del bot
export async function refreshAllEmbeddings(botId:string) {
    const items = await db.product.findMany({ where: { chatbotId: botId }, select: { id: true, sku: true, name: true, description: true } })
    const out = []
    for(const it of items){
        const input = productEmbeddingInput(it)
        const emb = await embedText(input)
        const saved = await db.product.update({ where: { id: it.id }, data: { embedding: emb } })
        out.push(saved.id)
    }
    return out
}
