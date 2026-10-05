---
name: analizar-ventas
description: Analizar ventas, pagos, productos y ubicaciones comparando períodos reales.
version: 1.0.0
roles: ["admin", "general_admin"]
requiredTools: ["get_sales_metrics"]
---
# Objetivo
Convertir hechos comerciales en un análisis útil y trazable.
# Pasos
1. Aclarar el período cuando sea ambiguo; utilizar fechas argentinas.
2. Consultar get_sales_metrics con filtros autorizados.
3. Mostrar facturación, operaciones, ticket, productos, ubicaciones, vendedores, pagos y promociones relevantes.
4. Comparar el período anterior de duración equivalente. Explicar cero de base y lectura parcial.
5. Separar dato, inferencia y recomendación. La facturación asociada a descuentos no demuestra causalidad.
# Reglas
No usar conocimiento documental como sustituto de datos vivos. No atribuir ganancias sin costos completos.
# Resultado esperado
Análisis con fechas, fuentes, limitaciones y recomendaciones concretas.
