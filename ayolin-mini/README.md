# Mini-Ayolin: Flujo de Ventas

## Tabla de Contenidos
- [1. Tablero de configuración del chatbot vendedor](#1-tablero-de-configuración-del-chatbot-vendedor)
- [2. Flujo de una venta](#2-flujo-de-una-venta)
- [3. Endpoints del flujo de venta](#3-endpoints-del-flujo-de-venta)

---

## 1. Tablero de configuración del chatbot vendedor

Cuando un usuario crea su chatbot y lo pone en **modo ventas**, aparece un tablero (un panel dentro de AYOLIN) con secciones como:

- **Catálogo**  
  Subir PDF/imagen (solo para extraer productos).

- **Inventario**  
  Ingresar a mano cuántos productos hay de cada uno.

- **Configuración de seguridad**  
  Definir la contraseña que luego se usará en WhatsApp/Telegram.

👉 **Nota:** El PDF no es para el stock, sino únicamente para darle contexto a Ayolin de qué vende el usuario.  
El stock se ingresa manualmente, lo cual es más confiable (el parsing automático de cantidades puede ser impreciso).

---

## 2. Flujo de una venta

1. **Cliente pide producto**  
   - Ayolin busca en inventario.  
   - Si hay stock, responde:  
     > “Sí tengo 2 camisetas blancas, ¿quieres comprarlas?”

2. **Cliente confirma compra**  
   - Ayolin descuenta el stock.  
   - Crea un pedido en estado `pending_payment`.  
   - Pregunta:  
     > “Perfecto, ¿cómo quieres pagar?”  
   - Guarda la elección del método de pago en el pedido.

3. **Registro del pedido (ejemplo JSON)**

   ```json
   {
     "id": "sale_001",
     "chatbotId": "bot_abc",
     "productId": "prod_123",
     "qty": 2,
     "status": "pending_payment",
     "paymentMethod": "cash"
   }
   ```

   - El pedido queda en la base de datos (`DB`).  
   - El stock ya está reducido (para no ofrecer algo ya vendido).

4. **El jefe revisa pedidos**  
   - Tiene un tablero donde ve todas las ventas:  
     - Pendientes de pago  
     - Pagadas  
     - Canceladas  

   - Cuando confirma que recibió el pago, cambia el `status` a **paid**.

5. **Clientes futuros**  
   - Como el stock se redujo en el paso 2, ningún cliente podrá comprar un producto que ya está **apartado**.  
   - Si el jefe marca el pedido como **cancelado**, el stock vuelve a subir.

---

## 3. Endpoints del flujo de venta

Con tu `schema.prisma` ya funcionando, armamos los **endpoints** del flujo de venta para **mini-Ayolin**, usando:

```ts
import { db } from "@/lib/db"
```

y el patrón de **App Router con runtime Node**.

### Resumen del flujo:

- **POST `/api/sales/intent`**  
  Valida SKU + stock y regresa un prompt de confirmación.

- **POST `/api/sales/confirm`**  
  Descuenta stock + crea `Sale` con `pending_payment`.

- **GET `/api/sales/admin`**  
  Lista ventas para el dueño.

- **POST `/api/sales/:id/mark-paid`**  
  El jefe confirma pago.

- **POST `/api/sales/:id/cancel`**  
  Cancela venta y repone stock.

---