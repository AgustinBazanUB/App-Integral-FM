// A deliberately small text grammar. HTML, links and code are never evaluated.
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
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith("**") && part.endsWith("**") ? { strong: true, text: part.slice(2, -2) } : { strong: false, text: part });
}
