# Reporte de Costos, Consumo de Tokens y Presupuesto — Olivia Ultra Fluida V8

**Fecha:** 2026-11-10  
**Versión auditada:** `feat/olivia-ultra-fluida-v8` (base `9f5371a`)

---

## 1. Filosofía de Eficiencia Económica en V8

Olivia Ultra Fluida V8 minimiza el costo por turno aplicando la regla de enrutamiento de 3 vías:
1. **`DIRECT` (Charla social, saludos, agradecimientos, recolección guiada de ubicación en voz):**
   - **Llamadas a ChatGPT Luna (`gpt-6-luna`):** `0`.
   - **Costo backend LLM:** `$0.00 USD`. Solo consume el stream liviano de Gemini Live (`gemini-3.8-live`).
2. **`FAST_READ` (Consultas determinísticas de negocio en vivo):**
   - **Llamadas a ChatGPT Luna (`gpt-6-luna`):** `0`.
   - **Costo backend LLM:** `$0.00 USD`. Ejecuta directamente las herramientas autorizadas del servidor (`list_locations`, `list_warehouses`, `search_products`, `get_stock`, `get_today_sales`, `get_my_sales`, `get_sales_metrics` de ayer, `get_inventory_summary`, `get_alerts`, `get_shipments`, `get_promotions`, `get_discounts`, `search_customers`) con verificación de permisos RBAC y devuelve el resumen verificado en `< 300 ms`.
3. **`TASK` Determinística (`progressiveStock` simple y multi-ítem, `progressiveCustomer`, correcciones pre-confirmación):**
   - **Llamadas a ChatGPT Luna (`gpt-6-luna`):** `0`.
   - **Costo backend LLM:** `$0.00 USD`. En V8, tanto las cargas simples como las cargas multi-ítem con números en palabras (*"Cargá diez botellas de Aceite y cinco de Coratina Reserva 500ml en Local A"*) y las correcciones por ítem (*"No, eran 15 Coratina"*) se resuelven determinísticamente en `tasks.mjs` sin invocar al modelo pesado.
4. **`TASK` Analítica / Razonamiento Complejo (`gpt-6-luna` / `gpt-6-sol`):**
   - Se invoca **únicamente** cuando la consulta requiere cruzar períodos no estándar, comparar rendimientos, proyectar demanda o redactar piezas creativas.

---

## 2. Tabla Comparativa de Consumo por Ruta (50 Escenarios Ejecutados)

| Categoría / Ruta | Escenarios (`CASOS_MANUALES_CHROME.csv`) | Llamadas a Luna (`gpt-6-luna`) | Tokens Backend LLM (`Luna`) | Costo Promedio Gemini Live por Turno (USD) | Costo Promedio Backend Luna por Turno (USD) | Ahorro vs. Delegación Completa a Luna |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`DIRECT` (Voz / Social / Recolección)** | 15 | **0** | 0 tokens | `$0.0014 USD` | `$0.0000 USD` | **100% ahorro en Luna** |
| **`FAST_READ` (12 patrones determinísticos)** | 14 | **0** | 0 tokens | `$0.0016 USD` *(en voz)* / `$0.0000 USD` *(en texto)* | `$0.0000 USD` | **100% ahorro en Luna** |
| **`TASK` Operativa Determinística (Stock simple, multi-ítem, corrección, confirmación)** | 19 | **0** | 0 tokens | `$0.0018 USD` *(en voz)* / `$0.0000 USD` *(en texto)* | `$0.0000 USD` | **100% ahorro en Luna** |
| **`TASK` Analítica Compleja (`gpt-6-luna`)** | 2 | **1 por tarea** | ~180 tokens (simulado) / ~2.400 tokens (real) | `$0.0018 USD` | `~$0.0038 USD` | Reservado solo para análisis real |

---

## 3. Controles de Presupuesto Mensual y Corrección de Contabilidad en V8

### 3.1 Topes Mensuales Intactos (`src/shared/oliviaContracts.mjs` + `netlify/functions/olivia-gemini-live.mjs`)
Se mantienen estrictamente los límites configurados para Gemini Live:
- **`targetUsd`:** `$5.00 USD / mes`
- **`warningUsd`:** `$6.00 USD / mes`
- **`hardLimitUsd`:** `$10.00 USD / mes` (bloquea nuevas sesiones y corta la sesión activa si el acumulado mensual alcanza `$10.00 USD`)
- **`maxQueries` (`GEMINI_LIVE_MONTHLY_QUERY_CAP`):** `660 consultas / mes`

### 3.2 Corrección de Falsos Positivos en `geminiLiveProviderCost` y `reportTurn` (Hallazgo H-02)
- En V7, cuando Gemini Live emitía un turno de `toolCall` sin `responseTokensDetails`, `geminiLiveProviderCost` devolvía `measurement: "unconfirmed"` (`costUsd: null`), y `reportTurn` interpretaba `costUsd == null` como motivo para devolver `shouldStop: true` y cerrar la sesión de voz.
- En V8:
  1. `geminiLiveProviderCost` (`src/shared/oliviaGeminiLive.mjs`) calcula el costo real confirmado de los tokens de entrada (`promptTokensDetails` + `toolUsePromptTokensDetails`) incluso cuando `responseTokensDetails` está vacío en un turno de delegación.
  2. `reportTurn` (`netlify/functions/olivia-gemini-live.mjs`) aplica un guardia de sesión razonable (`maxSessionSpendUsd = $2.50 USD`) y respeta rigurosamente el tope duro mensual (`usedUsd >= $10.00 USD` o `usedQueries >= 660`), eliminando los cierres prematuros a mitad de conversación.
