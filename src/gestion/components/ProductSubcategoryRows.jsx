import { useEffect, useRef } from "react";
import { groupProductSubcategories } from "../../shared/productSubcategories.mjs";
import "../../styles/product-subcategories.css";

function ProductStrip({ label, className, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const strip = ref.current;
    const wheel = event => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const available = strip.scrollWidth - strip.clientWidth;
      if (available <= 1 || (event.deltaY < 0 && strip.scrollLeft <= 0) || (event.deltaY > 0 && strip.scrollLeft >= available - 1)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("wheel", wheel, { passive: false });
    return () => strip.removeEventListener("wheel", wheel);
  }, []);
  return <div ref={ref} className={`${className} fm-subcategory-strip`} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export default function ProductSubcategoryRows({ items, category, className, renderProduct }) {
  return <div className="fm-subcategory-rows">{groupProductSubcategories(items, category).map(group => (
    <section className="fm-subcategory-row" key={group.id} aria-label={group.name || category.name}>
      {group.name ? <h3>{group.name}</h3> : null}
      {group.items.length ? <ProductStrip className={className} label={`Productos de ${group.name || category.name}`}>{group.items.map(renderProduct)}</ProductStrip> : <p className="fm-subcategory-empty">Sin productos en esta ubicación.</p>}
    </section>
  ))}</div>;
}
