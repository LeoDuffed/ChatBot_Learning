import { embed } from "ai";
import { models } from "./llm";

export function productEmbeddingInput(p: { sku: string; name: string; description?: string | null }){
    return `SKU: ${p.sku}\nNombre: ${p.name}\nDescripción: ${p.description ?? ""}`.trim()
}

export async function embedText(value: string): Promise<number[]>{
    const { embedding } = await embed({
        model: models.embedding(),
        value,
    })
    return Array.from(embedding)
}

export function cosineSim(a : number[], b: number[]): number {
    if(!a?.length || !b?.length || a.length !== b.length) return 0
    let dot = 0, na = 0, nb = 0
    for(let i = 0; i < a.length; i++){
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}