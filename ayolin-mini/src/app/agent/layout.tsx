import type { Metadata } from "next"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Consola del Agente · AYOLIN",
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children
}
