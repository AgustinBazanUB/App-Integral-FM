import { useEffect } from "react";

const defaultDescription =
  "Descubrí aceites de oliva, frutos secos, aceitunas, mermeladas, sales y productos regionales seleccionados de Mendoza en Flor Mía.";

export default function PageMeta({ title, description = defaultDescription }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const canonicalUrl = `${window.location.origin}${window.location.pathname}`;
    const socialImage = `${window.location.origin}/images/flor-mia/og-flor-mia.webp`;
    const targets = [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[property="og:url"]', canonicalUrl],
      ['meta[property="og:image"]', socialImage],
      ['link[rel="canonical"]', canonicalUrl, "href"],
    ];
    const previousValues = targets.map(([selector, value, attribute = "content"]) => {
      const element = document.querySelector(selector);
      const previous = element?.getAttribute(attribute);
      element?.setAttribute(attribute, value);
      return [element, attribute, previous];
    });

    return () => {
      document.title = previousTitle;
      previousValues.forEach(([element, attribute, previous]) => {
        if (previous) element?.setAttribute(attribute, previous);
      });
    };
  }, [title, description]);

  return null;
}
