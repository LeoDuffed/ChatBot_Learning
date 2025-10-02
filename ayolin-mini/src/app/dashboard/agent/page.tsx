'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

type Chat = { id: string; title?: string | null }
type Msg = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }

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

type SaleItemDTO = {
  id: string
  sku: string
  nameSnapshot: string
  priceCentsSnapshot: number
  qty: number
}

type SaleDTO = {
  id: string
  status: "pending_payment" | "paid" | "cancelled"
  totalCents: number
  paymentMethod?: string | null
  shippingMethod?: string | null
  shippingAddress?: string | null
  customerName?: string | null
  customerPhone?: string | null
  notes?: string | null
  createdAt: string
  items: SaleItemDTO[]
}

const ALL_PAYMENT_METHODS = ["cash", "transfer", "card"] as const
const ALL_SHIPPING_METHODS = ["domicilio", "punto_medio", "recoleccion"] as const

export default function ChatPage(){
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string|null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const [sales, setSales] = useState<SaleDTO[]>([])
  const [adminPw, setAdminPw] = useState("")
  const [prodForm, setProdForm] = useState({ sku:"", name:"", priceCents:"", stock:""})
  const [intentForm, setIntentForm] = useState({ sku:"", qty: "" })
  const [, setBotSettings] = useState<BotSettings | null>(null)
  const [paySelection, setPaySelection] = useState<string[]>([])
  const [shipSelection, setShipSelection] = useState<string[]>([])
  const [pickupAddress, setPickupAddress] = useState<string>("")
  const [pickupHours, setPickupHours] = useState<string>("")
  const [meetupAreasText, setMeetupAreasText] = useState<string>("")
  const [sellerContact, setSellerContact] = useState<string>("")

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const pmLabel: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta" }
  const smLabel: Record<string, string> = {  domicilio: "Envío a domicilio", punto_medio: "Punto medio", recoleccion: "Recolección" }

  // Auto scroll 
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth'}) }, [messages])

  // Cargar lista de chats
  async function loadChats(){
    const r = await fetch('/api/chats')
    const data = await r.json()
    setChats(data.chats)
  }

  // Cargar mensajes del chat activo
  async function loadMessages(chatId: string){
    const r = await fetch(`/api/chats/${chatId}/messages`)
    const data = await r.json()
    setMessages(data.messages)
  }

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
  useEffect(() => {loadChats(); loadBotSettings(); }, [])

  // Si no hay chat activo, seleccionamos el primero
  useEffect(() => {
    if(!activeChatId && chats.length > 0){
      setActiveChatId(chats[0].id)
    }
  }, [chats, activeChatId])

  // Cuando cambiemos a chat activo, hay que cargar los mensajes
  useEffect(() => {
    if(activeChatId) loadMessages(activeChatId)
  }, [activeChatId])

  async function newChat(){
    const r = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({ title: 'Nuevo chat'}),
    })
    const data = await r.json().catch(async () => ({ __raw: await r.text() }))

    if(!r.ok || !data?.chat?.id){
      console.error('POST /api/chats fallo: ', data)
      return
    }
    await loadChats()
    setActiveChatId(data.chat.id)
    setMessages([])
  }

  async function deleteChat(chatId: string){
    const r = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' })
    if(!r.ok){
      console.error('DELETE /api/chats/[id] falló')
      return
    }

    // Actualización optimista + reajuste del chat activo si aplica
    setChats(prev => {
      const remaining = prev.filter(c => c.id !== chatId)
      if(activeChatId === chatId){
        const next = remaining[0]?.id ?? null
        setActiveChatId(next)
        setMessages([])
      }
      return remaining
    })
  }

  async function send(e: FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(!input.trim()) return 
    setLoading(true)
  
    // Si no hay chat hay que crear uno
    let chatId = activeChatId
    if(!chatId){
      const r = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await r.json()
      chatId = data.chat.id
      setActiveChatId(chatId)
      await loadChats()
    }

    const text = input
    setInput('')
    // Añadimos el mensaje de el usuario en UI (optimizacion)
    setMessages(prev => [...prev, {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }])

    // Llamada API
    const r = await fetch(`/api/chats/${chatId}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    setLoading(false)
    if(!r.ok){
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: 'Ocurrió un error al enviar el mensaje.',
        createdAt: new Date().toISOString(),
      }])
      return
    }

    // Recargar mensajes de la DB
    await loadMessages(chatId!)
    await loadChats()
    await loadPendingSales()
  }

  const activeChatTitle = useMemo(
    () => chats.find(c => c.id === activeChatId)?.title ?? 'Nuevo chat',
    [chats, activeChatId]
  )

  const loadPendingSales = useCallback(async () => {
    const r = await fetch("/api/sales/admin?status=pending_payment")
    if(!r.ok) return
    const data = await r.json()
    setSales(data.items ?? [])
  }, [])

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
    <div className="h-full w-full">
      <div className="grid h-full w-full grid-cols-12">
        {/* Sidebar (scrollable) */}
        <aside className="col-span-3 h-[100dvh] border-r border-neutral-800 bg-neutral-950/60 backdrop-blur flex flex-col">
          {/* Header del aside (fijo) */}
          <div className="p-4 border-b border-neutral-800">
            <Button size="sm" variant="secondary" onClick={newChat} className="w-full">+ Nuevo</Button>
          </div>

          {/* Contenido del aside con scroll propio */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-6">
              {/* Configuracion de Pago y Envio */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white/80">Cobro y Pago</h3>

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
                      <div className="text-xs opacity-75">Tu contacto</div>
                      <Input
                        placeholder="Ej. +52 55 1234 5678"
                        value={sellerContact}
                        onChange={(e) => setSellerContact(e.target.value)}
                        className="bg-neutral-800 border-neutral-700 text-white"
                      />
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
              
              {/* Ventas Panel */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white/80">Ventas Panel</h3>

                <div className="space-y-2">
                  <div className="text-xs opacity-70">Contraseña del jefe</div>
                  <Input 
                    type="password" 
                    value={adminPw} 
                    onChange={(e) => setAdminPw(e.target.value)} 
                    placeholder="Mínimo 4 caracteres" 
                    className="bg-neutral-800 border-neutral-700 text-white"
                  />
                  <Button
                    size="sm"
                    onClick={async() => {
                      const r = await fetch("/api/my-bot/settings/sales-password",{
                        method: "PUT",
                        headers: {"Content-Type":"application/json"},
                        body: JSON.stringify({password: adminPw})
                      })
                      alert(r.ok ? "Contraseña guardada" : "Error al guardar la contraseña")
                    }}
                    className="bg-white text-black hover:bg-white/90"
                  >
                    Guardar Contraseña
                  </Button>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="text-xs opacity-70">Nuevo producto</div>
                  <Input placeholder="SKU" value={prodForm.sku} onChange={(e) => setProdForm(p => ({ ...p, sku:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                  <Input placeholder="Nombre" value={prodForm.name} onChange={(e) => setProdForm(p => ({ ...p, name:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                  <Input placeholder="Precio (centavos)" value={prodForm.priceCents} onChange={(e) => setProdForm(p => ({ ...p, priceCents:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                  <Input placeholder="Stock" value={prodForm.stock} onChange={(e) => setProdForm(p => ({ ...p, stock:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                  <Button 
                    size="sm"
                    onClick={async() => {
                      const r = await fetch("/api/products", {
                        method: "POST",
                        headers: {"Content-Type":"application/json"},
                        body: JSON.stringify({
                          sku: prodForm.sku,
                          name: prodForm.name,
                          priceCents: Number(prodForm.priceCents||0),
                          stock: Number(prodForm.stock||0),
                        }),
                      })
                      alert(r.ok ? "Producto guardado" : "Error guardando producto")
                      if(r.ok) setProdForm({ sku: "", name:"", priceCents:"", stock:""})
                    }}
                    className="bg-blue-500 text-black hover:bg-blue-400"
                  >
                    Guardar Producto
                  </Button>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="text-sm opacity-70">Intentar venta</div>
                  <Input placeholder="SKU" value={intentForm.sku} onChange={(e)=>setIntentForm(p=>({...p, sku:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white"/>
                  <Input placeholder="Cantidad" value={intentForm.qty} onChange={(e)=>setIntentForm(p=>({...p, qty:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white"/>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={async() => {
                        const r = await fetch("/api/sales/intent", {
                          method: "POST",
                          headers: {"Content-Type":"application/json"},
                          body: JSON.stringify({sku: intentForm.sku, qty: Number(intentForm.qty||1)}),
                        })
                        const data = await r.json()
                        alert(data.prompt ?? (data.error || "Respuesta sin prompt"))
                      }}
                      className="bg-emerald-500 text-black hover:bg-emerald-400"
                    >
                      Probar intento
                    </Button>
                    <Button
                      size="sm"
                      onClick={async() => {
                        const r = await fetch("/api/sales/confirm",{
                          method: "POST",
                          headers: {"Content-Type":"application/json"},
                          body: JSON.stringify({
                            sku: intentForm.sku,
                            qty: Number(intentForm.qty||1),
                            paymentMethod: "cash",
                            chatId: activeChatId,
                          }),
                        })
                        const data = await r.json()
                        alert(data.prompt ?? (data.error || "Respuesta sin prompt"))
                        await loadPendingSales()
                      }}
                      className="bg-amber-600 text-black hover:bg-amber-500"
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>

                {/* Pendientes por pago */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs opacity-70">Pendientes por pago</div>
                    <Button size="sm" variant="secondary" onClick={loadPendingSales}>Refrescar</Button>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-auto pr-1">
                    {sales.length === 0 && <div className="text-xs text-white/60">Sin Pendientes</div>}
                    {sales.map((s) => (
                      <div key={s.id} className="border border-neutral-800 rounded p-2 text-sm space-y-2 bg-neutral-900/50">
                        <div className="flex items-start justify-between pag-2">
                          <div className="font-medium">
                            Venta <span className="opacity-60">#{s.id.slice(-6)}</span>
                          </div>
                          <div className="opcatity-60">{new Date(s.createdAt).toLocaleDateString()}</div>
                        </div>

                        {/* Items */}
                        <div className="space-y-1">
                          {s.items.map((it) => (
                            <div key={it.id} className="flex items-center justify-between">
                              <div className="truncate">
                                {it.qty} x {it.nameSnapshot} <span className="opacity-60">({it.sku})</span>
                              </div>
                              <div className="tabular-nums opacity-80">{money(it.priceCentsSnapshot)} c/u</div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div className="text-xs opacity-70">Total</div>
                          <div className="font-semibold tabular-nums">{money(s.totalCents)}</div>
                        </div>

                        {/* Datos del checkoput */}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="opacity-80">
                            <div className="opacity-60">Pago</div>
                            <div className="font-medium">{s.paymentMethod ? (pmLabel[s.paymentMethod] ?? s.paymentMethod) : "-"}</div>
                          </div>
                          <div className="opacity-80">
                            <div className="opacity-60">Entrega</div>
                            <div className="font-medium">
                              {s.shippingMethod ? (smLabel[s.shippingMethod] ?? s.shippingMethod) : "-"}
                            </div>
                            {s.shippingAddress && <div className="opacity-70">{s.shippingAddress}</div>}
                          </div>
                          <div className="opacity-80">
                            <div className="opacity-60">Cliente</div>
                            <div className="font-medium">{s.customerName || "-"}</div>
                            {s.customerPhone && <div className="opacity-70">{s.customerPhone}</div>}
                          </div>
                          <div className="opacity-80">
                            <div className="opacity-60">Estado</div>
                            <div className="font-medium">{s.status}</div>
                          </div>
                        </div>

                        {/* Acciones */}
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="bg-emerald-600 text-black hover:bg-emerald-500"
                            onClick={async () => {
                              const r = await fetch(`/api/sales/${s.id}/mark-paid`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ password: adminPw }),
                              })
                              if(!r.ok) { alert("Contraseña inválida o error"); return }
                              await loadPendingSales()
                            }}
                          >
                            Marcar Pagada
                          </Button>

                          <Button 
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              const r = await fetch(`/api/sales/${s.id}/cancel`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ password: adminPw })
                              })
                              if(!r.ok){ alert("Contraseña inválida o error"); return }
                              await loadPendingSales()
                            }}
                          >
                            Cancelar
                          </Button>
                        </div>

                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Lista de chats */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white/80">Chats</h3>
                <div className="space-y-2">
                  {chats.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveChatId(c.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                          activeChatId === c.id
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-neutral-800 hover:bg-neutral-900'
                        }`}>
                        <div className="truncate text-sm">{c.title || 'Sin título'}</div>
                      </button>

                      <Button
                        size="icon"
                        variant="destructive"
                        className="border-neutral-800 bg-red-400 text-black hover:bg-red-300"
                        onClick={() => deleteChat(c.id)}
                        title="Eliminar chat"
                      >
                        X
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </aside>


        {/* Chat (min-h-screen y con su propio scroll en mensajes) */}
        <section className="col-span-9 flex h-full flex-col overflow-hidden">
          {/* Header fijo */}
          <div className="shrink-0 px-4 py-3 border-b border-neutral-800 text-2xl opacity-80 text-white font-bold bg-neutral-900/80 backdrop-blur">
            {activeChatTitle}
          </div>

          {/* Mensajes (SOLO esto scrollea) */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-4 py-4 space-y-3">
                {messages.map((m) => (
                  <div 
                    key={m.id}
                    className={`whitespace-pre-wrap leading-relaxed text-sm ${
                      m.role === 'user' ? 'text-blue-300' : 'text-neutral-100'
                    }`}
                  >
                    <span className="mr-2 text-xs opacity-60">
                      {m.role === 'user' ? 'Tú:' : 'Ayolin:'}
                    </span>
                    {m.content}
                  </div>
                ))}
                <div ref={endRef} />
                {loading && <div className="text-neutral-400 text-sm">Ayolin escribiendo...</div>}
              </div>
            </ScrollArea>
          </div>

          {/* Input fijo abajo */}
          <form onSubmit={send} className="shrink-0 p-4 border-t border-neutral-800 bg-neutral-900/80 backdrop-blur">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe aquí…"
                className="bg-neutral-800 border-neutral-700 text-white"
              />
              <Button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-white text-black border-black hover:bg-white/90"
              >
                Enviar
              </Button>
            </div>
            <div className="pt-2 text-[11px] text-neutral-400">
              Enter para enviar • Shift+Enter para nueva línea
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
