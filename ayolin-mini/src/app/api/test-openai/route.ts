import { NextRequest, NextResponse } from "next/server";
import { openai } from '@ai-sdk/openai'
import { generateText } from "ai";

export async function POST(req: NextRequest){
    try{
        const { prompt } = await req.json()
        if(!prompt || typeof prompt !== "string"){
            return NextResponse.json({ error: "Prompt invalido "}, { status: 400});
        }

        const result = await generateText({
            model: openai('gpt-4.1-nano'),
            system: "Eres un asistente de prueba para AYOLIN.",
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            maxOutputTokens: 200,
        })
        const text = result.text?.trim?.() ?? "";
        return NextResponse.json({
            text: text || "(Respuesta sin texto)",
            usage: result.totalUsage,
        });
    } catch(e){
        console.error(e)
        return NextResponse.json({ error: "Error llamando a OpenAI" }, { status: 500 })
    }
}
