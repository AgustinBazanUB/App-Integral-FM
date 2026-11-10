# Guía de validación de Olivia V8.1

Cuando el Deploy Preview esté listo, abrí su URL de `/gestion` con la cuenta administradora de pruebas. Confirmá que el entorno indique staging antes de cargar datos. No uses producción.

## Conversación y prioridad del último pedido

1. Activá **Conversar** y saludá a Olivia. Esperá respuesta y comprobá la burbuja en vivo.
2. Empezá una carga de stock sin completarla. Preguntá cuánto se vendió ayer; Olivia debe contestar y dejar el borrador en pausa sin insistir en él.
3. Pedí «volvamos a la carga», cambiá de local a depósito y dicta dos productos, con una pausa natural.
4. Corregí solo la cantidad del segundo producto. La primera línea debe seguir igual.
5. Decí «sí, confirmalo». La operación debe seguir pendiente hasta tocar **Sí, confirmar operación**.

## Validación de depósito

Usá únicamente un depósito y productos identificados como pruebas. Verificá que la tarjeta indique el depósito, el delta y el stock previo/nuevo. Cancelá cualquier propuesta que no reconozcas. Si confirmás una carga sintética, conserva su auditoría y registro de prueba.

## Panel y revisión

Abrí **Tareas de Olivia (N)**, revisá estados e historial y desplegá **Lo que dijo Olivia por voz**. Registrá frases, respuesta, modalidad, ruta y evidencia en la planilla de conversación. Compará latencia desde sonido audible, no desde una marca `schedule`.

El PR permanecerá Draft hasta que revises visualmente el preview. Integración a `main` o producción requiere aprobación expresa para esta actualización específica.
