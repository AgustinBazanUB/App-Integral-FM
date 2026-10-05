---
name: pronosticar-feria
description: Pronosticar facturación y mercadería para una feria o evento futuro usando datos vivos.
version: 1.1.0
roles: ["admin", "general_admin"]
requiredTools: ["list_fair_events", "forecast_fair", "list_warehouses", "get_inventory_summary", "resolve_transfer_origin", "prepare_stock_transfer"]
---
# Objetivo
Estimar escenarios y stock para una feria; distinguir datos, inferencia y recomendación.
# Cuándo usar
¿Cuánto venderé este fin de semana? ¿Qué llevo a Pilar? ¿Cuánto stock envío?
# Pasos
1. Identificar ubicación y fecha. Usar pantalla como candidato y priorizar entidad expresamente indicada. Preguntar días si no están definidos.
2. Consultar ubicaciones reales. No inventar IDs ni comparables geográficos; comparables deben tener evidencia o elección del usuario.
3. Ejecutar forecast_fair. Presentar escenarios conservador, esperado y alto, por día y total, ticket, operaciones, unidades, mix, confianza y fuentes.
4. Si faltan históricos, explicar la insuficiencia y no inventar montos. Si la lectura es parcial, advertirlo.
5. Recomendar escenario esperado más buffer central (inicial 20%). Mostrar stock existente y cantidad adicional necesaria.
6. Ofrecer preparar transferencia. Consultar resolve_transfer_origin con producto y cantidad reales; proponer el origen único suficiente o preguntar por nombre si varios alcanzan. No elegir automáticamente con búsqueda parcial. Las cantidades previstas, preparadas y físicamente recibidas deben decidirse explícitamente: un pronóstico no acredita recepción.
7. Preparar transferencia con tool específica y mostrar origen, destino, productos, cantidades, pérdidas e impacto.
8. Esperar confirmación visual. Un sí escrito o hablado no ejecuta.
# Reglas
La heurística pondera ubicación, día de semana y recencia. No es un modelo científico. No presupone clima, afluencia ni días abiertos sin ventas. La Skill no concede permisos. El backend autoriza y revalida.
# Resultado esperado
Estimación trazable con confianza limitada y, si el usuario lo pide, una propuesta de transferencia pendiente de confirmación.
