import { useState } from "react";
import { productImageSources, PRODUCT_IMAGE_PLACEHOLDER } from "../../shared/productImages.mjs";
import "../../styles/product-image.css";

function ImageAttempt({ sources, className = "", alt = "", eager = false }) {
  const [index, setIndex] = useState(0);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  const source = sources[index] || PRODUCT_IMAGE_PLACEHOLDER;
  const placeholder = source === PRODUCT_IMAGE_PLACEHOLDER;
  return <span className={`fm-product-image ${className}`} title={placeholder ? "Falta cargar imagen de este producto" : undefined}>
    {!placeholderFailed ? <img src={source} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => { if (index < sources.length - 1) setIndex(index + 1); else setPlaceholderFailed(true); }} /> : <span className="fm-product-image__brand">Flor Mía</span>}
  </span>;
}
export default function ProductImage(props) {
  const sources = productImageSources(props.product);
  return <ImageAttempt key={JSON.stringify(sources)} {...props} sources={sources} />;
}
