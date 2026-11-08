# Costos V6

Registro inicial leído del backend de pruebas antes de llamadas pagas V6: Gemini USD 0,593538, reserva cero, 184 turnos. Luna/Sol USD 0,0691908, 82 llamadas y dos llamadas sin confirmar. Límites vigentes: objetivo 5, aviso 6, preventivo 10 USD y 660 turnos. Presupuesto de esta auditoría: máximo incremental Gemini USD 1.

Corte intermedio después de la segunda iteración: Gemini USD 0,814786, incremento registrado USD 0,221248. No es factura ni importe completo garantizado: hubo reportes sin consumo confirmado que activaron el freno preventivo. Se conserva esa limitación; no se sustituye consumo desconocido por cero. Los datos finales y las llamadas adicionales, si pueden verificarse con el contador corregido, se anexarán antes de cerrar el informe.

Los estímulos sintéticos reutilizados y nuevos no son llamadas a Gemini ni Luna. Su generación por Edge TTS y la infraestructura Netlify/Firestore no tienen consumo facturado medido en esta auditoría. No se inventan costos de esos servicios.

El guard de USD 1 del laboratorio parte del saldo inicial y bloquea nuevas aperturas/estímulos al acercarse al límite. No cambia la configuración mensual del servidor. Un costo no confirmado sigue siendo motivo para detener la voz; la corrección solo espera el frame real del proveedor antes de declarar ese estado.
