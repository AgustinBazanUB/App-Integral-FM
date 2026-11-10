# Verificación de Deploy Preview y Aislamiento de Entorno

**Fecha de auditoría:** 10 de noviembre de 2026  
**Auditor:** Antigravity QA Engineer (Google Antigravity / Gemini 3.8 Flash High)

---

## 1. Identificación y Trazabilidad del Build

| Elemento | Valor Verificado | Método de Comprobación |
|---|---|---|
| **Repositorio** | `https://github.com/AgustinBazanUB/App-Integral-FM` | `git remote -v`, GitHub CLI |
| **Rama de referencia** | `feat/olivia-conversacion-v8-1` | `git branch --show-current`, HEAD comprobado |
| **Commit SHA de referencia** | `77667cb650555211e412b06810f443df634e058b` | `git rev-parse HEAD`, GitHub API |
| **Pull Request** | `#63` (Título: `feat(olivia): Olivia V8.1 prioriza la última intención`) | `gh pr view 63`, Estado: DRAFT |
| **Run de GitHub Actions** | `42878501326` (Workflow `test-build` aprobado) | `gh pr checks 63`, `gh api` |
| **Deploy Preview de Netlify** | `https://deploy-preview-63--appintegralflormia.netlify.app` | Netlify deploy ID `6af36666c8288547674d3408` |
| **Estado del Deploy Preview** | READY (HTTP 200) | Inspección de red en Google Chrome |

---

## 2. Aislamiento Estricto de Firebase

Se inspeccionó directamente el bundle compilado en producción servido por Netlify (`assets/index-Bf1H58oZ.js`) comprobando la configuración activa de Firebase Web SDK:

```javascript
{
  apiKey: "AIzaSyBfJUuxIpQm0rFmbrlhSP420zgGw2AnqRs",
  authDomain: "app-integral-fm-pruebas.firebaseapp.com",
  projectId: "app-integral-fm-pruebas",
  storageBucket: "app-integral-fm-pruebas.firebasestorage.app",
  messagingSenderId: "545036860675",
  appId: "1:545036860675:web:c76e458afc8f8f706f7d36"
}
```

### Contrastación de Seguridad:
1. **Proyecto Firestore / Auth:** `app-integral-fm-pruebas` (Proyecto aislado de staging).
2. **Proyecto de Producción Prohibido:** `app-integral-fm` no está activo en el frontend ni en las solicitudes de red.
3. **Credenciales Cruzadas:** Las credenciales de producción (`AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg`, senderId `447903189609`) se verificaron ausentes del runtime activo.
4. **Protección de Servidor (`firebaseProject.mjs`):** Netlify Functions exige coincidencia entre el projectId cliente y el projectId de la cuenta de servicio (`netlify-deploy-preview-staging@app-integral-fm-pruebas.iam.gserviceaccount.com`). Si difieren, las funciones rechazan las peticiones.

---

## 3. Estado de la Superficie de Gestión

- Al navegar a `/gestion/settings` y cualquier submódulo sin credenciales en el perfil limpio de QA, la aplicación renderiza defensivamente `LoginPage` ("Superficie Privada").
- No se expusieron contraseñas, tokens JWT ni datos de clientes.
- Cero peticiones fallidas (HTTP 4xx/5xx) y cero errores de JavaScript en consola durante el acceso inicial.
