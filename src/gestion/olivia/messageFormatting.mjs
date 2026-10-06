import { createElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function oliviaSafeLink(value) {
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Unverified destinations render as text. */ }
  return "";
}

const literal = text => text.replace(/([\\`*_{}\[\]<>#|~])/g, "\\$1");

// Present known operational replies without changing the saved transcript
// or interpreting product names as markup.
export function oliviaDisplayMarkdown(value) {
  const text = String(value || "");
  const missing = /^Para completar la lista falta (.+)\. No se creó ni cargó nada todavía\.$/.exec(text);
  if (missing) return `### Datos que faltan\n\n${missing[1].split("; ").map(item => `- ${literal(item)}`).join("\n")}\n\nNo se creó ni cargó nada todavía.`;
  const lines = text.split(/\r?\n/);
  if (lines[0].startsWith("Ingresar mercadería en ") && lines.some(line => /^(Crear|Reutilizar) .+ · /.test(line))) {
    return `### Ingreso de mercadería\n\n${literal(lines[0])}\n\n### Productos\n\n${lines.slice(1).map(line => {
      const product = /^(Crear|Reutilizar) (.+?) · (.+)$/.exec(line);
      return product ? `- **${literal(`${product[1]} ${product[2]}`)}** · ${literal(product[3])}` : `\n${literal(line)}`;
    }).join("\n")}`;
  }
  return text;
}

const components = {
  a: ({ href, children }) => href ? createElement("a", { href, target: "_blank", rel: "noopener noreferrer" }, children) : createElement("span", null, children),
  // Attachments have their own UI; markdown images do not fetch remote content.
  img: ({ alt }) => createElement("span", null, alt || "Imagen"),
  table: ({ children }) => createElement("div", { className: "fm-olivia-table-scroll", role: "region", "aria-label": "Tabla de la respuesta", tabIndex: 0 }, createElement("table", null, children)),
};

export function OliviaRichText({ content }) {
  const markdown = oliviaDisplayMarkdown(content);
  return createElement("div", { className: "fm-olivia-rich-text" }, createElement(Markdown, {
    remarkPlugins: [remarkGfm], skipHtml: true, urlTransform: markdown === String(content || "") ? oliviaSafeLink : () => "", components,
  }, markdown));
}
