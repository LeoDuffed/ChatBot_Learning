/* eslint-disable @typescript-eslint/no-unused-vars */

import { NextRequest, NextResponse } from "next/server";
import { getOrCreateMyBot } from "@/lib/bot";
import { refreshAllEmbeddings } from "@/lib/search";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_req: NextRequest) {
    const bot = await getOrCreateMyBot()
    const ids = await refreshAllEmbeddings(bot.id)
    return NextResponse.json({ ok: true, count: ids.length })
}