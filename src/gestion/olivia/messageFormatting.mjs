// A small text grammar. HTML and code stay literal; links allow HTTP(S) only.
export function oliviaMessageBlocks(content = "") {
  const blocks = [];
  for (const line of String(content).split(/\r?\n/)) {
    if (!line.trim()) { blocks.push({ type: "break" }); continue; }
    const bullet = /^\s*(?:[-*•]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    if (bullet) {
      const type = /^\s*\d/.test(line) ? "ordered" : "list";
      if (blocks.at(-1)?.type === type) blocks.at(-1).items.push(bullet[1]);
      else blocks.push({ type, items: [bullet[1]] });
    } else if (blocks.at(-1)?.type === "paragraph") blocks.at(-1).text += `\n${line}`;
    else blocks.push({ type: "paragraph", text: line });
  }
  return blocks.filter((block) => block.type !== "break");
}

export function oliviaInlineParts(text = "") {
  return String(text).split(/(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g).filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) return { strong: true, text: part.slice(2, -2) };
    const match = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (match) try {
      const url = new URL(match[2]);
      if (!url.username && !url.password) return { strong: false, text: match[1], href: url.href };
    } catch { /* Invalid links remain text. */ }
    return { strong: false, text: part };
  });
}
