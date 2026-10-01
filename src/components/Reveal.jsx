import { useReveal } from "../hooks/useReveal";

// Envoltorio que revela su contenido al entrar en viewport.
// `stagger` aplica la animación en cascada a los hijos directos.
export default function Reveal({
  as: Tag = "div",
  className = "",
  stagger = false,
  children,
  ...props
}) {
  const ref = useReveal();
  const classes = ["reveal", stagger ? "reveal-stagger" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag ref={ref} className={classes} {...props}>
      {children}
    </Tag>
  );
}
