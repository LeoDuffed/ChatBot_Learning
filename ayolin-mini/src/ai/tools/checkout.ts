import { z } from "zod";
import type { Tool } from "./types";

const inputSchema = z.object({})

// Devuelve los metodos de pago configurados para el bot

export const getPaymentMethodsTool: Tool<typeof inputSchema> = {
    name: "get_payment_methods",
    description: "Obtiene los métodos de pago configurados por el dueño del bot. Devuelve las claves ('cash','transfer','card') y etiquetas legibles.",
    inputSchema,
    async execute(_args, ctx){
        const bot = await ctx.db.chatbot.findFirst({
            where: { id: ctx.botId },
            select: { paymentMethods: true },
        })

        const methods: string[] = Array.isArray(bot?.paymentMethods) ? bot!.paymentMethods : []

        // Mapeo a etiquetas legibles 
        const labels: Record<string, string> = {
            cash: "Efectivo",
            transfer: "Transferencia",
            card: "Tarjeta",
        }
        
        return {
            methods,
            labels,
            human_readable: methods.map((m) => labels[m] ?? m),
        }
    },
}

// Devuelve los metodos de envio/entrega configurados junto con la config
export const getShippingMethodsTool: Tool<typeof inputSchema> = {
    name: "get_shipping_methods",
    description: "Obtiene los métodos de envío/entrega configurados (domicilio, punto_medio, recoleccion) y su configuración (pickupAddress, pickupHours, meetupAreas).",
    inputSchema,
    async execute(_args, ctx){
        const bot = await ctx.db.chatbot.findFirst({
            where: { id: ctx.botId },
            select: { shippingMethods: true, shippingConfig: true },
        })

        const methods: string[] = Array.isArray(bot?.shippingMethods) ? bot!.shippingMethods : []
        const cfg = (bot?.shippingConfig ?? null) as | {
            pickupAddress? : string;
            pickupHours?: string;
            meetupAreas?: string[]
        } | null

        const labels: Record<string, string> = {
            domicilio: "Envío a domicilio",
            punto_medio: "Punto medio",
            recoleccion: "Recolección",        
        }

        // Armar pequeños hints legibles a partir de la config
        const hints: string[] = []
        if(methods.includes("recoleccion")){
            if(cfg?.pickupAddress) hints.push(`Recolección en ${cfg.pickupAddress}`)
            if(cfg?.pickupHours) hints.push(`Horario: ${cfg.pickupHours}`)
        }
        if(methods.includes("punto_medio") && Array.isArray(cfg?.meetupAreas) && cfg!.meetupAreas!.length){
            hints.push(`Puntos sugeridos: ${cfg!.meetupAreas!.join(", ")}`)
        }

        return{
            methods,
            labels,
            config: cfg,
            human_readable: methods.map((m) => labels[m] ?? m),
        }
    },
}