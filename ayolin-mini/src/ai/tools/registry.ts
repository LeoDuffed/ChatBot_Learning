/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Tool } from "./types";
import { zodToJsonSchema } from "zod-to-json-schema";
import { searchInventoryTool, getBySkuTool, checkStockTool, productsSearchTool } from "./inventory";
import type { ZodTypeAny } from "zod";

// Use `any` to erase generic variance across different tool input schemas
export const tools: Tool<any, any>[] = [
    searchInventoryTool,
    getBySkuTool,
    checkStockTool,
    productsSearchTool,
]

function toOpenAIParams(schema: ZodTypeAny, name: string){
    const js = zodToJsonSchema(schema, name)
    const unwrapped = (js as any).definitions?.[name] ?? js
    if(!unwrapped.type) unwrapped.type = "object"
    if("$schema" in unwrapped) delete (unwrapped as any).$schema
    return unwrapped
}

export function getOpenAIFunctions(){
    const INVALID = /[^A-Za-z0-9_-]/
    return tools.map((t) => {
        if(INVALID.test(t.name)){
            throw new Error(`Invalid tool name "${t.name}". Use only letters, numbers, "-" and "_".`)
        }
        return {
            name: t.name,
            description: t.description,
            parameters: toOpenAIParams(t.inputSchema, t.name),
        }
    })
}

export async function dispatchToolCall(name: string, args: unknown, ctx: any){
    const tool = tools.find((t) => t.name === name)
    if(!tool) throw new Error(`Tool no registrada: ${name}`)
    const parsed = tool.inputSchema.parse(args)
    return tool.execute(parsed, ctx)
}
