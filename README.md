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

- Si el usuario envía un **SKU válido o nombre de producto**, responde con: nombre, precio y stock.
- Si pregunta **“¿cuántos tienes?”** y ya hay SKU en contexto: devuelve stock.
- Si dice **“aparta X”** o **“quiero X”** y hay stock: crea `Reservation` (status `held`) y reduce stock temporal.
- Si el usuario **cambia de SKU**, el contexto se actualiza.
- Si el usuario pregunta por **métodos de pago y entrega**, el chatbot responde con base en lo que selecciona el "vendedor".

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

- **Súper importante → necesitas agregar un producto primero en la base de datos.**

1. Escribe: “**Hola**”.
2. Pregunta: “**¿tienes disponibles pantalones negros?**”, “**¿Qué métodos de pago tienes?**”, “**¿Qué métodos de entrega hay disponibles?**”.
3. Envía: “**sku A01B23**” o “**nombre del producto**”.
4. Pregunta: “**¿cuántos tienes?**” → debería responder stock.
5. Envía: “**quiero 2**” → crea `Reservation (held)` y descuenta stock.
6. Confirma: “**Al confirmar la compra baja el stock y pregunta por datos para su entrega y métodos de pago**”.
7. Cambia a otro SKU y repite las veces que quieras.

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
