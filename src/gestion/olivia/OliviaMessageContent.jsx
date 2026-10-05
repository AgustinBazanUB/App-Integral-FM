import { oliviaMessageBlocks, oliviaInlineParts } from "./messageFormatting.mjs";

const inline = (text) => oliviaInlineParts(text).map((part, index) => part.strong ? <strong key={index}>{part.text}</strong> : part.text);

export default function OliviaMessageContent({ content }) {
  return oliviaMessageBlocks(content).map((block, index) => {
    if (block.type === "paragraph") return <p key={index}>{inline(block.text)}</p>;
    const List = block.type === "ordered" ? "ol" : "ul";
    return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</List>;
  });
}
