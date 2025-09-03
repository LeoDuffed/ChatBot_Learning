'use client'

import { 
  useEffect,
  useMemo,
  useRef,
  useState, 
} from "react"
import { 
  Card,
  CardContent,
 } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type Chat = { id: string; title?: string | null }
type Msg = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }

export default function ChatPage(){
  const [chats, setChats] = useState<Chat[]>([])
  const [activaChatId, setActiveChatId] = useState<string|null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

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

  // Cargar chats al abrir
  useEffect(() => {loadChats() }, [])

  //Si no hay chat activo seleccionamos el primero
  useEffect(() => {
    if(!activaChatId && chats.length > 0){
      setActiveChatId(chats[0].id)
    }
  }, [chats, activaChatId])

  // Cuando cambiemos a chat activo hay que cargar los mns
  useEffect(() => {
    if(activaChatId) loadMessages(activaChatId)
  }, [activaChatId])

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

  async function send(e: React.FormEvent){
    e.preventDefault()
    if(!input.trim()) return 
    setLoading(true)
  
    // Si no hay chat hay que crear uno
    let chatId = activaChatId
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

    // Llamamos a la API (guardamos user msg, llamamos a OpenAI y guardamos la resp
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

    // Recargar mensajes de la DB para reemplazar la optimizacion
    await loadMessages(chatId!)
    await loadChats()
  }

  const activeChatTitle = useMemo(
    () => chats.find(c => c.id === activaChatId)?.title ?? 'Nuevo chat',
    [chats, activaChatId]
  )

  return (
    <main className="grid min-h-screen grid-cols-12 bg-neutral-950 text-white">
      {/* Sidebar */}
      <aside className="col-span-3 border-r border-neutral-800 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold opacity-80">Chatbots</h2>
          <Button size="sm" variant="secondary" onClick={newChat}>+ Nuevo</Button>
        </div>

        <ScrollArea className="h-[calc(100vh-6rem)] pr-2">
          <div className="space-y-2">
            {chats.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border ${activaChatId === c.id ? 'border-blue-500 bg-blue-500/10': 'border-neutral-800 hover:bg-neutral-900'}`}>
                  <div className="truncate text-sm">{c.title || 'Sin titulo'}</div>
                </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* Chat */}
      <section className="col-span-9 p-6">
        <Card className="h-full bg-neutral-900 border-neutral-800 flex flex-col">
          <CardContent className="p-0 flex flex-col h-full">
            <div className="px-4 py-3 border-b border-neutral-800 text-sm opacity-80 text-white font-bold">
              {activeChatTitle}
            </div>
            
            <ScrollArea className="flex-1 px-4 py-4">
              <div className="space-y-3">
                {messages.map((m) => (
                  <div 
                    key={m.id}
                    className={`whitespace-pre-wrap leading-relaxed text-sm ${m.role === 'user' ? 'text-blue-300' : 'text-neutral-100' }`}
                  >
                    <span className="mr-2 text-xs opacity-60">
                      {m.role === 'user' ? 'Tu: ' : 'Ayolin: '}
                    </span>
                    {m.content}
                  </div>
                ))}
                <div ref={endRef} />
                {loading && <div className="text-neutral-400 text-sm">Ayolin escribiendo...</div>}
              </div>
            </ScrollArea>

            <form onSubmit={send} className="p-4 border-t border-neutral-800 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe papi..."
                className="bg-neutral-800 border-neutral-700 text-white"
              />
              <Button type="submit" disabled={loading || !activaChatId && !input.trim()} className="bg-white text-black border-black hover:bg-white/90">
                Enviar
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>

  )
}
