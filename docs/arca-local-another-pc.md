# Continuar ARCA Etapa 2 en otra PC

## Recuperar el checkpoint

Windows: instalar Git, Node 20 o 24 y Java 21 para el emulador. Git para Windows incluye OpenSSL en su instalación habitual. No copiar `node_modules`, `.netlify` ni archivos de credenciales a GitHub.

```powershell
git clone --branch feature/arca-integration --single-branch https://github.com/AgustinBazanUB/App-Integral-FM.git App-Integral-FM-ARCA
cd App-Integral-FM-ARCA
npm ci
npm run test:arca
npm run test:rules:fiscal
npm run test:rules:core
npm run build
git diff --check
```

Si ya existe el clon, revisar `git status --short` y actualizar con `git pull --ff-only origin feature/arca-integration`. No descartar cambios locales para actualizar. El checkpoint de cierre se identifica en `docs/arca-stage2-close.md` y en el mensaje de commit `fix(arca): close stage 2 security checkpoint`.

Las pruebas ARCA usan fixtures y bloquean conexiones reales: no usan certificados del usuario, no emiten CAE y no consumen créditos de Netlify. Los emuladores usan exclusivamente `demo-flor-mia-integral`. Si Java no está en PATH, configurar `JAVA_HOME` hacia la instalación local y agregar su carpeta `bin` al PATH de esa terminal.

## Ver el componente sin credenciales

```powershell
npm run preview:arca
```

Abrir `http://127.0.0.1:5175/`. Dejar desmarcado **Usar Function local de homologación**. Abrir receptor fiscal: total ficticio 500, Consumidor Final, preparar y confirmar. Probar total ficticio 1000: debe exigir identificación. Para CUIT usar `20123456786`: el harness devuelve datos ficticios. Verificar también un CUIT inválido, Escape, retorno del foco y anchos 375/430 px con las herramientas responsive del navegador.

El umbral 1000 sólo pertenece al fixture de prueba. **No es un umbral fiscal recomendado.** El preview no está conectado a las ventas ni forma parte del build publicado. La confirmación sólo devuelve un receptor; no crea invoice ni CAE.

## Netlify Dev con archivos locales

Copiar por un medio privado y seguro los archivos de homologación y el JSON de Firebase a una carpeta **fuera del repositorio** de la nueva PC. No pasarlos por el chat ni subirlos a GitHub. No cambiar las claves para ejecutar estas pruebas.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/dev-arca.ps1 `
  -CertificatePath "C:\Credenciales-FM\flor-mia-homologacion.pem" `
  -PrivateKeyPath "C:\Credenciales-FM\flor-mia-homologacion.key" `
  -ServiceAccountPath "C:\Credenciales-FM\firebase-billing.json"
```

Reemplazar únicamente las rutas por las reales. El lanzador valida el proyecto Firebase, carga credenciales sólo en la memoria del proceso, usa homologación/PV 3, restaura el entorno al salir y ejecuta Netlify Dev offline. No necesita `netlify login`, `netlify link`, `.env` ni recuperar secretos de Netlify. No cambia los gates existentes. Una guardia local bloquea FECAESolicitar y escrituras fiscales del backend, y registra sólo método, host y tipo de operación en `.netlify/arca-local-readonly-audit.jsonl`; nunca cuerpos ni credenciales.

Abrir `http://localhost:8888/gestion/settings`, ingresar como administrador y revisar ARCA. Para conflictos de puertos, agregar `-Port 8894 -VitePort 5176`. Si el proxy de Netlify Dev no renderiza correctamente Vite, mantenerlo abierto y ejecutar en **otra terminal**:

```powershell
node scripts/dev-arca-proxy.mjs 8888 5174
```

Abrir `http://127.0.0.1:5174/gestion/settings`. Si Netlify Dev usa 8894, reemplazar 8888 por 8894 en ese comando. Es un proxy local de la aplicación **y sus Functions**, no sólo Vite. Iniciar sesión nuevamente si cambia el origen/puerto.

Para comprobar el diálogo contra la Function local, después de ingresar abrir en ese mismo origen `/tests/fixtures/arca-ui/index.html` y marcar **Usar Function local de homologación**. Usar exclusivamente el CUIT oficial de testing `20164755100`, o verificar el error explícito de configuración de Consumidor Final. No usar clientes reales para QA, no autorizar facturas ni ejecutar acciones de ventas. El harness genera cero facturas.

## Interpretar resultados sin activar emisión

- `NO OPERATIVO` con faltantes de IVA/datos visibles del emisor: falta configuración; no es una caída de ARCA.
- Umbral ausente: `Falta configurar el umbral de identificación de Consumidor Final.` No completar con un importe inventado. El umbral vigente requiere validación fiscal independiente.
- `arca-wsaa-already-authenticated`: WSAA conserva un ticket vigente que la instancia local no tiene. Evitar reiniciar reiteradamente o regenerar certificados. La recuperación durable requiere la configuración aprobada de caché WSAA; este checkpoint no crea ni cambia su secreto.
- Timeout, red o 5xx remotos: indisponibilidad temporal, conservando separados los faltantes locales.
- Firebase OAuth/Firestore en verde: autorización backend validada; no acredita por sí sola el Padrón ni habilita emisión.

La Etapa 2 prepara un componente reutilizable; su conexión definitiva a Venta Rápida queda para la etapa siguiente. `seller_sale` y `ecommerce` siguen fuera de la allowlist de autorización automática.

## Publicación y reglas

Los comandos anteriores no despliegan ni consumen builds cloud. El sitio publicado de esta entrega es `flor-mia-arca-homologacion`, no el sitio de producción. No ejecutar deploys mientras se trabaja localmente.

Checkpoint de código publicado: `5f2e7f514a9db645b0a0ff28df5b40be3f6a3ee1`. [Entrega inmutable](https://6abd7ece26ed9768d7397eed--flor-mia-arca-homologacion.netlify.app), confirmada Published. Los builds automáticos quedaron detenidos; el HEAD posterior contiene esta evidencia documental. Detalles y límites en [arca-stage2-close.md](arca-stage2-close.md).

**Netlify no publica `firestore.rules`.** Las reglas de este checkpoint pasan el emulador, pero su publicación al Firebase compartido requiere coordinar antes el frontend productivo: versiones anteriores aún envían `invoiceStatus` desde el navegador y las nuevas reglas lo rechazan. No publicar esas reglas aisladas contra `app-integral-fm` ni cambiar main durante estas pruebas. La futura publicación productiva debe migrar cliente y reglas de manera coordinada.

La suite general del repositorio tiene cinco fallos de interfaz previos, reproducidos en la base; están enumerados en el informe de cierre. No confundirlos con los tests ARCA/Firestore que pasan.
