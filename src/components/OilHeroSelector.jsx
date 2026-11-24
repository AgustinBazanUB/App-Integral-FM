import { useState } from "react";
import Reveal from "./Reveal";

export default function OilHeroSelector({ onSelectMode }) {
  return (
    <Reveal as="section" className="oil-hero-selector" aria-labelledby="oil-hero-title">
      <div className="fm-page oil-hero-selector__inner">
        <h1 id="oil-hero-title">ACEITE DE OLIVA FLOR MÍA</h1>
        <p className="oil-hero-selector__subtitle">
          Extra virgen de Mendoza, seleccionado para tu mesa
        </p>
        <div className="oil-hero-selector__actions">
          <button
            className="fm-button fm-button--gold fm-button--large"
            type="button"
            onClick={() => onSelectMode("quiz")}
          >
            AYUDAME A ELEGIR
          </button>
          <button
            className="fm-button fm-button--black fm-button--large"
            type="button"
            onClick={() => onSelectMode("browse")}
          >
            YA SÉ LO QUE ME GUSTA
          </button>
        </div>
      </div>
    </Reveal>
  );
}
