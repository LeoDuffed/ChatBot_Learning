'use client'

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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

export default function Ventas(){
  const [sales, setSales] = useState<SaleDTO[]>([])
  const [adminPw, setAdminPw] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const money = useMemo(() =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })
  , [])

  const pmLabel: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta" }
  const smLabel: Record<string, string> = {
    domicilio: "Envío a domicilio",
    punto_medio: "Punto medio",
    recoleccion: "Recolección",
  }
  const statusLabel: Record<SaleDTO["status"], string> = {
    pending_payment: "Pendiente",
    paid: "Pagada",
    cancelled: "Cancelada",
  }

  const loadPendingSales = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/sales/admin?status=pending_payment", { cache: "no-store" })
      if(!r.ok) throw new Error("Error al cargar las ventas")
      const data = await r.json()
      setSales(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error(err)
      setError("No se pudieron cargar las ventas pendientes.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPendingSales()
  }, [loadPendingSales])

  const handleUpdatePassword = useCallback(async () => {
    const r = await fetch("/api/my-bot/settings/sales-password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPw }),
    })
    alert(r.ok ? "Contraseña guardada" : "Error al guardar la contraseña")
  }, [adminPw])

  const handleMarkPaid = useCallback(async (saleId: string) => {
    const r = await fetch(`/api/sales/${saleId}/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPw }),
    })
    if(!r.ok){
      alert("Contraseña inválida o error")
      return
    }
    await loadPendingSales()
  }, [adminPw, loadPendingSales])

  const handleCancel = useCallback(async (saleId: string) => {
    const r = await fetch(`/api/sales/${saleId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPw }),
    })
    if(!r.ok){
      alert("Contraseña inválida o error")
      return
    }
    await loadPendingSales()
  }, [adminPw, loadPendingSales])

  return (
    <div className="flex min-h-screen flex-col">
      <div>
        <h1 className="mb-2 text-lg font-semibold tracking-tight">Ventas</h1>
        <p className="text-sm text-neutral-400">
          Administra la contraseña del panel y revisa las ventas pendientes por cobrar.
        </p>
      </div>

      <div className="mt-6 flex-1 min-h-0">
        <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {/* SIDEBAR */}
          <Card className="bg-neutral-900 border-neutral-800 h-fit">
            <CardHeader>
              <CardTitle className="text-white">Contraseña del jefe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Contraseña</span>
                <Input
                  type="password"
                  value={adminPw}
                  onChange={(e) => setAdminPw(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  className="bg-neutral-800 border-neutral-700 text-white"
                />
              </div>
              <Button
                size="sm"
                className="bg-white text-black hover:bg-white/90"
                onClick={handleUpdatePassword}
                disabled={adminPw.trim().length < 4}
              >
                Guardar contraseña
              </Button>
            </CardContent>
          </Card>

          {/* CONTENIDO */}
          <Card className="bg-neutral-900 border-neutral-800 flex h-full min-h-[600px] md:min-h-[680px] flex-col overflow-hidden">
            <CardHeader className="flex flex-col gap-4 border-b border-neutral-800 bg-neutral-900/70 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-white">Pendientes por pago</CardTitle>
                <p className="text-sm text-neutral-400">Marca las ventas como pagadas o cancélalas.</p>
              </div>
              <div className="flex items-center gap-2">
                {loading && <span className="text-xs text-neutral-500">Actualizando…</span>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadPendingSales}
                  className="border-neutral-700 text-black bg-white hover:bg-white/90"
                >
                  Refrescar
                </Button>
              </div>
            </CardHeader>

            <CardContent className="flex-1 min-h-0 space-y-4 overflow-y-auto px-6 py-6">
              {error && (
                <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {error}
                </div>
              )}

              {!loading && !error && sales.length === 0 && (
                <div className="rounded border border-neutral-800 bg-neutral-900/60 px-4 py-6 text-center text-sm text-neutral-400">
                  No hay ventas pendientes por cobrar.
                </div>
              )}

              {sales.map((s) => (
                <article
                  key={s.id}
                  className="rounded-lg border border-neutral-800/80 bg-neutral-900/70 p-5 shadow-sm focus-within:ring-1 focus-within:ring-neutral-700/80 outline-none min-h-[320px]"
                >
                  {/* Encabezado */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h2 className="font-medium text-white leading-tight">
                        Venta <span className="opacity-60">#{s.id.slice(-6)}</span>
                      </h2>
                      <p className="text-xs text-neutral-400">
                        {new Date(s.createdAt).toLocaleString("es-MX", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>

                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    >
                      {statusLabel[s.status]}
                    </Badge>
                  </div>

                  {/* Ticket */}
                  <div className="mt-4 rounded-md border border-neutral-800/80 bg-neutral-950/60">
                    <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-neutral-500 border-b border-neutral-800/80 sticky top-0 bg-neutral-950/80 backdrop-blur">
                      Ticket de compra
                    </div>
                    <div className="max-h-72 md:max-h-80 overflow-y-auto divide-y divide-neutral-800/80">
                      {s.items.map((it) => (
                        <div
                          key={it.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-neutral-200"
                        >
                          <div className="flex-1 min-w-[200px] break-words">
                            <div className="line-clamp-2 leading-snug">
                              {it.qty} × {it.nameSnapshot}
                            </div>
                            <div className="text-xs text-neutral-500">{it.sku}</div>
                          </div>
                          <div className="tabular-nums text-sm text-neutral-300 shrink-0">
                            {money.format(it.priceCentsSnapshot / 100)} c/u
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Info extra */}
                  <dl className="mt-4 grid gap-3 text-sm text-neutral-200 md:grid-cols-2">
                    <div className="space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-neutral-500">Pago</dt>
                      <dd>{s.paymentMethod ? (pmLabel[s.paymentMethod] ?? s.paymentMethod) : "-"}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-neutral-500">Entrega</dt>
                      <dd>{s.shippingMethod ? (smLabel[s.shippingMethod] ?? s.shippingMethod) : "-"}</dd>
                      {s.shippingAddress && (
                        <dd className="text-xs text-neutral-400 whitespace-pre-wrap break-words">
                          {s.shippingAddress}
                        </dd>
                      )}
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-neutral-500">Cliente</dt>
                      <dd className="break-words">{s.customerName || "-"}</dd>
                      {s.customerPhone && (
                        <dd className="text-xs text-neutral-400 break-words">{s.customerPhone}</dd>
                      )}
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-neutral-500">Notas</dt>
                      <dd className="text-neutral-300 whitespace-pre-wrap break-words max-h-32 overflow-y-auto pr-1">
                        {s.notes || "-"}
                      </dd>
                    </div>
                  </dl>

                  {/* Total */}
                  <div className="mt-4 flex items-center justify-between rounded-md border border-neutral-800/70 bg-neutral-950/60 px-4 py-3">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">Total</span>
                    <span className="font-semibold tabular-nums text-white">
                      {money.format(s.totalCents / 100)}
                    </span>
                  </div>

                  {/* Acciones */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 text-black hover:bg-emerald-500"
                      onClick={() => handleMarkPaid(s.id)}
                    >
                      Marcar pagada
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleCancel(s.id)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </article>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
