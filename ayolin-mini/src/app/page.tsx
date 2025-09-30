// src/app/page.tsx
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export const metadata = {
  title: "AYOLIN · Chatbot de Ventas",
  description:
    "Chatbot de ventas conectado a tus APIs y base de datos. Responde preguntas, consulta inventario y genera ventas con flujo real.",
  openGraph: {
    title: "AYOLIN · Chatbot de Ventas",
    description:
      "Chatbot de ventas conectado a tus APIs y base de datos. Responde preguntas, consulta inventario y genera ventas con flujo real.",
    images: ["/vercel.svg"],
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function HomePage() {
  return (
    <main className="min-h-dvh bg-black">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                Chatbot de Ventas <span className="text-zinc-300">AYOLIN</span>
              </h1>
              <p className="mt-4 text-lg text-muted-foreground">
                Un front-end mínimo para probar un asistente de ventas con
                herramientas reales: inventario, checkout y gestión de pedidos.
                Este sitio es informativo; la consola del agente está en una
                ruta privada.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild className="bg-white text-black hover:bg-white/90">
                  <Link href="#como-funciona">Cómo funciona</Link>
                </Button>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                * La interfaz de chat no está disponible públicamente.
              </p>
            </div>

            <div className="relative">
              <Card className="border-muted/50 bg-stone-500 text-white">
                <CardContent className="p-6 text-white">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-white">
                      Integrado con Next.js + Prisma + MongoDB
                    </p>
                  </div>
                  <Separator className="my-4 " />
                  <ul className="space-y-2 text-sm text-white">
                    <li>• Búsqueda de productos por texto</li>
                    <li>• Consulta de stock y precios en tiempo real*</li>
                    <li>• Intent de venta: pago y entrega configurables</li>
                    <li>• Rutas API internas para herramientas del bot</li>
                  </ul>
                  <p className="mt-3 text-xs text-white">
                    * Depende de tus integraciones con AYOLIN y tu base de
                    datos. No se exponen endpoints sensibles al público.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* Cómo funciona */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-6 py-16 bg-black">
        <h2 className="text-2xl font-semibold">Cómo funciona</h2>
        <p className="mt-2 text-muted-foreground">
          El chatbot conversa con el cliente y, cuando es necesario, llama a
          herramientas que viven en este proyecto para consultar inventario y
          gestionar ventas.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Card className="bg-stone-500">
            <CardContent className="p-6">
              <h3 className="font-bold text-white">1) Entiende la intención</h3>
              <p className="mt-2 text-sm text-white">
                El cliente pregunta por productos, colores, tallas o precios. El
                bot identifica la intención y tokens útiles (SKU, cantidad,
                filtros).
              </p>
            </CardContent>
          </Card>

          <Card className="bg-stone-500">
            <CardContent className="p-6">
              <h3 className="font-bold text-white">2) Llama tools seguras</h3>
              <p className="mt-2 text-sm text-white">
                El bot usa endpoints internos (inventario, checkout) con
                validaciones y límites para obtener datos actuales y proponer
                opciones.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-stone-500">
            <CardContent className="p-6">
              <h3 className="font-bold text-white">3) Cierra la venta</h3>
              <p className="mt-2 text-sm text-white">
                Se genera una intención de venta con método de pago/entrega
                válido. El agente humano puede confirmar y marcar como pagado.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Integraciones / Tech */}
      <section className="bg-black">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold">Integraciones y stack</h2>
          <p className="mt-2 text-muted-foreground">
            Este proyecto usa Next.js (App Router), TypeScript, shadcn/ui,
            Prisma y MongoDB, comunicándose con AYOLIN para herramientas y
            flujos de venta.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <Card className="bg-stone-500">
              <CardContent className="p-6">
                <h3 className="font-bold text-white">Front-end</h3>
                <p className="mt-2 text-sm text-white">
                  Next.js + Tailwind + shadcn/ui. Componentes accesibles y
                  diseño limpio, listo para adaptar a tu marca.
                </p>
              </CardContent>
            </Card>
            <Card className="bg-stone-500">
              <CardContent className="p-6">
                <h3 className="font-bold text-white">Data</h3>
                <p className="mt-2 text-sm text-white">
                  Prisma + MongoDB. Consultas seguras y controladas por
                  herramientas, sin exponer endpoints críticos.
                </p>
              </CardContent>
            </Card>
            <Card className="bg-stone-500">
              <CardContent className="p-6">
                <h3 className="font-bold text-white">Operación</h3>
                <p className="mt-2 text-sm text-white">
                  Deploy en Vercel. Routes API internas y configuración por
                  entorno para llaves y secretos.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <Separator />


      {/* Contacto */}
      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <p className="text-sm text-muted-foreground">
                ¿Tienes dudas o quieres integrarlo?
              </p>
              <h3 className="text-lg font-semibold">Hablemos</h3>
            </div>
            <div className="flex gap-3">
              <Button asChild>
                <a href="mailto:contacto@ayolin.example">ayolintm@gmail.com</a>
              </Button>
              <Button variant="outline" asChild className="bg-white text-black hover:bg-white/90">
                <a href="https://ayolin.com" target="_blank" rel="noreferrer">
                  Sitio principal
                </a>
              </Button>
            </div>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            © {new Date().getFullYear()} AYOLIN. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </main>
  )
}
