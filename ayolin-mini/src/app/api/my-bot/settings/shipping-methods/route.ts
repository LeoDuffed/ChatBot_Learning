/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateMyBot } from "@/lib/bot";

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(req: NextRequest){
    try{
        const bot = await getOrCreateMyBot()
        const body = await req.json().catch(() => ({}))
        let methods: any = body?.methods
        const cfg = body?.config ?? {}

        if(!Array.isArray(methods)) methods = []
        methods = methods.map((m: any) => String(m || "").trim().toLowerCase()).filter((m: string) => m.length > 0)

        // Validacion simple
        const allowed = new Set(["domicilio", "punto_medio", "recoleccion"])
        methods = methods.filter((m: string) => allowed.has(m))

        // Normalizar config
        const shippingConfig: any = {}
        if(typeof cfg.pickupAddress === "string" && cfg.pickupAddress.trim()){
            shippingConfig.pickupAddress = cfg.pickupAddress.trim()
        }
        if(typeof cfg.pickupHours === "string" && cfg.pickupHours.trim()){
            shippingConfig.pickupHours = cfg.pickupHours.trim()
        }
        if(Array.isArray(cfg.meetupAreas)){
            const areas = cfg.meetupAreas.map((s: any) => String(s || "").trim()).filter((s: any) => s.length > 0)
            if(areas.length) shippingConfig.meetupAreas = areas
        }
        if(typeof cfg.sellerContact === "string" && cfg.sellerContact.trim()){
            shippingConfig.sellerContact = cfg.sellerContact.trim()
        }

        const update = await db.chatbot.update({
            where: { id: bot.id },
            data: { shippingMethods: methods, shippingConfig: Object.keys(shippingConfig).length ? shippingConfig : null },
            select: { id: true, shippingMethods: true, shippingConfig: true },
        })

        return NextResponse.json({ ok: true, bot: update })
    } catch(e) {
        console.error(e)
        return NextResponse.json({ error: "Server error" }, { status: 500 })
    }
}

export async function GET(){
    try{
        const bot = await getOrCreateMyBot()
        const fresh = await db.chatbot.findFirst({
            where: { id: bot.id },
            select: { id: true, shippingMethods: true, shippingConfig: true },
        })
        return NextResponse.json({ ok: true, bot: fresh })
    } catch(e) {
        console.error(e)
        return NextResponse.json({ error: "Server error" }, { status: 500 })
    }
}