"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

export default function AgentLoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/agent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!r.ok) {
        setError("Credenciales inválidas")
        setLoading(false)
        return
      }
      router.replace("/agent")
    } catch {
      setError("Error de conexión")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <h1 className="text-xl font-semibold">Acceso del Agente</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Ingresa la contraseña para continuar.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <Input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Ingresando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
