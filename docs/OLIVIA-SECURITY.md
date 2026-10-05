# Seguridad y auditoría

Firebase ID token y perfil activo server-side determinan autoridad. Herramientas releen el perfil; confirmaciones revalidan dentro de la transacción. UID, rol, precio, stock o permiso del cliente no son autoridad.

El registro ofrece esquemas explícitos cerrados y selección por permisos. Skills, pantalla, documentos y archivos no conceden acceso. El contexto identifica datos no confiables para evitar convertir documentos recuperados en instrucciones operativas.

Las conversaciones nuevas vinculan usuario, autenticación, rol y huella de capacidades/alcance. Cambiar permisos bloquea su reutilización como contexto. Supervisión administrativa conserva acceso al archivo histórico autorizado; vendedores no reciben historial de un anterior rol administrativo.

Todas las colecciones Olivia y mensajes niegan acceso directo cliente, incluso a administradores. Adjuntos/biblioteca se manejan por endpoints autenticados, límites de bytes reales, firma de contenido, expiración y hashes de reintentos.

Confirmaciones tienen token opaco, hash, vínculo y vencimiento de cinco minutos. Una entrada nueva reemplaza la propuesta; lecturas del mismo turno nativo la conservan. Doble clic y reintentos devuelven la operación completada sin repetirla. Rechazos concurrentes no dejan escrituras parciales.

Auditoría comercial conserva usuario/nombre/rol, origen Asistente IA / Olivia, conversación, solicitud de preparación, confirmación, herramienta, Skill/version e input relevante; operaciones incluyen estado previo/posterior. Eventos separados registran lecturas y resultado. No se graban audios ni credenciales.

La limpieza temporal tiene tamaño y presupuesto de ejecución acotados y conserva backlog. Retirar conocimiento revoca localmente antes de la limpieza externa. CSP admite miniaturas blob y cámara/micrófono propios; no habilita ejecución de documentos ni claves OpenAI en navegador.

Si Olivia falla, los módulos manuales permanecen disponibles. Emisión fiscal, roles y credenciales conservan controles existentes y no son mutaciones arbitrarias del agente.
