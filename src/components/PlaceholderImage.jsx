import { Image as ImageIcon } from "lucide-react";

export default function PlaceholderImage({
  src,
  alt,
  label,
  aspectRatio = "4 / 5",
  className = "",
  eager = false,
  sizes,
  showCaption = false,
  width,
  height,
}) {
  return (
    <figure
      className={`placeholder-image ${className}`.trim()}
      style={{ "--image-ratio": aspectRatio }}
    >
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        fetchpriority={eager ? "high" : "auto"}
        decoding="async"
        sizes={sizes}
        width={width}
        height={height}
      />
      {showCaption ? (
        <figcaption>
          <ImageIcon size={18} aria-hidden="true" />
          <span>{label}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
