import { openai } from "@ai-sdk/openai";

// Modelos base que vamos a usar
export const chatModelId = "gpt-4.1-nano"
export const embeddingModelId = "text-embedding-3-small"

// Helper para centralizar id's
export const models = {
    chat: () => openai(chatModelId),
    embedding: () => openai.embedding(embeddingModelId),
}

