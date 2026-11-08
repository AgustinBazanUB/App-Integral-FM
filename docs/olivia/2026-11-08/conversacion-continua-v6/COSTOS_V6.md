# Costos V6

Cierre autenticado: 2026-11-08 19:57:29 UTC, Firebase `app-integral-fm-pruebas`. Importes en USD. Son tarifas aplicadas a consumo informado y estimaciones del sistema, no una conciliación de factura. Fuente sanitizada: `EVIDENCIA_ADICIONAL_V6.json`, `accountAtClose`.

| Contador | Antes de V6 | Cierre | Diferencia registrada |
|---|---:|---:|---:|
| Gemini Live | 0,593538 | 1,054397 | 0,460859 |
| Contador de turnos Gemini | 184 | 302 | 118 |
| Luna/Sol, estimación por tarifas | 0,0691908 | 0,1088200 | 0,0396292 |
| Llamadas Luna/Sol | 82 | 125 | 43 |
| Suma estimada de ambos | 0,6627288 | 1,1632170 | 0,5004882 |
| Reserva Gemini | 0 | 0 | 0 |

El contador de turnos incluye avisos, intentos y otros cierres; no equivale a 118 preguntas de una persona ni a las 81 filas de interacción. Es un delta de los contadores de la cuenta durante la ventana, no asignación exacta de cada centavo a cada estímulo.

El incremento Gemini registrado quedó por debajo del máximo adicional autorizado de USD 1. No se puede garantizar el importe facturado completo: al cierre había tres turnos Gemini y tres llamadas Luna/Sol sin consumo confirmado. No se sustituyen por cero. Los episodios de reporte desconocido activaron el freno preventivo. Se corrigió la espera de usageMetadata atribuible al aviso interrumpido, conservando ese freno si la medición no aparece.

De los USD 1,054397 Gemini mensuales, USD 0,988511 corresponden al cálculo con usageMetadata y USD 0,065886 a estimación solo por duración de audio, que excluye contexto. Incluso con usageMetadata, el importe es cálculo local por tarifas, no factura. El contador Luna/Sol no permite separar aquí una factura por cada modelo sin reconciliación adicional.

## Proyecciones identificadas

La cohorte social F01–F10 tiene diez reportes atribuibles por coincidencia única de tokens de proveedor. Costos por turno: 0,006167; 0,004492; 0,004575; 0,004889; 0,005328; 0,005622; 0,007145; 0,006868; 0,008455; 0,009113 USD. Promedio 0,0062654; proyección aritmética para 660 turnos equivalentes: USD 4,135164. La muestra es pequeña, el contexto crece y no representa tareas comerciales, silencios, caídas ni notificaciones generales.

El backend proyecta USD 2,304311 para 660 turnos usando el promedio mensual agregado de 302 turnos, que mezcla V5/V6 y otras rutas. Es otra distribución; no se presenta como costo futuro V6 garantizado ni se promedian ambas proyecciones.

Límites sin cambios: objetivo USD 5, aviso USD 6, techo preventivo USD 10, 660 turnos, máximo de sesión 600 s y reserva preventiva por apertura USD 0,5. La reserva no se cuenta como gasto realizado. El laboratorio mantuvo el baseline original y bloquea aperturas/estímulos al aproximarse a USD 1 adicional; reinstalarlo no reinició ese baseline.

No se midió factura de Netlify, Firestore, generación de estímulos, almacenamiento ni recursos locales. Edge TTS, Vosk y Whisper se usaron en el entorno privado de diagnóstico; no se inventa un costo cero de infraestructura. No se incorporó proveedor, proxy ni runtime nuevo a la aplicación.
