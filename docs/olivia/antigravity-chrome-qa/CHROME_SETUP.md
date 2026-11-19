# Configuración y Control de Google Chrome — Auditoría QA Antigravity

**Fecha de referencia:** 10 de noviembre de 2026  
**Entorno de ejecución:** Google Antigravity IDE sobre Windows 10/11 x64  
**Versión de Chrome detectada y verificada:** Google Chrome 157.0.8103.39 (Canal oficial, 64 bits)

---

## 1. Detección del Entorno y Herramientas de Navegador

- **Entorno del Asistente:** Antigravity IDE (Node.js runtime v22.17.1, npm 10.9.2, PowerShell 7).
- **Comando `/browser`:** En la interfaz de Antigravity, `/browser` es un slash command de UI diseñado para el usuario operador.
- **Browser Subagent:** Invocado formalmente mediante `invoke_subagent` (TypeName: `browser`, Conversation ID: `188c683f-2eb3-42af-85dd-63173e04bdcd`).
- **Chrome DevTools MCP:** El subagente cuenta con las herramientas MCP registradas (`mcp_chrome_devtools_list_pages`, `mcp_chrome_devtools_navigate_page`, `mcp_chrome_devtools_take_screenshot`, `mcp_chrome_devtools_evaluate_script`, `mcp_chrome_devtools_take_snapshot`).

---

## 2. Configuración del Proceso de Chrome y Remote Debugging

### Restricciones Técnicas Identificadas en Chrome 157+
1. **Validación de Origen y Host:** Al habilitar `--remote-debugging-port=9222`, Chrome 124+ y versiones superiores aplican políticas estrictas de seguridad. Cualquier petición HTTP a los endpoints `/json/*` sin la bandera `--remote-allow-origins=*` es inmediatamente rechazada con desconexión TCP (`ECONNRESET` / `FinWait1`).
2. **Aislamiento de Perfil por Defecto:** Iniciar `--remote-debugging-port` directamente sobre el perfil de usuario habitual (`User Data`) sin cerrar procesos previos en segundo plano (`--no-startup-window`) delega en la instancia existente sin abrir el puerto TCP. Se requiere un directorio de datos dedicado de QA (`--user-data-dir="C:\Users\agsba\.chrome-qa"`) o cerrar instancias background previas.
3. **Formato de `DevToolsActivePort`:** Las herramientas de Puppeteer / Chrome DevTools MCP requieren que el archivo `DevToolsActivePort` contenga dos líneas obligatorias:
   - Línea 1: Puerto TCP (ej. `9222`)
   - Línea 2: Ruta del WebSocket del navegador (ej. `/devtools/browser/<guid>`)

### Parámetros de Lanzamiento de Chrome Verificados
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-allow-origins=* `
  --user-data-dir="C:\Users\agsba\.chrome-qa" `
  https://deploy-preview-63--appintegralflormia.netlify.app/gestion/settings
```

---

## 3. Verificación de Conectividad y Control Bidireccional

1. **Endpoint de Versión:** `http://127.0.0.1:9222/json/version` respondiendo con HTTP 200:
   - `Browser: Chrome/157.0.8103.39`
   - `Protocol-Version: 1.3`
   - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36`
   - `webSocketDebuggerUrl: ws://127.0.0.1:9222/devtools/browser/2b85c6c7-ed9d-4db1-9695-9c5eaab7a9d1`
2. **Listado de Pestañas (`list_pages`):** Conexión exitosa, reconociendo la pestaña ID `6DA9F5DB81ACF2D7602E1778ABBF9F16` (`Gestión | Flor Mía`).
3. **Control CDP:** Automatización nativa mediante CDP (Chrome DevTools Protocol) vía WebSocket en Node.js v22 para navegación, eventos de red, captura de consola y screenshots.

---

## 4. Perfiles, Sesión y Límites de Seguridad

- **Perfil Utilizado:** Perfil aislado de QA (`.chrome-qa`). Al ser un perfil limpio, las rutas privadas (`/gestion/*`) presentan la interfaz de `LoginPage` ("Superficie privada · Bienvenido").
- **Política de No Extracción:** Siguiendo la regla de seguridad del proyecto, no se extrajeron tokens ni cookies del perfil habitual del usuario.
- **Alcance de Red:** Conexión restringida estrictamente a `127.0.0.1:9222` (loopback local) y al dominio autorizado `deploy-preview-63--appintegralflormia.netlify.app`. Nunca expuesto a 0.0.0.0 ni a redes externas.
