# Costos V6.2

Se tomó el baseline antes de nuevas llamadas: Gemini USD 1,129971, 332 registros de turno, reserva 0; Luna/Sol USD 0,1143113, 132 llamadas. No se reinició ese baseline entre pestañas, reconexiones ni despliegues.

| Concepto | Antes | Después | Incremento registrado |
|---|---:|---:|---:|
| Gemini total conocido USD | 1,129971 | 1,414855 | 0,284884 |
| Gemini por usageMetadata reenviado, estimado USD | 1,056538 | 1,323267 | 0,266729 |
| Gemini solo duración de audio, contexto excluido USD | 0,073433 | 0,091588 | 0,018155 |
| Gemini sin confirmar, registros | 4 | 5 | 1 |
| Gemini contador de turnos de consumo | 332 | 401 | 69 |
| Reserva activa USD | 0 | 0 | 0 |
| Luna/Sol conocido USD | 0,1143113 | 0,1350441 | 0,0207328 |
| Luna/Sol llamadas | 132 | 158 | 26 |
| Luna/Sol sin confirmar | 3 | 4 | 1 |

Incremento combinado conocido: **USD 0,3056168**. No equivale a factura final: hay una nueva medición desconocida de cada proveedor. El consumo de Gemini informado queda por debajo de USD 1 adicional; no se puede certificar el total facturado incluyendo importes desconocidos. No se contabilizan estos como USD 0 ni se suman reservas al gasto.

El harness corta nuevos estímulos/tokens a baseline + USD 0,95 inicialmente; tras aparecer el desconocido se redujo el guard a baseline + USD 0,40 (límite 0,45 menos margen 0,05). No se modificaron los techos mensuales de la aplicación. Se detuvieron nuevas pruebas pagas tras las cincuenta entradas y se liberó la sesión. No se pidió ampliar presupuesto ni se sortearon límites.

No hubo cargos de Gemini por tests unitarios, fixtures, CSS o mediciones de apertura. TTS de estímulos se preparó con Edge TTS; no se dispone de factura de ese servicio. Reconocimiento de verificación corrió localmente. No se añadieron servicios pagos.

El total mensual conocido al cierre es USD 1,5498991 Gemini + Luna/Sol, con nueve mediciones sin confirmar acumuladas (siete ya estaban en el baseline). La proyección del backend de Gemini a 660 turnos es USD 2,328689 sobre 401 registros; la proyección mensual por días transcurridos es USD 4,716183. Son extrapolaciones de una mezcla de rutas y pruebas, no presupuestos garantizados para usuarios reales.

Costo por interacción se muestra solo si la aplicación tiene correlación de sourceTurnId/taskId. El harness puede atribuir un aviso de otra tarea al último estímulo: no se usa esa heurística para presentar costos definitivos individuales. Los resultados de estimación, provider-forwarded y desconocidos permanecen identificados en las trazas.
