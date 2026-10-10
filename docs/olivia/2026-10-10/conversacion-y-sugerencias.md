# Conversación y sugerencias de Olivia

La conversación fluida se habilita únicamente para `agsreserva@gmail.com`, usando el correo autenticado por Firebase. Conversar inicia GPT Live 1, con voz Marin fija y presentación femenina. Las consultas y operaciones se delegan a GPT-6 Luna con razonamiento bajo para reducir la espera. La autorización y las confirmaciones de operaciones comerciales siguen en el backend; una respuesta oral no ejecuta una operación.

La interfaz habitual no muestra selectores de transporte, modelos ni voces. Modo desarrollador de Olivia muestra la configuración fija y las mediciones. Los demás usuarios conservan texto y dictado.

Vendedores y administradores pueden escribir, por ejemplo: «Olivia, comunicale a Agustín que en este panel quiero ver el stock antes de cargar unidades». Luna reformula el problema y el comportamiento solicitado usando el contexto de pantalla. Si falta la idea concreta, Olivia pregunta antes de enviarla. El destinatario es la cuenta administrativa activa `agsreserva@gmail.com`; ningún parámetro del cliente o del modelo cambia el destinatario.

La sugerencia genera una alerta asignada a Agustín y visible en su campanita de notificaciones. En Alertas, Ver propuesta muestra el autor, fecha, pantalla, reformulación y mensaje original; Copiar para Codex copia la propuesta completa. El envío no modifica la aplicación ni ejecuta una operación comercial. Los reintentos de la misma solicitud usan un identificador único para evitar alertas duplicadas.

Documentación oficial consultada:

- [Creación de sesiones GPT Live y voz inmutable](https://developers.openai.com/api/reference/resources/live/methods/create)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)

La llamada real con micrófono debe probarse con la cuenta autorizada y la conexión OpenAI de producción. Las verificaciones automatizadas cubren autenticación, transporte, voz, delegación, reservas y facturación, además del envío de sugerencias y sus condiciones de error.
