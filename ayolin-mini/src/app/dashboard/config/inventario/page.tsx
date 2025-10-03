'use client'

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function Inventario(){
  const [prodForm, setProdForm] = useState({ sku:"", name:"", priceCents:"", stock:""})

    return (
        <>
            <h1></h1>
            <div className="grid h-full min-h-0 w-full grid-cols-1 gap-10 md:grid-cols-2">
                <section>
                    <div className="space-y-2 pt-1">
                        <div className="text-xs opacity-70">Nuevo producto</div>
                        <Input placeholder="SKU" value={prodForm.sku} onChange={(e) => setProdForm(p => ({ ...p, sku:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                        <Input placeholder="Nombre" value={prodForm.name} onChange={(e) => setProdForm(p => ({ ...p, name:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                        <Input placeholder="Precio (centavos)" value={prodForm.priceCents} onChange={(e) => setProdForm(p => ({ ...p, priceCents:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                        <Input placeholder="Stock" value={prodForm.stock} onChange={(e) => setProdForm(p => ({ ...p, stock:e.target.value}))} className="bg-neutral-800 border-neutral-700 text-white" />
                        <Button 
                            size="sm"
                            onClick={async() => {
                            const r = await fetch("/api/products", {
                                method: "POST",
                                headers: {"Content-Type":"application/json"},
                                body: JSON.stringify({
                                sku: prodForm.sku,
                                name: prodForm.name,
                                priceCents: Number(prodForm.priceCents||0),
                                stock: Number(prodForm.stock||0),
                                }),
                            })
                            alert(r.ok ? "Producto guardado" : "Error guardando producto")
                            if(r.ok) setProdForm({ sku: "", name:"", priceCents:"", stock:""})
                            }}
                            className="bg-blue-500 text-black hover:bg-blue-400"
                        >
                            Guardar Producto
                        </Button>
                    </div>
                </section>
            </div>
        </>
    )
}