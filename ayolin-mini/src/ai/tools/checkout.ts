import { z } from "zod";
import type { Tool, ToolContext } from "./types";

// Helpers internos
async function getOrCreateOpenCart(ctx: ToolContext){
    const { db, botId, chatId } = ctx
    const found = await db.cart.findFirst({
        where: { chatbotId: botId, chatId, status: "open" },
        include: { items: true },
    })
    if(found) return found
    return db.cart.create({
        data: { 
            chatbotId: botId,
            chatId, 
            status: "open",
            subtotalCents: 0,
        },
        include: { items: true },
    })
}

async function recomputeSubtotal(db: ToolContext["db"], cartId: string){
    const items = await db.cartItem.findMany({ where: { cartId }})
    const subtotal = items.reduce((s, it) => s + it.priceCentsSnapshot * it.qty, 0)
    await db.cart.update({ where: { id: cartId }, data: { subtotalCents: subtotal } })
    return subtotal
}

// get_payment_method
export const getPaymentMethodsTool: Tool = {
    name: "get_payment_methods",
    description: "Obtiene los métodos de pago configurados por el dueño del bot. Devuelve claves ('cash','transfer','card') y etiquetas legibles.",
    inputSchema: z.object({}),
    async execute(_args, ctx){
        const bot = await ctx.db.chatbot.findFirst({
            where: { id: ctx.botId },
            select: { paymentMethods: true },
        })
        const methods: string[] = Array.isArray(bot?.paymentMethods) ? bot!.paymentMethods : []
        const labels: Record<string, string> = {
            cash: "Efectivo",
            transfer: "Transferencia",
            card: "Tarjeta",
        }
        return { methods, labels, human_readable: methods.map((m) => labels[m] ?? m) }
    }
}

// get_shipping_methods 
export const getShippingMethodsTool: Tool = {
    name: "get_shipping_methods",
    description: "Obtiene los métodos de envío/entrega configurados (domicilio, punto_medio, recoleccion) y su configuración (pickupAddress, pickupHours, meetupAreas).",
    inputSchema: z.object({}),
    async execute(_args, ctx){
        const bot = await ctx.db.chatbot.findFirst({
            where: { id: ctx.botId },
            select: { shippingMethods: true, shippingConfig: true }
        })

        const methods: string[] = Array.isArray(bot?.shippingMethods) ? bot!.shippingMethods : []
        const cfg = (bot?.shippingConfig ?? null) as | { pickupAddress?: string; pickupHours?: string; meetupAreas?: string[] } | null
        const labels: Record<string, string> = {
            domicilio: "Envio a domicilio", punto_medio: "Punto medio", recoleccion: "Recoleccion"
        }

        const hints: string[] = []
        if(methods.includes("recoleccion")){
            if(cfg?.pickupAddress) hints.push(`Recolección en ${cfg.pickupAddress}`)
            if(cfg?.pickupHours) hints.push(`Horario: ${cfg.pickupHours}`)
        }
        if(methods.includes("punto_medio") && Array.isArray(cfg?.meetupAreas) && cfg!.meetupAreas!.length){
            hints.push(`Puntos sugeridos: ${cfg!.meetupAreas!.join(", ")}`)
        }

        return {
            methods, labels, config: cfg, human_readable: methods.map((m) => labels[m] ?? m)
        }
    }
}

// card_add_item
export const cartAddItemTool: Tool = {
    name: "cart_add_item",
    description: "Agrega o actualiza un SKU en el carrito del chat actual. Valida stock y recalcula subtotal.",
    inputSchema: z.object({
        sku: z.string().min(1),
        qty: z.number().int().positive().max(20).default(1),
    }),
    async execute({ sku, qty }, ctx){
        const normSku = sku.toUpperCase().trim()
        const { db, botId } = ctx

        const product = await db.product.findUnique({
            where: { chatbotId_sku: { chatbotId: botId, sku: normSku } },
        })
        if(!product) return { ok: false, error: "El sku no existe" }
        if(qty <= 0) return { ok: false, error: "La cantidad es invalida"}
        if((product.stock ?? 0) < qty ){
            return { ok: false, error: "Stock insuficiente", available: product.stock ?? 0 }
        }

        const cart = await getOrCreateOpenCart(ctx)

        const existing = await db.cartItem.findFirst({
            where: { cartId: cart.id, sku: normSku },
        })

        if(existing){
            const newQty = existing.qty + qty
            if((product.stock ?? 0) < newQty){
                return { ok: false, error: "Stock insuficiente", available: product.stock ?? 0 }
            }
            await db.cartItem.update({
                where: { id: existing.id },
                data: { qty: newQty, priceCentsSnapshot: product.priceCents, nameSnapshot: product.name },
            })
        } else {
            await db.cartItem.create({
                data: {
                    cartId: cart.id,
                    productId: product.id,
                    sku: product.sku,
                    nameSnapshot: product.name,
                    priceCentsSnapshot: product.priceCents,
                    qty,
                },
            })
        }

        const subtotal = await recomputeSubtotal(db, cart.id)
        const update = await db.cart.findUnique({
            where: { id: cart.id },
            include: { items: true },
        })

        return { ok: true, cart: update, subtotal: subtotal }
    }
}

// cart_get
export const cartGetTool: Tool = {
    name: "cart_get",
    description: "Devuelce el carrito actual (crea uno si no existe).",
    inputSchema: z.object({}),
    async execute(_args, ctx){
        const cart = await getOrCreateOpenCart(ctx)
        return { ok: true, cart }
    }
}

// cart_set_payment_method
export const cartSetPaymentTool: Tool = {
    name: "cart_set_payment_method",
    description: "Fija el método de pago en el carrito (valida contra get_payment_methods).",
    inputSchema: z.object({ method: z.string().min(1) }),
    async execute({ method }, ctx ){
        const pm = await getPaymentMethodsTool.execute({}, ctx)
        const allowed = Array.isArray(pm.methods) ? pm.methods : []
        if(!allowed.includes(method)){
            return { ok: false, error: "Método de pago no disponible", allowed }
        }
        const cart = await getOrCreateOpenCart(ctx)
        const upd = await ctx.db.cart.update({
            where: { id: cart.id },
            data: { paymentMethod: method },
            include: { items: true },
        })
        return { ok: true, cart: upd }
    }
}

// cart_set_shipping_method
export const cartSetShippingTool: Tool = {
    name: "cart_set_shipping_method",
    description: "Fija el método de envío en el carrito (valida contra get_shipping_methods). Para 'domicilio' acepta 'address'.",
    inputSchema: z.object({
        method: z.string().min(1),
        address: z.string().optional(),
        meetup_area: z.string().optional(),
    }),
    async execute({ method, address, meetup_area }, ctx){
        const sm = await getShippingMethodsTool.execute({}, ctx)
        const allowed = Array.isArray(sm.methods) ? sm.methods : []
        if(!allowed.includes(method)){
            return { ok: false, error: "Método de entrega no disponible", allowed }
        }

        // Reglas de normalizacion
        let shippingAddress: string | null = null
        if(method === "domicilio"){
            shippingAddress = (address ?? "").trim() || null
        } else if (method === "punto_medio"){
            shippingAddress = meetup_area?.trim() ? `Punto medio: ${meetup_area.trim()}` : null
        } else if(method === "recoleccion"){
            shippingAddress = null
        }

        const cart = await getOrCreateOpenCart(ctx)
        const upd = await ctx.db.cart.update({
            where: { id: cart.id },
            data: { shippingMethod: method, shippingAddress },
            include: { items: true },
        })
        const normalized = method !== "domicilio" || !!shippingAddress
        return { ok: true, cart: upd, normalized }
    }
}

// cart_set_contact
export const cartSetContactTool: Tool = {
    name: "cart_set_contact",
    description: "Guarda datos de contacto (nombre, teléfono, notas) en el carrito.",
    inputSchema: z.object({
        name: z.string().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
    }),
    async execute({ name, phone, notes }, ctx){
        const cart = await getOrCreateOpenCart(ctx)
        const upd = await ctx.db.cart.update({
            where: { id: cart.id },
            data: {
                contactName: name?.trim() || cart.contactName || null,
                contactPhone: phone?.trim() || cart.contactPhone || null,
                notes: notes?.trim() || cart.notes || null,
            },
            include: { items: true },
        })
        return { ok: true, cart: upd }
    }
}

// checkout_submit
export const checkoutSubmitTool: Tool = {
    name: "checkout_submit",
    description: "Confirma el carrito: revalida stock, crea Sale y SaleItem[], descuenta stock y bloquea el carrito. Usa idempotencia si se repite.",
    inputSchema: z.object({
        confirm: z.boolean().default(true),
        idempotencyKey: z.string().optional(),
    }),
    async execute({ confirm, idempotencyKey }, ctx){
        if(!confirm) return { ok: false, error: "Falta confirmación" }
    
        const { db, botId, chatId } = ctx
        const openCart = await db.cart.findFirst({
            where: { chatbotId: botId, chatId, status: "open" },
            include: { items: true },
        })
        if(!openCart) return { ok: false, error: "No hay carrito abierto" }
        if(!openCart.items.length) return { ok: false, error: "El carrito está vacío" }

        // Validamos que existan datos minimos de checkout
        const missing: string[] = []
        if(!openCart.paymentMethod) missing.push("payment")
        if(!openCart.shippingMethod) missing.push("shipping")
        if(!openCart.contactName && !openCart.contactPhone) missing.push("contact")
        if(missing.length){
            return { ok: false, next_required: missing }
        }

        // Buscamos ventas recientes con la misma key
        if(idempotencyKey){
            const maybe = await db.sale.findFirst({
                where: { chatId, idempotencyKey },
                include: { items: true },
                orderBy: { createdAt: "desc" }
            })
            if(maybe){
                return { ok: true, sale: maybe, idempotent: true }
            }
        }

        // Revalidamos el stock -> crear Sale/SaleItem -> descontar stock -> ledger -> lock cart
        const result = await db.$transaction(async (tx) => {
            // Releer productos y validar stock para cada item
            for(const it of openCart.items){
                const p = await tx.product.findFirst({
                    where: { id: it.productId, chatbotId: botId },
                })
                if(!p) throw new Error(`Producto no encontrado: ${it.sku}`)
                if((p.stock ?? 0) < it.qty){
                    throw new Error(`Stock insuficiente en ${p.name}: disponible ${p.stock ?? 0}`)
                } 
            }

            const totalCents = openCart.items.reduce((s, it) => s + it.priceCentsSnapshot * it.qty, 0)
            const sale = await tx.sale.create({
                data: {
                    chatbotId: botId, 
                    chatId, 
                    status: "pending_payment",
                    totalCents,
                    paymentMethod: openCart.paymentMethod,
                    shippingMethod: openCart.shippingMethod,
                    shippingAddress: openCart.shippingAddress,
                    customerName: openCart.contactName,
                    customerPhone: openCart.contactPhone,
                    notes: openCart.notes,
                    idempotencyKey: idempotencyKey ?? null
                },
            })

            // item de la venta
            for(const it of openCart.items){
                await tx.saleItem.create({
                    data: {
                        saleId: sale.id,
                        productId: it.productId,
                        sku: it.sku,
                        nameSnapshot: it.nameSnapshot,
                        priceCentsSnapshot: it.priceCentsSnapshot,
                        qty: it.qty,
                    },
                })

                // Descontar stock de forma segura
                const dec = await tx.product.updateMany({
                    where: {
                        id: it.productId,
                        chatbotId: botId,
                        stock: { gte: it.qty },
                    },
                    data: { stock: { decrement: it.qty } },
                })
                if(dec.count !== 1){
                    throw new Error(`No se pudo descontar stock para ${it.sku}`)
                }

                await tx.inventoryLedger.create({
                    data: {
                        chatbotId: botId,
                        productId: it.productId,
                        delta: -it.qty,
                        reason: "sale",
                        ref: sale.id,
                    },
                })
            }
            await tx.cart.update({
                where: { id: openCart.id },
                data: { status: "locked" },
            })
            return sale
        })
        const saleWithItems = await ctx.db.sale.findUnique({
            where: { id: result.id },
            include: { items: true },
        })
        return { ok: true, sale: saleWithItems }
    }
}

/* para la transferencia
export const getPaymentInstructionsTool: Tool = {
  name: "get_payment_instructions",
  description:
    "Devuelve instrucciones de pago (CLABE, beneficiario, referencia) si el bot las tiene configuradas.",
  inputSchema: z.object({
    method: z.string().min(1),
  }),
  async execute({ method }, ctx) {
    const bot = await ctx.db.chatbot.findUnique({
      where: { id: ctx.botId },
      select: { paymentConfig: true, paymentMethods: true },
    })
    const methods = bot?.paymentMethods ?? []
    if (!methods.includes(method)) {
      return { ok: false, error: "Método no habilitado" }
    }
    const cfg = (bot?.paymentConfig ?? null) as
      | { transfer?: { clabe?: string; bank?: string; beneficiary?: string; referenceNote?: string } }
      | null
    if (method === "transfer" && cfg?.transfer) {
      return { ok: true, instructions: cfg.transfer }
    }
    return { ok: true, instructions: null }
  },
}
*/
