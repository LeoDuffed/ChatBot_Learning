import { NextResponse } from "next/server"
import { createHmac, randomBytes } from "crypto"

const COOKIE_NAME = "agent_session"
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 días
const isProd = process.env.NODE_ENV === "production"

function sign(payload: string, secret: string) {
  const sig = createHmac("sha256", secret).update(payload).digest("base64url")
  return sig
}

export async function POST(req: Request) {
  try {
    const { password } = await req.json()
    const expected = process.env.AGENT_PASS
    const secret = process.env.AGENT_SESSION_SECRET

    if (!expected || !secret) {
      return NextResponse.json({ error: "Config incompleta" }, { status: 500 })
    }

    if (typeof password !== "string" || password.length === 0) {
      return NextResponse.json({ error: "Password requerido" }, { status: 400 })
    }

    if (password !== expected) {
      // respuesta discreta, no revelar nada
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    // payload mínimo y stateless (fecha + nonce ligero)
    const payloadObj = {
      t: Date.now(),
      v: 1,
      n: randomBytes(8).toString("base64url"),
    }
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url")
    const sig = sign(payload, secret)
    const value = `${payload}.${sig}`

    const res = NextResponse.json({ ok: true })
    res.cookies.set({
      name: COOKIE_NAME,
      value,
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 })
  }
}
