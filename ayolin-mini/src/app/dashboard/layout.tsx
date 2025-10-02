import type { Metadata } from "next"
import Navbar from "@/components/navbar"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Consola del Agente · AYOLIN",
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-black">
      <div className="shrink-0">
        <Navbar />
      </div>
      <main className="flex-1 min-h-0 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
