/* eslint-disable @typescript-eslint/no-explicit-any */

import { PrismaClient } from "@prisma/client"

type CreateIndexesCommand = {
  createIndexes: string,
  indexes: Array<{
    key: Record<string, "text">,
    name: string,
    default_language?: string,
    weights?: Record<string, number>
  }>
}

export async function ensureProductTextIndex(db: PrismaClient) {
  // Solo puede existir **un** índice de texto por colección.
  // Hacemos idempotente: si ya existe, no truena.
  try {
    // Revisar índices actuales
    const list = await db.$runCommandRaw({
      listIndexes: "Product"
    } as any) as any

    const hasText = Array.isArray(list?.cursor?.firstBatch)
      && list.cursor.firstBatch.some((idx: any) => {
        // Un índice de texto tiene value "text" en sus claves
        return idx?.key && Object.values(idx.key).some((v: any) => v === "text")
      })

    if (hasText) return

    // Crear índice de texto: name, description, sku con pesos
    const cmd: CreateIndexesCommand = {
      createIndexes: "Product",
      indexes: [{
        key: { name: "text", description: "text", sku: "text" },
        name: "product_text_idx",
        default_language: "spanish",
        weights: {
          // priorizamos SKU y name
          sku: 20,
          name: 20,
          description: 5,
        }
      }]
    }
    await db.$runCommandRaw(cmd as any)
  } catch (e) {
    // Si la base no es Mongo o no soporta, ignoramos silencioso.
    console.warn("[ensureProductTextIndex] warning:", e)
  }
}
