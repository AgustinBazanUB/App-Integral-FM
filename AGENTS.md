# Regla obligatoria: cambios, previews y producción

Estas instrucciones se aplican a todo el repositorio y a cualquier persona o agente que trabaje en él. El usuario decide cuándo una actualización pasa a producción.

## Trabajo y revisión

1. Partir de `origin/main` actualizado y crear una rama para cada actualización. Trabajar y subir cambios a esa rama, no directamente a `main`.
2. Preparar un pull request hacia `main` y su Deploy Preview de Netlify. Agrupar cambios y validaciones para evitar builds innecesarios: los previews y las funciones pueden consumir créditos y recursos; no son gratis por definición.
3. Antes de crear o modificar datos, verificar que el frontend, las Functions, Authentication y Firestore del preview apunten al proyecto aislado `app-integral-fm-pruebas`. Comprobar el contexto y las credenciales del servidor, sin exponer secretos. Si no se puede verificar el destino o la configuración es incompleta o mixta, detener las pruebas con escrituras y comunicarlo. Nunca usar el Firebase original como alternativa para probar.
4. Probar con datos ficticios y conservar esos registros en el proyecto de pruebas. Informar el enlace del preview, el commit, las verificaciones realizadas y los límites. Esperar a que el usuario revise visualmente la actualización y exprese que desea integrar esa actualización específica a `main`. Que CI pase, un preview esté listo o el usuario pida continuar no equivale por sí solo a esa autorización.
5. Solo después de esa autorización explícita, integrar a `main`, verificar el despliegue de Netlify y, si cambian reglas o índices, verificar su despliegue a Firebase de producción `app-integral-fm`. Confirmar el commit publicado y comunicar cualquier fallo o paso pendiente.

## Separación de datos

- Nunca copiar, importar, sincronizar ni migrar ventas, clientes, usuarios, inventario, movimientos, pedidos u otros datos de prueba de `app-integral-fm-pruebas` a `app-integral-fm` al fusionar o desplegar. La promoción lleva código y configuraciones revisadas; no lleva documentos, cuentas ni datos de prueba.
- No crear casos de prueba, realizar pruebas con escrituras, emitir comprobantes, enviar mensajes ni alterar stock en producción durante la revisión. No modificar ni eliminar datos de producción como limpieza automática.
- Si aparecen datos de prueba en producción, detenerse, identificarlos de forma segura y presentar un plan de conciliación que contemple ventas, movimientos, stock y efectos fiscales. No borrar ni compensar datos sin una solicitud explícita y específica del usuario; conservar la auditoría.
- No copiar datos reales de producción a staging para preparar pruebas. Usar datos sintéticos; no guardar credenciales o datos personales en el repositorio.

Una rama, un preview y esta norma no sustituyen las protecciones técnicas de Netlify, GitHub o Firebase. Verificar cada entorno antes de operar. La guía de conexión está en `docs/FIREBASE-PRUEBAS.md`.
