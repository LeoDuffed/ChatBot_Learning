import { NextRequest, NextResponse } from "next/server";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req:NextRequest) {
    const bot = await getOrCreateMyBot()
    return NextResponse.json({bot})   
}