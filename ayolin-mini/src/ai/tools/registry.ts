/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Tool } from "./types";
import { zodToJsonSchema } from "zod-to-json-schema";
import { searchInventoryTool, getBySkuTool, checkStockTool } from "./inventory";

// Use `any` to erase generic variance across different tool input schemas
export const tools: Tool<any, any>[] = [
    searchInventoryTool,
    getBySkuTool,
    checkStockTool,
]

export function getOpenAIFunctions(){
    return tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema, t.name),
    }))
}

export async function dispatchToolCall(name: string, args: unknown, ctx: any){
    const tool = tools.find((t) => t.name === name)
    if(!tool) throw new Error(`Tool no registrada: ${name}`)
    const parsed = tool.inputSchema.parse(args)
    return tool.execute(parsed, ctx)
}
