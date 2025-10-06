'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

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

export default function ChatPage(){
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string|null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const [, setBotSettings] = useState<BotSettings | null>(null)

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
  }

  const activeChatTitle = useMemo(
    () => chats.find(c => c.id === activeChatId)?.title ?? 'Nuevo chat',
    [chats, activeChatId]
  )

  return (
    <div className="flex h-full w-full flex-1 overflow-hidden">
      <div className="grid h-full min-h-0 w-full grid-cols-12">
        {/* Sidebar (scrollable) */}
        <aside className="col-span-3 flex h-full min-h-0 flex-col border-r border-neutral-800 bg-neutral-950/60 backdrop-blur">
          {/* Header del aside (fijo) */}
          <div className="p-4 border-b border-neutral-800">
            <Button size="sm" variant="secondary" onClick={newChat} className="w-full">+ Nuevo</Button>
          </div>

          {/* Contenido del aside con scroll propio */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 space-y-6">

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
        <section className="col-span-9 flex h-full min-h-0 flex-col overflow-hidden">
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
