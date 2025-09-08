# mini-AYOLIN

Versión mínima del chatbot de **AYOLIN** para probar la experiencia básica de conversación (texto a texto) con inventario simple, lectura por SKU y flujo de “apartado” de productos. Ideal como **MVP** para demos y pruebas rápidas.

---

## ✨ Características

- **Chat** UI tipo mensajería (user / assistant).
- **Inventario** en BD (MongoDB vía Prisma) con búsqueda por `SKU`.
- **Disponibilidad**: consulta cuántas piezas hay y precio.
- **Apartado / Reserva** de unidades (reduce stock temporalmente).
- **Memoria corta** por chat (recuerda el SKU en curso).
- **Mensajes y Chats** persistidos en BD.
- **Estilo** con `shadcn/ui` + Tailwind.

> Nota: es una demo enfocada en texto. No incluye pagos, auth, multi-bots ni plugins (eso vive en el proyecto grande AYOLIN).

---

## 🧱 Stack

- **Next.js 14** (App Router) + **React** + **TypeScript**
- **Prisma** (Client + Migrate) con **MongoDB**
- **TailwindCSS** + **shadcn/ui**
- (Opcional) **OpenAI** u otro proveedor si quieres IA “real”; esta mini usa reglas simples por defecto.

---

## 🗄️ Modelo de datos (Prisma)

`prisma/schema.prisma` (MongoDB):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

model Product {
  id          String  @id @default(auto()) @map("_id") @db.ObjectId
  sku         String  @unique
  name        String
  price       Decimal @db.Decimal(10,2)
  stock       Int
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Chat {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  title     String?
  createdAt DateTime @default(now())
  messages  Message[]
}

model Message {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  chatId    String   @db.ObjectId
  role      String   // 'user' | 'assistant'
  content   String
  createdAt DateTime @default(now())

  @@index([chatId])
}

model Reservation {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  sku       String
  quantity  Int
  chatId    String   @db.ObjectId
  status    String   // 'held' | 'confirmed' | 'released'
  createdAt DateTime @default(now())
}
```

---

## 🚀 Puesta en marcha

Con **pnpm** (recomendado) o **npm**.

```bash
# 1) Dependencias
pnpm install
# o
npm install

# 2) Prisma
pnpm prisma generate
pnpm prisma db push
# (opcional) sembrar datos
pnpm tsx scripts/seed.ts

# 3) Dev
pnpm dev
# o
npm run dev
```
---

## 🧠 Lógica del mini-bot (reglas simples)

- Si el usuario envía un **SKU válido**, responde con: nombre, precio y stock.
- Si pregunta **“¿cuántos tienes?”** y ya hay SKU en contexto: devuelve stock.
- Si dice **“aparta X”** o **“quiero X”** y hay stock: crea `Reservation` (status `held`) y reduce stock temporal.
- Si el usuario **cambia de SKU**, el contexto se actualiza.
- Palabras clave: `sku`, `disponibilidad`, `cuántos`, `precio`, `aparta`, `quiero`, `compra`.

---

## 🖥️ UI

- `src/app/page.tsx` renderiza:
  - **Header** con título del chat
  - **MessageList** (scrollable, sticky header)
  - **Composer** (input + enviar)
- Estilos con Tailwind + componentes `shadcn/ui` (Card, Button, Input, ScrollArea).

> Si no tienes `shadcn` inicializado, en un proyecto nuevo:
> ```bash
> npx shadcn@latest init
> npx shadcn@latest add button card input scroll-area
> ```

---

## 🧪 Pruebas rápidas (manual)

1. Escribe: “**Hola**”.
2. Pregunta: “**¿tienes disponibles pantalones negros?**”.
3. Envía: “**sku A01B23**”.
4. Pregunta: “**¿cuántos tienes?**” → debería responder stock.
5. Envía: “**quiero 2**” → crea `Reservation (held)` y descuenta stock.
6. Cambia a otro SKU y repite.

---

## 🤝 Contribuir

1. Haz fork y crea una rama: `feat/mi-mejora`.
2. Commit descriptivo.
3. PR con contexto y pruebas manuales.

---

## 📜 Licencia

Úsalo, modifícalo y compártelo con atribución.

---

## 🙌 Créditos

Hecho con ♥ para el ecosistema **AYOLIN**.  
Stack: Next.js, TS, Prisma, MongoDB, Tailwind, shadcn/ui.

---

## 🧩 Notas

- Este README asume un proyecto Next.js ya inicializado.  
- Si usas **npm** en lugar de **pnpm**, sustituye los comandos.  
- Para IA real, conecta tu proveedor en `lib/bot.ts` y usa `OPENAI_API_KEY`.
