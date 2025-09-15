/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildGraph } from "@/ai/graph/graph";
import type { AgentState } from "@/ai/graph/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  var __compiledGraph: ReturnType<typeof buildGraph> | undefined;
}
function getGraph() {
  if (!global.__compiledGraph) global.__compiledGraph = buildGraph();
  return global.__compiledGraph!;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await params;
    const { text } = (await req.json()) as { text: string };
    if (!text?.trim()) return NextResponse.json({ error: "Texto vacío" }, { status: 400 });

    const chat = await db.chat.findUnique({ where: { id: chatId } });
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    // Guarda user message
    await db.message.create({ data: { chatId, role: "user", content: text.trim() } });

    // Ejecuta el grafo de LangGraph
    const graph = getGraph();
    const initial: AgentState = { chatId, userMessage: text.trim() } as any;
    const result = await graph.invoke(initial);

    const answer = result?.answer?.trim() || "¿Te ayudo con algo más?";
    const [assistantMessage] = await Promise.all([
      db.message.create({ data: { chatId, role: "assistant", content: answer }, select: { id: true, role: true, content: true, createdAt: true } }),
      (!chat.title || chat.title === "Nuevo chat") &&
        db.chat.update({ where: { id: chatId }, data: { title: text.slice(0, 40) } }),
    ]);

    return NextResponse.json({ message: assistantMessage });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
