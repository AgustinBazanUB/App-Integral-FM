# Registro de decisiones técnicas

1. React/Vite y la web aprobada son la base para conservar SEO, assets y experiencia pública.
2. `/gestion` se carga de forma diferida para no enviar Firebase a visitantes de la tienda.
3. Firebase npm reemplaza imports CDN dentro de la nueva superficie; la lógica de dominio legacy permanece reutilizable.
4. El catálogo maestro seguirá siendo `products`; el catálogo JavaScript público se conserva hasta validar datos comerciales reales.
5. Firestore es la autoridad de permisos; la interfaz sólo refleja esa autoridad.
6. Las transacciones de venta conservan el esquema legacy por compatibilidad y bloquean stock negativo.
7. Las colecciones integrales son aditivas y sus reglas no se despliegan automáticamente.
8. No se incorpora una librería de gráficos: el panel inicial usa SVG/CSS accesible y evita peso innecesario.
9. Lucide React es el único sistema de iconos.
10. El JSON visual se convirtió en tokens CSS prefijados para no alterar la web pública.
11. El logo entregado se conserva como asset real; la versión SVG aprobada se usa donde aporta mejor legibilidad.
12. Netlify es el despliegue principal; Firebase Hosting no es necesario.
13. El panel consulta `sales` por fecha inicial, fecha final exclusiva, estado activo y grupos de hasta diez ubicaciones; combina resultados por ID para evitar duplicados y conserva una caché breve por período.
14. Los límites mensuales y diarios se construyen en `America/Argentina/Buenos_Aires`; así una venta cercana a medianoche no cambia de día por UTC.
15. La actividad unifica `auditLogs`, ventas y movimientos históricos en páginas con cursor. Los movimientos generados por ventas y los eventos auditados equivalentes se deduplican.
16. El catálogo por ubicación se resuelve con una unión dinámica `products` + `locationStock`; no se crean documentos vacíos al crear una ubicación.
17. Las cargas múltiples usan una transacción y un `operationId` idempotente. Cada producto genera un movimiento determinístico y la operación genera un único evento de auditoría.
18. Asignar vendedores modifica ambos lados de la relación en una transacción y queda reservado a administración general. Los descuentos por ubicación guardan sólo IDs de definiciones maestras.
