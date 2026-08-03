export default function SectionHeading({
  eyebrow,
  title,
  body,
  align = "left",
  as = "h2",
}) {
  const Heading = as;
  return (
    <header className={`section-heading section-heading--${align}`}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <Heading>{title}</Heading>
      {body ? <p className="section-heading__body">{body}</p> : null}
    </header>
  );
}
