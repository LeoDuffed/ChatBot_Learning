import { PrismaClient } from "@/generated/prisma"
import { ensureProductTextIndex } from "./ensureTextIndex"

const globalForPrisma = global as unknown as { prisma?: PrismaClient }

export const db = globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db

ensureProductTextIndex(db).catch((e) => {
  console.warn("No se pudo asegurar el índice de texto:", e)
})
