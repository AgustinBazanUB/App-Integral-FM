# QA manual de Olivia en preview autenticada

Fecha: 5 de octubre de 2026. Chrome con la sesión del usuario, preview privada de PR34. Se consultaron datos reales autorizados y se prepararon propuestas sin confirmar efectos comerciales. La preview usa el Firebase empresarial configurado; no es una base aislada.

## Resultados observados

| Caso | Resultado |
|---|---|
| Arranque después de corregir la clave Firebase | Estado y estimación HTTP 200; composer habilitado |
| Carga progresiva inicial | Conserva producto y cantidad entre mensajes; pedía destino y luego motivo; requisito corregido como opcional después de la observación del usuario |
| Corrección durante recopilación | Cambiar 12 a 20 conserva el producto |
| Propuesta de stock | Tarjeta con 20 unidades, stock anterior/nuevo y motivo; sin ejecutar |
| Sí escrito | Mantiene la tarjeta y exige el Sí visual |
| Corrección de una propuesta | Cambiar 20 a 18 reemplaza la tarjeta y recalcula el stock nuevo |
| Cancelación | «Cancelá» retira la tarjeta y responde que la tarea quedó cancelada |
| Recarga de la página | Recupera el historial de la misma conversación |
| Ubicación eliminada | No resuelve ni habilita una carga hacia ella |
| Producto sin coincidencias después del ajuste | Pide el nombre/presentación y no enumera productos ajenos; corregir el nombre conserva la cantidad |
| Destino después del ajuste de nombres | Explica que el nombre no está disponible; «Lavalle» resuelve Local Lavalle; la obligatoriedad inicial del motivo se corrigió posteriormente |
| Telemetría del camino progresivo | Misma tarea durante las aclaraciones; cero llamadas de modelo y cero tokens |
| Consulta real de ventas | Luna HIGH devuelve ventas, facturación, ticket, mix y comparación; declara el período y aclara que el anterior no es el fin de semana anterior |
| Recuperación después de stream incompleto | Cerrar/reabrir recupera la respuesta final guardada sin reenviar la consulta |
| Creatividad en Redes sociales | `gpt-6.1-sol` HIGH devuelve un concepto breve de Instagram; no crea ni publica registros |
| Stream después de heartbeats | Consulta creativa de tres llamadas, unos 27 segundos, entrega resultado completo y telemetría sin reabrir el chat |
| Luna XHIGH y cambio de intención | Después de la tarea creativa, el pronóstico usa `gpt-6-luna` XHIGH, conserva las dos fechas, declara que no hay ferias registradas y pide la ubicación; tarea nueva sin los slots creativos |
| Stream complejo después de heartbeats | Tres llamadas y tres herramientas, unos 27 segundos, con respuesta final y telemetría completas |
| GPT-Live después de corregir selectores | Conexión WebRTC activa y transcripción de salida del saludo; retoma las fechas y la pregunta del mismo chat |
| Audio físico de salida | El usuario confirmó «ahora sí la escuché» después de reconectar y reproducir el saludo |
| Sesión de voz finalizada | La interfaz volvió al composer y mostró el costo de audio; el texto siguió disponible |
| Operación ajena a Marketing desde Marketing | Consulta de stock real usa `gpt-6-luna` HIGH, ruta `luna-normal`, con tres llamadas y tres herramientas; no usa Sol |
| Stock después de las propuestas canceladas | La consulta viva conserva el stock original: las propuestas, correcciones y sí escrito no lo modificaron |
| Carga sin motivo después de la corrección | «Cargame 2 botellas de Aceite de Oliva Arbequina 500cc en Local Lavalle» prepara directamente tarjeta con stock 42 → 44, sin preguntar ni mostrar motivo; propuesta cancelada sin ejecutar |

## Problemas encontrados y correcciones

1. Un producto inexistente enumeraba productos sin coincidencia. Se muestran solo coincidencias; sin ninguna, pide el nombre o presentación.
2. Un nombre abreviado de ubicación no se resolvía y un destino ausente repetía una pregunta genérica. Se acepta una coincidencia única por palabras, se prioriza el nombre exacto y se aclara la ausencia o ambigüedad.
3. Una consulta real de métricas produjo parámetros inválidos en `update_task`. Se explica el contrato de campos y se devuelve su esquema al modelo para corregirlos dentro del presupuesto existente. Los parámetros inválidos no se persisten; permisos rechazados siguen deteniendo la operación.
4. Dos consultas largas perdieron el stream antes de la respuesta final. Una consulta de ventas se recuperó completa desde el servidor; una comparación terminó en error sin efectos comerciales. Se agregaron heartbeats cada cinco segundos durante el razonamiento/herramientas. Se verificó que se detienen al terminar o cancelar y que no se emiten resultados tardíos.
5. El inicio real de GPT-Live devolvió `live-unavailable` (HTTP 502). La revisión del [contrato oficial de creación](https://developers.openai.com/api/reference/resources/live/methods/create) encontró que `allowed_server_events` exige selectores `{ type }`, mientras la solicitud enviaba strings. Se corrigió ese formato y se reforzó la prueba de creación. El rechazo inicial por sí solo no prueba falta de acceso a GPT-Live en la cuenta.
6. Después del cierre automático de voz, el botón de inicio conservaba la referencia al cliente ya cerrado. Se libera esa referencia cuando el cliente termina para permitir reconectar desde el mismo chat. La reconexión de QA inicialmente se completó cerrando/reabriendo el drawer; el ajuste elimina esa necesidad.

7. El usuario aclaró que el motivo del ingreso de stock es opcional. Se elimina de los datos faltantes de la tarea y la operación; el contrato del modelo acepta `null` y lo describe como opcional. Producto, ubicación y cantidad bastan para preparar la tarjeta; un motivo posterior reemplaza la propuesta y conserva la protección de confirmación. Sin motivo se usa la descripción estándar «Ingreso de mercadería» del plan compartido.

Regresión: 742 pruebas Node aprobadas. Se añadieron seis casos para productos/ubicaciones y reparación de parámetros, incluidos JSON malformado, agotamiento de presupuesto y rechazo de creatividad fuera de su módulo, más dos casos para el stream y dos para motivo opcional. Se verifican motivos ausentes/nulos/vacíos, preparación, ejecución controlada, descripción estándar y confirmación visual obligatoria. El build unificado y el empaquetado de Functions se verifican en el despliegue de la preview. Las 19 pruebas previas de reglas en emulador permanecen como evidencia; estos ajustes no cambian reglas.

## Límites de la prueba

No se confirmó ninguna operación comercial, publicó contenido ni cambió configuración empresarial. Las pruebas automáticas de proveedor/media usan fixtures; su aprobación no acredita hardware ni disponibilidad real de cada modelo. Los resultados de consultas reales y audio se registran por separado a continuación.

El altavoz fue confirmado por el usuario. La captura/transcripción del micrófono requiere su frase de prueba y no se sustituye por audio simulado. La ejecución empresarial de forecast/transferencias, un perfil Vendedor autenticado y los adjuntos privados permanecen fuera de los casos reales aprobados de este recorrido.

La salida de `netlify env:list` oculta secretos; intentar interpretar ese texto como una clave privada no valida la clave real. La corrección la realizó el usuario en Netlify y el arranque autenticado posterior confirmó que funciona, sin extraer ni guardar la clave.
