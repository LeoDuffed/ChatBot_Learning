/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod"

export type ToolContext = {
    db: typeof import("@/lib/db").db
    botId: string
    chatId: string
    userId?: string | null    
}

export type Tool<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = any> = {
    name: string
    description: string
    inputSchema: TInput
    execute: ( args: z.infer<TInput>, ctx: ToolContext ) => Promise<TOutput>
}