'use client'

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ChevronLeft, ChevronRight } from "lucide-react"

type Product = {
  id: string
  sku: string
  name: string
  priceCents: number
  stock: number
}

export default function Inventario(){
    const [prodForm, setProdForm] = useState({ sku:"", name:"", priceCents:"", stock:""})
    const [items, setItems] = useState<Product[]>([])
    const [loading, setLoading] = useState(false)
    const [intentForm, setIntentForm] = useState({ sku:"", qty: "" })
    const [q] = useState("")
    const [page, setPage] = useState(1)
    const pageSize = 6
    const [total, setTotal] = useState(0)

  const money = (cents: number) =>
    (cents/100).toLocaleString("es-MX", { style:"currency", currency:"MXN" })

  // construir URL con search/paginación
  const url = useMemo(() => {
    const u = new URL("/api/products", window.location.origin)
    if(q.trim().length >= 2) {
      u.searchParams.set("q", q.trim())
      u.searchParams.set("pageSize", String(pageSize))
      // cuando hay q, tu API ignora paginación (devuelve top-N)
    } else {
      u.searchParams.set("page", String(page))
      u.searchParams.set("pageSize", String(pageSize))
    }
    return u.toString()
  }, [q, page, pageSize])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(url, { cache: "no-store" })
      const data = await r.json()
      const list: Product[] = data.items ?? []
      setItems(list.slice(0, pageSize))
      setTotal(typeof data.total === "number" ? data.total : list.length)
      // si hay búsqueda, la API fija page=1, sincronizamos para UI
      if(q.trim().length >= 2) setPage(1)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [url]) // recarga al cambiar q/page

  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, maxPage)

  return (
    <>
      <h1 className="mb-2 text-lg font-semibold tracking-tight">Inventario</h1>

      <div className="grid min-h-0 w-full grid-cols-1 gap-6 md:grid-cols-2">
        {/* Izquierda: nuevo producto */}
        <section>
          <Card className="bg-neutral-900 border-neutral-800 pt-8">
            <CardHeader>
              <CardTitle className="text-white">Nuevo producto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="SKU" value={prodForm.sku}
                onChange={(e)=>setProdForm(p=>({...p, sku:e.target.value}))}
                className="bg-neutral-800 border-neutral-700 text-white" />
              <Input placeholder="Nombre" value={prodForm.name}
                onChange={(e)=>setProdForm(p=>({...p, name:e.target.value}))}
                className="bg-neutral-800 border-neutral-700 text-white" />
              <Input placeholder="Precio (centavos)" value={prodForm.priceCents}
                onChange={(e)=>setProdForm(p=>({...p, priceCents:e.target.value}))}
                className="bg-neutral-800 border-neutral-700 text-white" />
              <Input placeholder="Stock" value={prodForm.stock}
                onChange={(e)=>setProdForm(p=>({...p, stock:e.target.value}))}
                className="bg-neutral-800 border-neutral-700 text-white" />

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={async () => {
                    const r = await fetch("/api/products", {
                      method: "POST",
                      headers: {"Content-Type":"application/json"},
                      body: JSON.stringify({
                        sku: prodForm.sku.trim(),
                        name: prodForm.name.trim(),
                        priceCents: Number(prodForm.priceCents||0),
                        stock: Number(prodForm.stock||0),
                      }),
                    })
                    alert(r.ok ? "Producto guardado" : "Error guardando producto")
                    if(r.ok){
                      setProdForm({ sku: "", name:"", priceCents:"", stock:""})
                      await load()
                    }
                  }}
                  className="bg-blue-500 text-black hover:bg-blue-400"
                >
                  Guardar Producto
                </Button>

              </div>
            </CardContent>
          </Card>

            <Card className="bg-neutral-900 border-neutral-800 p-5 mt-5">
                <div className="space-y-2 pt-1">
                  <div className="text-sm text-white">Intentar venta</div>
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
                          }),
                        })
                        const data = await r.json()
                        alert(data.prompt ?? (data.error || "Respuesta sin prompt"))
                      }}
                      className="bg-amber-600 text-black hover:bg-amber-500"
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>
            </Card>
        </section>

        {/* Derecha: lista inventario */}
        <section className="min-h-0">
          <Card className="bg-neutral-900 border-neutral-800 h-full flex flex-col">
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Inventario</CardTitle>
                <Badge variant="secondary" className="bg-neutral-800 border border-neutral-700 text-white">
                  {loading ? "Cargando…" : `${total} prod.`}
                </Badge>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-neutral-400">
                  Página <span className="font-medium text-white">{currentPage}</span> de {maxPage}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex items-center gap-1 border-neutral-700 bg-neutral-800 text-white hover:bg-neutral-700 disabled:bg-neutral-800"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Anterior</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page >= maxPage}
                    onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                    className="flex items-center gap-1 border-neutral-700 bg-neutral-800 text-white hover:bg-neutral-700 disabled:bg-neutral-800"
                    aria-label="Página siguiente"
                  >
                    <span>Siguiente</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <Separator className="bg-neutral-800" />

            <CardContent className="flex-1 p-0 min-h-[520px] md:min-h-[660px] flex flex-col">
              <div className="flex-1">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-900/95">
                    <tr className="[&>th]:px-4 [&>th]:py-2 text-left text-neutral-300">
                      <th className="w-[110px]">SKU</th>
                      <th>Nombre</th>
                      <th className="w-[120px]">Precio</th>
                      <th className="w-[90px] text-center">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800 text-white">
                    {items.map((p) => (
                      <tr key={p.id} className="[&>td]:px-4 [&>td]:py-2 hover:bg-neutral-800/40">
                        <td className="font-mono text-xs">{p.sku}</td>
                        <td className="truncate">{p.name}</td>
                        <td>{money(p.priceCents)}</td>
                        <td className="text-center">
                          <Badge
                            variant={p.stock > 0 ? "default" : "secondary"}
                            className={p.stock > 0 ? "bg-emerald-600" : "bg-neutral-700"}
                          >
                            {p.stock}
                          </Badge>
                        </td>
                      </tr>
                    ))}

                    {!loading && items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                          {q.trim().length >= 2 ? "Sin resultados para tu búsqueda." : "Sin productos."}
                        </td>
                      </tr>
                    )}
                    {loading && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                          Cargando inventario…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  )
}
