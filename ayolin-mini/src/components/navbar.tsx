'use client'

import Link from 'next/link'
import React from 'react'
import { Button } from '@/components/ui/button'

export default function Navbar() {

	return (
		<nav className='flex w-full items-center gap-4 bg-black px-6 py-4 overflow-x-auto whitespace-nowrap'>
			<Button
				asChild
				variant="ghost"
				className= 'text-white' 
			>
				<Link href="/dashboard/agent">Chat</Link>
			</Button>
			<Button
				asChild
				variant="ghost"
				className= 'text-white' 
			>
				<Link href="/dashboard/config">Config</Link>
			</Button>
	
	    </nav>
	)
}
