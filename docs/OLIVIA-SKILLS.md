# Skills de Olivia

El catálogo del servidor (`skills.mjs`) tiene siete skills internas. El cargador valida nombre, versión, rol y herramientas requeridas; Netlify incluye sus archivos en el bundle. Una skill no concede permisos.

| Skill | Versión | Uso |
| --- | --- | --- |
| pronosticar-feria | 1.1.0 | Escenarios, mercadería y propuesta de transferencia |
| analizar-ventas | 1.1.0 | Métricas y comparación de períodos |
| operar-panel-vendedor | 1.1.0 | Venta, stock, precios y ayuda del vendedor |
| guiar-uso-aplicacion | 1.0.0 | Procedimientos reales, contexto y explicación de datos |
| guiar-interfaz-visual | 1.0.0 | Pasos registrados, sin hacer clic ni escribir |
| conversacion-natural-argentina | 1.0.0 | Voseo y continuidad de conversación |
| idear-y-crear | 1.0.0 | Ideas, nombres, códigos, textos y programación |

La selección es contextual, hasta dos procesos por turno. La ruta creativa carga ideación y conversación natural, sin herramientas empresariales. Los recorridos registrados usan reglas deterministas con las versiones de guía y cero llamadas de modelo. El panel vendedor conserva prioridad para su manual específico. Los seguimientos mantienen solo versiones aún autorizadas.

La skill de desarrollo para Codex está en `.agents/skills/olivia-guia-conversacional/SKILL.md`; es distinta del catálogo que usan las conversaciones. El diseño y los límites están en [OLIVIA-COPILOT.md](OLIVIA-COPILOT.md).
