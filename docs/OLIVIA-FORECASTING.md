# Pronóstico de ferias

`pronosticar-feria@1.0.0` identifica evento y fecha, consulta datos vivos, ejecuta `forecast_fair`, explica escenarios y ofrece preparar transferencia. No inventa ubicaciones, comparables geográficos ni recepción física.

Inputs: ubicación, fecha real, 1–14 días, IDs comparables explícitos del mismo tipo, calendario operativo y buffer central 0–100% (20% inicial). Se leen hasta 180 días de ventas y 1.500 registros, más stock actual autorizado.

La heurística agrupa ventas activas únicas por ubicación/día. Para cada día futuro:

`peso = ubicación × día de semana × exp(-antigüedad / 90)`

Ubicación propia pesa 1; comparable, 0,35. Igual día de semana pesa 1; distinto, 0,3. Esperado es el promedio diario ponderado por ese peso, multiplicado por tendencia. Tendencia compara hasta cuatro jornadas propias recientes con cuatro anteriores, requiere dos anteriores y se acota a 0,75–1,25.

La dispersión es el mayor entre desviación ponderada y 20% del esperado (50% con menos de cinco jornadas o lectura parcial). Conservador resta dispersión sin bajar de cero; alto la agrega. Se informan escenarios diarios y totales, operaciones, ticket medio, unidades por producto, mix y evidencia.

El calendario explícito cierra fechas no incluidas o días de semana no habilitados. No se presupone que un día sin ventas estuvo abierto. Ausencia de historia produce escenarios null y una explicación, no facturación ficticia. La confianza inicial máxima es media con al menos doce jornadas propias; muestras parciales/comparables escasos reducen confianza.

Si destino y comparable tienen apertura/cierre explícitos, los ingresos, operaciones y unidades del comparable se ajustan por `horas destino / horas comparable`, incluyendo jornadas nocturnas. Sin ambos horarios el factor es 1 y queda señalado en factores. Es una hipótesis de proporcionalidad de la heurística; el calendario actual no reconstruye cambios históricos de horario y no demuestra afluencia constante por hora.

`stock recomendado = ceil(unidades esperadas × (1 + buffer / 100))`

Se evita el error de punto flotante que convertiría 10 exactas en 11. Ejemplo: 20 unidades esperadas → 24 recomendadas; si hay 2 en destino, transferencia sugerida 22. No se resta stock desconocido como cero.

El paso siguiente lee origen, disponibilidad y destino, prepara líneas con cantidad prevista/preparada/recibida decididas por el usuario y exige tarjeta visual. Confirmar revalida inventarios y huella y conserva precios/configuración existentes en destino.

Limitaciones reales: heurística, sin clima/afluencia/eventos externos no registrados, sin geolocalización empresarial inexistente y sin historial de días abiertos con cero ventas. Todas se entregan como parte del resultado. El método y versión permiten auditar futuras mejoras.
