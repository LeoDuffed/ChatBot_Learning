'use client'

import {
  useEffect,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type BotSettings = {
  id: string
  name: string
  paymentMethods?: string[] | null
  shippingMethods?: string[] | null
  shippingConfig?: {
    pickupAddress?: string | null
    pickupHours?: string | null
    meetupAreas?: string[] | null
    sellerContact?: string | null
  } | null
}

const ALL_PAYMENT_METHODS = ["cash", "transfer", "card"] as const
const ALL_SHIPPING_METHODS = ["domicilio", "punto_medio", "recoleccion"] as const

export default function ChatPage(){
  const [, setBotSettings] = useState<BotSettings | null>(null)
  const [paySelection, setPaySelection] = useState<string[]>([])
  const [shipSelection, setShipSelection] = useState<string[]>([])
  const [pickupAddress, setPickupAddress] = useState<string>("")
  const [pickupHours, setPickupHours] = useState<string>("")
  const [meetupAreasText, setMeetupAreasText] = useState<string>("")
  const [sellerContact, setSellerContact] = useState<string>("")

  // Cargar settings del bot
  async function loadBotSettings() {
    const r = await fetch('/api/my-bot')
    if(!r.ok)return 
    const data = await r.json()
    const b: BotSettings = data.bot
    setBotSettings(b)
    const payments = (b.paymentMethods ?? []) as string[]
    const shippings = (b.shippingMethods ?? []) as string[]
    setPaySelection(payments)
    setShipSelection(shippings)
    setPickupAddress(b.shippingConfig?.pickupAddress ?? "")
    setPickupHours(b.shippingConfig?.pickupHours ?? "")
    setMeetupAreasText((b.shippingConfig?.meetupAreas ?? []).join(", "))
    setSellerContact(b.shippingConfig?.sellerContact ?? "")
  }

  // Cargar chats al abrir
  useEffect(() => {loadBotSettings(); }, [])

  // Helpers toggle
  function toggleInSelection(list: string[], value: string){
    return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
  }

  async function savePaymentMethods(){
    const r = await fetch("/api/my-bot/settings/payment-methods", {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ methods: paySelection })
    })
    alert(r.ok ? "Metodos de pago guardados" : "Error guardadndo metodos de pago")
    if(r.ok) loadBotSettings()
  }

  async function saveShippingMethods() {
    const config = {
      pickupAddress: pickupAddress || null,
      pickupHours: pickupHours || null,
      meetupAreas: meetupAreasText.split(",").map(s => s.trim()).filter(Boolean),
      sellerContact: sellerContact || null,
    }
    const r = await fetch("/api/my-bot/settings/shipping-methods", {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ methods: shipSelection, config }),
    })
    alert(r.ok ? "Metodos de envio/entrega guardados" : "Error guardando metodo de envio/entrega")
    if(r.ok) loadBotSettings()
  }

    return (
        <>
        <h1 className="text-2xl text-white pb-10">Metodos de pago y entrega</h1>
          <div className="grid h-full min-h-0 w-full grid-cols-1 gap-10 md:grid-cols-2">
            <section>
                {/* Metodos de envio */}
                <div className="space-y-2 border border-neutral-800 rounded-lg p-3 bg-neutral-900/40">
                    <div className="text-xs opacity-70 mb-1">Metodos de Entrega eceptados</div>
                    <div className="flex flex-col gap-2">
                      {ALL_SHIPPING_METHODS.map((m) => (
                        <label key={m} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={shipSelection.includes(m)} onChange={() => setShipSelection(prev => toggleInSelection(prev, m))}/>
                          <span className="capitalize">
                            {m === "domicilio" ? "Envio a domicilio" : m === "punto_medio" ? "Punto medio" : "Recoleccion"}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Config extras */}
                    <div className="mt-3 space-y-2">  
                      <div className="text-xs opacity-75">Direccion de recolecion</div>
                      <Input
                        placeholder="Ej. Av. Siempre Viva 123"
                        value={pickupAddress}
                        onChange={(e) => setPickupAddress(e.target.value)}
                        className="bg-neutral-800 border-neutral-700 text-white"
                      />

                      <div className="text-xs opacity-70">Horario de recolección (si aplica)</div>
                      <Input
                        placeholder="Ej. Lun-Vie 10am-6pm"
                        value={pickupHours}
                        onChange={(e) => setPickupHours(e.target.value)}
                        className="bg-neutral-800 border-neutral-700 text-white"
                      />

                      <div className="text-xs opacity-70">Zonas sugeridas para punto medio (separadas por coma)</div>
                      <Textarea
                        placeholder="Ej. Centro, Plaza X, Metro Y"
                        value={meetupAreasText}
                        onChange={(e) => setMeetupAreasText(e.target.value)}
                        className="bg-neutral-800 border-neutral-700 text-white min-h-[70px]"
                      /> 
                    </div>

                    <div className="pt-2">
                      <Button size="sm" onClick={saveShippingMethods} className="bg-white text-black hover:bg-white/90">
                        Guardar Envio/Entrega
                      </Button>
                    </div>
                </div>
            </section>

            <section>
                    {/* Metodos de pago */}
                    <div className="space-y-2 border border-neutral-800 rounded-lg p-3 bg-neutral-900/40">
                    <div className="text-xs opacity-70 mb-1">Metodos de pago aceptados</div>
                    <div className="flex flex-col gap-2">
                        {ALL_PAYMENT_METHODS.map((m) => (
                        <label key={m} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={paySelection.includes(m)} onChange={() => setPaySelection(prev => toggleInSelection(prev, m))}/>
                            <span className="capitalize">{m === "cash" ? "efectivo" : m === "transfer" ? "transferencia" : "tarjeta"} </span>
                        </label>
                        ))}
                    </div>
                    <div className="pt-2">
                        <Button size='sm' onClick={savePaymentMethods} className="bg-white text-black hover:bg-white/90">
                        Guardar metodos de pago</Button>
                    </div>
                    </div>

                    <div className=" pt-15">
                        <div className="text-xs opacity-75">Tu contacto</div>
                        <Input
                            placeholder="Ej. +52 55 1234 5678"
                            value={sellerContact}
                            onChange={(e) => setSellerContact(e.target.value)}
                            className="bg-neutral-800 border-neutral-700 text-white"
                        />
                    </div>
            </section>
          </div>
        </>
    )
}