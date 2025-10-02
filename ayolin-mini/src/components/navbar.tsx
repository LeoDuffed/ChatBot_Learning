'use client'

import Link from 'next/link'
import React from 'react'
import { usePathname } from 'next/navigation'
import { Bot, MessageSquareText, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Navbar() {
	const pathname = usePathname()

	const links = [
		{ label: 'Chat', href: '/dashboard/agent', icon: MessageSquareText },
		{ label: 'Config', href: '/dashboard/config', icon: Settings2 },
	]

	return (
		<nav className='flex w-full items-center justify-between gap-6 overflow-x-auto bg-gradient-to-r bg-neutral-900 px-6 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur border-b border-white/10'>
			<Link href="/dashboard/agent" className='flex items-center gap-3 whitespace-nowrap text-white transition hover:text-sky-300'>
				<span className='flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/10 ring-1 ring-inset ring-sky-400/40'>
					<Bot className='h-5 w-5 text-sky-300' />
				</span>
				<span className='flex flex-col leading-tight'>
					<span className='text-[11px] uppercase tracking-[0.35em] text-white/50'>Ayolin</span>
					<span className='text-sm font-semibold text-white'>Control Center</span>
				</span>
			</Link>

			<div className='flex items-center gap-2 overflow-x-auto whitespace-nowrap'>
				{links.map(({ label, href, icon: Icon }) => {
					const isActive = pathname?.startsWith(href)
					return (
						<Button
							key={href}
							asChild
							variant="ghost"
							className={`gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
								isActive
									? 'bg-white/10 text-white shadow-[0_0_18px_rgba(56,189,248,0.35)]'
									: 'text-white/70 hover:bg-white/10 hover:text-white'
								}`}
							aria-current={isActive ? 'page' : undefined}
						>
							<Link href={href} className='flex items-center gap-2'>
								<Icon className='h-4 w-4' />
								<span>{label}</span>
							</Link>
						</Button>
					)
				})}
			</div>
	    </nav>
	)
}
