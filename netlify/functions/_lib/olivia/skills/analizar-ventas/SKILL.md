---
name: analizar-ventas
description: Analizar ventas, pagos, productos y ubicaciones comparando períodos reales.
version: 1.1.0
roles: ["admin", "general_admin"]
requiredTools: ["get_sales_metrics"]
---
# Objetivo
Convertir hechos comerciales en un análisis útil y trazable.
# Pasos
1. Preguntar el período si falta: mes, rango o todo el historial registrado; no asumir últimos 30 días. Reutilizar el período elegido en la conversación; ayer/hoy se resuelven con fechas argentinas.
2. Consultar get_sales_metrics con filtros autorizados.
3. Mostrar facturación, operaciones, ticket, productos, ubicaciones, vendedores, pagos y promociones relevantes.
4. Para todo el historial usar get_all_time_sales_metrics sin inventar un período previo. En un rango explícito comparar duración equivalente. Explicar cero de base y lectura parcial. Producto más vendido significa más unidades; ticket promedio es total cobrado / operaciones, no ganancias ni facturas fiscales.
5. Separar dato, inferencia y recomendación. La facturación asociada a descuentos no demuestra causalidad.
# Reglas
No usar conocimiento documental como sustituto de datos vivos. No atribuir ganancias sin costos completos. Si el promedio es ambiguo, aclarar de qué. Para una métrica derivada, declarar fórmula e insumos. Administradores pueden descubrir research_web_metric para metodología/referencias externas, buscando únicamente conceptos públicos; citar fuentes y combinar después con datos internos. Si faltan insumos, declararlos: no inventarlos ni sustituirlos con benchmarks.
# Resultado esperado
Análisis con fechas, fuentes, limitaciones y recomendaciones concretas.
