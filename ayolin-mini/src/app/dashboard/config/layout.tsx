import Link from 'next/link'
import { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Metadata } from 'next'

const links = [
	{ name: 'Custom', href: '/dashboard/config' },
	{ name: 'Inventario', href: '/dashboard/config/inventario' },
	{ name: 'Ventas', href: '/dashboard/config/ventas' },
]

export const metadata: Metadata = {
  title: "Configuración",
  description: "Customize your own chatbot",
};

export default function ConfiguracionLayout({
	children,
}: {
	children: ReactNode
}) {
	return (
		<div className="flex h-full w-full flex-1 overflow-hidden px-4 py-6 md:px-6">
			<div className="grid h-full min-h-0 w-full grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
				<Card className="flex min-h-0 flex-col bg-neutral-900">
					<CardHeader className="shrink-0 border-b border-neutral-800 pb-4">
						<CardTitle className="text-2xl font-semibold text-white">Ajustes</CardTitle>
					</CardHeader>
					<CardContent className="flex-1 overflow-y-auto p-0">
						<nav className="px-4 py-4">
							<ul className="space-y-1">
								{links.map((link) => (
									<li key={`${link.href}-${link.name}`}>
										<Button
											variant="link"
											asChild
											className="w-full justify-start px-0 text-left text-base font-semibold text-white hover:text-sky-400"
										>
											<Link href={link.href}>{link.name}</Link>
										</Button>
									</li>
								))}
							</ul>
						</nav>
					</CardContent>
				</Card>

				<main className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
					<div className="flex-1 overflow-y-auto px-6 py-6">
						{children}
					</div>
				</main>
			</div>
		</div>
	)
}
