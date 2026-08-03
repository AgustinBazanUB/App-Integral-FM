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
