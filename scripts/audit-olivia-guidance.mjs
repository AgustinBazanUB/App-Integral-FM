import fs from 'node:fs';
import { OLIVIA_CAPABILITIES } from '../src/shared/oliviaCapabilities.mjs';
import { OLIVIA_TOOL_SCHEMAS } from '../src/shared/oliviaContracts.mjs';
import { OLIVIA_APP_GUIDE } from '../src/shared/oliviaAppGuide.mjs';
import { fieldGuidance, OPERATION_NAMES } from '../src/shared/oliviaOperationGuide.mjs';
import { requiredFields } from '../netlify/functions/_lib/olivia/tasks.mjs';
const folder = 'docs/olivia/2026-10-30/contexto-y-guia';
const disabled = new Set(['prepare_shipment_create', 'prepare_shipment_update']);
const tools = [...new Set([...Object.keys(OLIVIA_TOOL_SCHEMAS), ...Object.keys(OLIVIA_CAPABILITIES)])].map(name => ({
  name, module: OLIVIA_CAPABILITIES[name]?.module || 'core',
  action: OPERATION_NAMES[name] || OLIVIA_CAPABILITIES[name]?.description || name,
  mode: disabled.has(name) ? 'manual: sin herramienta habilitada' : name.endsWith('_review') || name === 'prepare_product_create' ? 'revisión en formulario' : name.startsWith('prepare_') ? 'tarjeta de confirmación' : 'lectura o navegación',
  fields: requiredFields(name).map(field => ({ field, explanation: fieldGuidance(name, field) })),
}));
const gaps = tools.flatMap(tool => tool.fields.filter(field => !field.explanation).map(field => `${tool.name}:${field.field}`));
if (gaps.length) throw new Error(`Guías incompletas: ${gaps.join(', ')}`);
const report = { source: 'Contratos y mapa vigentes; no llama proveedores ni lee datos comerciales', modules: OLIVIA_APP_GUIDE.length, tools: tools.length, missingFieldGuides: gaps, guide: OLIVIA_APP_GUIDE, operations: tools };
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(`${folder}/AUDITORIA.json`, JSON.stringify(report, null, 2) + '\n');
const lines = ['# Auditoría de contexto y guía de Olivia', '', `Se revisaron ${report.tools} herramientas y ${report.modules} módulos documentados, contrastados con los esquemas del servidor y la guía de funciones de la aplicación. Cero campos mínimos sin explicación. Las guías describen entradas: no agregan permisos ni herramientas.`, '',
  '## Qué fallaba en la charla revisada', '',
  '- Pedir repetir con más detalle no se reconocía como explicación; el backend volvía a usar la repregunta de la tarea pendiente.',
  '- La repregunta determinista reemplazaba la respuesta por una lista de campos sin explicar su significado.',
  '- Pedir documentar la mejora no incluía el nombre Agustín y no entraba al flujo de sugerencias; se interpretaba como continuación del alta.',
  '- Ubicaciones exigía dniMode, una configuración que no tiene consumidores activos en el código de ventas. Se retiró del formulario, contratos y nuevas escrituras. No se alteran documentos históricos.',
  '', '## Cambios y límites', '',
  '- Guía compartida con ejemplos por dato, uno o dos relacionados por turno; explicación detallada cuando se solicita. No pide IDs ni centavos al usuario.',
  '- La explicación de campos conserva la tarea. Documentar una mejora la pausa y conserva los datos para retomar. Los datos de una tarea iniciada sin modelo también conservan su intención en turnos posteriores.',
  '- La propuesta se guarda como borrador en el chat. Reformularla conserva la propuesta anterior y 16 mensajes recientes de contexto. Solo una aceptación inequívoca posterior envía exactamente la versión revisada a las notificaciones internas de Agustín.',
  '- Rechazar no envía; una tarea nueva deja de usar el borrador. La confirmación de una sugerencia no confirma ninguna operación comercial. No se reprograma a Olivia automáticamente: el cambio de software lo revisa Agustín.',
  '- Las tareas y el borrador pertenecen a la conversación y a su retención. No se promete memoria permanente entre chats. La guía natural es una regla general de esta versión para todos los usuarios autorizados.',
  '- No se cambia de modelo, voz ni biblioteca de audios. Inicios acotados y explicaciones de campos usan cero llamadas de modelo; preparar/reformular sugerencias usa una llamada, aceptar/rechazar cero.',
  '- El grafo de Graphify consultado es parcial (la extracción anterior tiene referencias externas sin resolver); los hallazgos se verificaron leyendo los contratos y flujos, no suponiendo que el grafo cubre toda la app.',
  '', '## Funciones de la aplicación', '',
  '| Módulo | Ayuda de Olivia | Flujo manual y límites |', '| --- | --- | --- |',
  ...OLIVIA_APP_GUIDE.map(row => `| ${row.title} | ${row.assisted} | ${row.manual} |`),
  '', '## Datos de cada herramienta', '', '| Herramienta | Alcance | Datos mínimos explicados |', '| --- | --- | --- |',
  ...tools.map(tool => `| ${tool.name} | ${tool.mode} | ${tool.fields.map(field => `${field.field}: ${field.explanation}`).join('<br>') || 'Sin datos mínimos adicionales; valida su contrato'} |`), '',
  '## Validación', '', 'Ver VALIDACION.md para los resultados del commit publicado y el entorno verificado. Las pruebas automáticas usan datos sintéticos y adaptadores en memoria; no miden comprensión general de todos los mensajes posibles ni calidad de audio físico.', '',
];
fs.writeFileSync(`${folder}/AUDITORIA.md`, lines.join('\n'));
console.log(JSON.stringify({ tools: report.tools, modules: report.modules, missingFieldGuides: gaps.length }));
