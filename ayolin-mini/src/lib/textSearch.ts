/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma, PrismaClient } from "@/generated/prisma"

function toOid(id: string): Prisma.InputJsonObject {
  return { $oid: id }
}

export type ProductHit = {
  id: string
  sku: string
  name: string
  description?: string | null
  priceCents: number
  stock: number
  score?: number
}

export async function searchProductsText(opts: {
  db: PrismaClient,
  botId: string,
  query: string,
  limit?: number,
  inStockOnly?: boolean,
}): Promise<ProductHit[]> {
  const { db, botId, query, limit = 8, inStockOnly = false } = opts
  try {
    // aggregateRaw para poder proyectar textScore y ordenar
    const pipeline: Prisma.InputJsonValue[] = [
      { $match: {
          chatbotId: toOid(botId),
          ...(inStockOnly ? { stock: { $gt: 0 } } : {}),
          $text: { $search: query, $language: "spanish" }
        }
      },
      { $addFields: { score: { $meta: "textScore" } } },
      { $sort: { score: -1 } },
      { $limit: limit },
      { $project: {
          _id: 1, sku: 1, name: 1, description: 1, priceCents: 1, stock: 1, score: 1
        }
      }
    ]

    const raw = await db.product.aggregateRaw({ pipeline })
    if (!Array.isArray(raw)) return []

    return raw.map((doc) => {
      const data = doc as Record<string, any>
      const rawId = data?._id
      const oid = typeof rawId === "object" && rawId !== null ? (rawId as Record<string, any>)?.$oid : undefined
      const fallbackId = rawId == null ? "" : String(rawId)

      return {
        id: oid ?? fallbackId,
        sku: data?.sku,
        name: data?.name,
        description: data?.description ?? null,
        priceCents: Number(data?.priceCents ?? 0),
        stock: Number(data?.stock ?? 0),
        score: typeof data?.score === "number" ? data.score : undefined,
      }
    })
  } catch (e: any) {
    // Si no hay índice de texto o error, devolvemos vacío (el caller puede hacer fallback)
    console.warn("[searchProductsText] error:", e?.message || e)
    return []
  }
}
