import { NextRequest, NextResponse } from "next/server"

const COOKIE_NAME = "agent_session"
const LOGIN_PATH = "/agent/login"
const AGENT_PREFIX = "/agent"

function b64url(input: ArrayBuffer) {
  // ArrayBuffer -> base64url (edge-safe)
  const bytes = new Uint8Array(input)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function signHmac(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return b64url(sig)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Solo vigilamos rutas bajo /agent
  if (!pathname.startsWith(AGENT_PREFIX)) {
    return NextResponse.next()
  }

  // Dejar pasar /agent/login sin sesión (y redirigir si ya hay sesión válida)
  if (pathname === LOGIN_PATH) {
    const token = req.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.next()

    const secret = process.env.AGENT_SESSION_SECRET
    if (!secret) return NextResponse.next()

    const [payload, sig] = token.split(".")
    if (!payload || !sig) return NextResponse.next()

    try {
      const expected = await signHmac(payload, secret)
      if (expected === sig) {
        // Ya logueado: manda a /agent
        return NextResponse.redirect(new URL(AGENT_PREFIX, req.url))
      }
    } catch {
      // si falla firma, lo tratamos como no logueado
    }
    return NextResponse.next()
  }

  // Para cualquier otra ruta bajo /agent/* requerimos cookie válida
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url))
  }

  const secret = process.env.AGENT_SESSION_SECRET
  if (!secret) {
    // si falta secret, bloquea acceso por seguridad
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url))
  }

  const [payload, sig] = token.split(".")
  if (!payload || !sig) {
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url))
  }

  try {
    const expected = await signHmac(payload, secret)
    if (expected !== sig) {
      return NextResponse.redirect(new URL(LOGIN_PATH, req.url))
    }
    // (Opcional) validar expiración: decodifica payload si quieres TTL personalizado
    // const json = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")))
    // if (Date.now() - json.t > 1000 * 60 * 60 * 24 * 30) ...

    return NextResponse.next()
  } catch {
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url))
  }
}

// Matcher para todas las rutas bajo /agent/*
export const config = {
  matcher: ["/agent/:path*"],
}
