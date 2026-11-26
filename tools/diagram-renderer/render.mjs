import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";

const diagrams = [
  [
    "00-macro-a-frontera-fisica",
    "Pantallas, servidor y datos",
    "Qué se guarda en el celular, qué se envía al servidor y qué llega a la nube."
  ],
  [
    "00-macro-b-macro-dominios",
    "Cómo se conectan las áreas",
    "Cómo comparten productos, ventas, envíos y datos las áreas de Flor Mía."
  ],
  [
    "00-macro-c-quiebre-venta-fisica-vs-web",
    "Venta en local y compra en tienda web",
    "El pedido web queda pendiente antes del cobro y sin reservar stock."
  ],
  [
    "01-d1-catalogo-inventario",
    "Catálogo e inventario",
    "Cómo el catálogo maestro se vincula con los saldos y sus movimientos."
  ],
  [
    "02-d2-ventas-pos-crm",
    "Ventas y clientes",
    "Cómo se registra una venta y se recupera una operación sin conexión."
  ],
  [
    "03-d3-finanzas-metricas-arca",
    "Finanzas, métricas y ARCA",
    "Qué se deriva de las ventas y qué pasa por el circuito fiscal."
  ],
  [
    "04-d4-logistica-envios",
    "Logística y envíos",
    "Quién confirma cada paso de la entrega y qué queda pendiente."
  ],
  [
    "05-d5-ecommerce-pedidos-web",
    "Tienda online y pedidos web",
    "Dónde se interrumpe el pedido y qué permite la simulación local."
  ],
  [
    "06-d6-marketing-campanas",
    "Marketing y campañas",
    "Qué pasos se ejecutan dentro de Gestión y cuáles dependen de servicios externos."
  ],
  [
    "07-d7-olivia-ia",
    "Asistente IA Olivia",
    "Cómo se conectan conversación, voz, conocimiento y retención."
  ],
  [
    "08-d8-plataforma-gobernanza",
    "Plataforma y gobernanza",
    "Cómo se controla el acceso y se verifica el entorno de pruebas."
  ]
];
const sourceFolder = new URL("../../docs/diagrams/mmd/", import.meta.url);
const outputFolder = new URL("../../docs/diagrams/svg/", import.meta.url);
const viewer = new URL("../../docs/diagrams/index.html", import.meta.url);
const themePath = new URL("../../.agents/skills/mermaid-diagram/references/mermaid-theme.md", import.meta.url);
const themeSource = await readFile(themePath, "utf8");
const themeConfig = themeSource.match(/```json\r?\n([^]*?)\r?\n```/)?.[1];
const { base: theme, ...themeOverrides } = JSON.parse(themeConfig);
if (!Object.hasOwn(THEMES, theme)) throw new Error("Tema base no disponible.");
const classRules = [...themeSource.matchAll(/^classDef (\w+) (.+)$/gm)];
const dashedClasses = new Map(classRules.flatMap(([, name, rules]) => {
  const dash = rules.match(/stroke-dasharray:([\d ]+)/);
  return dash ? [[name, dash[1]]] : [];
}));

function renderSvg(source) {
  const dashedNodes = new Map();
  for (const [, id, name] of source.matchAll(/^\s+(\w+)\S+.*?:::(\w+)$/gm)) {
    if (dashedClasses.has(name)) dashedNodes.set(id, dashedClasses.get(name));
  }
  return renderMermaidSVG(source, {
    ...THEMES[theme],
    ...themeOverrides,
    nodeSpacing: 30,
    layerSpacing: 54,
    portSpacing: 14,
    padding: 24,
  })
    .replace(/^\s*@import url\([^\n]+\);\r?\n/gm, "\n")
    .replace(/<g class="node" data-id="([^"]+)"[^]*?<\/g>/g, (group, id) => {
      const dash = dashedNodes.get(id);
      return dash
        ? group.replace(/stroke="(?!none")([^"]+)"/g, 'stroke="$1" stroke-dasharray="' + dash + '"')
        : group;
    });
}

const expectedFiles = diagrams.map(([id]) => id + ".mmd").sort();
const actualFiles = (await readdir(sourceFolder)).filter((file) => file.endsWith(".mmd")).sort();
if (expectedFiles.join("\n") !== actualFiles.join("\n")) {
  throw new Error("El índice y los archivos .mmd no coinciden.");
}

const results = [];
for (const [id, title, description] of diagrams) {
  const source = (await readFile(new URL(id + ".mmd", sourceFolder), "utf8")).replaceAll("\r\n", "\n");
  const definitions = source.match(/^\s*classDef .+$/gm)?.map((line) => line.trim()) || [];
  if (definitions.join("\n") !== classRules.map(([line]) => line).join("\n")) {
    throw new Error(id + ": las clases difieren de mermaid-theme.md.");
  }

  const svg = renderSvg(source);
  const labels = [...source.matchAll(/^\s+\w+[^"]+"([^"]+)"[^\n]*:::\w+$/gm)].map((match) => match[1]);
  const renderedLabels = [...svg.matchAll(/<g class="node" data-id="[^"]+" data-label="([^"]+)"/g)].map((match) => match[1]);
  if (labels.length < 1 || labels.length > 12 || labels.sort().join("\n") !== renderedLabels.sort().join("\n")) {
    throw new Error(id + ": hay nodos omitidos, etiquetas alteradas o más de 12 nodos.");
  }
  const sourceArrows = [...source.matchAll(/(?:-->|-\.->)\|"([^"]+)"\|/g)];
  const svgArrows = [...svg.matchAll(/<polyline class="edge" [^>]*>/g)];
  if (sourceArrows.length !== svgArrows.length || svgArrows.some(([edge]) => !/data-label="[^"]+"/.test(edge))) {
    throw new Error(id + ": faltan etiquetas en una o más flechas.");
  }

  const [, width, height] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || [];
  if (!(Number(width) > 0 && Number(height) > 0)) throw new Error(id + ": viewBox inválido.");

  results.push({ id, title, description, source, svg, width: Number(width), height: Number(height) });
}

const palette = classRules.map(([, id, rules]) => ({
  id,
  color: rules.match(/\bfill:(#[\da-f]{6})/i)[1],
  dashed: dashedClasses.has(id),
}));
const template = await readFile(new URL("./viewer.template.html", import.meta.url), "utf8");
const data = JSON.stringify({ diagrams: results, palette }).replaceAll("<", "\\u003c");
const html = template.replace("{{DIAGRAM_DATA}}", () => data);

await mkdir(outputFolder, { recursive: true });
for (const { id, svg } of results) await writeFile(new URL(id + ".svg", outputFolder), svg + "\n");
await writeFile(viewer, html);
console.log(results.length + " diagramas SVG · " + theme + " · visor actualizado");
