import { useState } from "react";
import Reveal from "./Reveal";

const useCases = [
  { id: "ensaladas", label: "ensaladas", image: "/images/flor-mia/products/usos/ensaladas.jpg" },
  { id: "carnes", label: "carnes", image: "/images/flor-mia/products/usos/carnes.jpg" },
  { id: "pastas", label: "pastas", image: "/images/flor-mia/products/usos/pastas.jpeg" },
  { id: "pescados", label: "pescados", image: "/images/flor-mia/products/usos/pescados.jpeg" },
  { id: "untar en pan", label: "untar en pan", image: "/images/flor-mia/products/usos/panAceiteDeOliva.jpeg" },
  { id: "sopas y cremas", label: "sopas y cremas", image: "/images/flor-mia/products/usos/sopaDeCalabaza.jpg" },
  { id: "verduras al horno", label: "verduras al horno", image: "/images/flor-mia/products/usos/verdurasAlHorno.jpeg" },
  { id: "pizza", label: "pizza", image: "/images/flor-mia/products/usos/pizzaNapolitana.jpeg" },
  { id: "marinar", label: "marinar", image: "/images/flor-mia/products/usos/marinado.jpg" },
  { id: "reposteria", label: "repostería", image: "/images/flor-mia/products/usos/reposteria.jpg" },
  { id: "tomar solo", label: "tomar solo", image: "/images/flor-mia/products/usos/AceiteDeOlivaSolo.jpeg" },
  { id: "uso diario", label: "uso diario", image: "/images/flor-mia/products/usos/usoDiario.jpg" },
];

const aromaProfiles = [
  { id: "suave", label: "Suave y frutado", description: "Notas suaves de manzana, banana y almendra" },
  { id: "medio", label: "Medio / Intermedio", description: "Equilibrio entre frutado y picante" },
  { id: "intenso", label: "Intenso", description: "Picante, hoja verde y alcaucil" },
];

export default function OilQuiz({ onComplete }) {
  const [step, setStep] = useState(1);
  const [selectedUses, setSelectedUses] = useState([]);
  const [selectedAroma, setSelectedAroma] = useState(null);

  const toggleUse = (use) => {
    setSelectedUses((prev) =>
      prev.includes(use.id) ? prev.filter((u) => u !== use.id) : [...prev, use.id]
    );
  };

  const handleNext = () => {
    if (step === 1 && selectedUses.length > 0) {
      setStep(2);
    } else if (step === 2 && selectedAroma) {
      setStep(3);
    }
  };

  const getRecommendations = () => {
    // Lógica simple de recomendación basada en selección
    if (selectedAroma === "suave") {
      return [
        { name: "Arbequina", description: "Frutado dulce, ideal para ensaladas y untar en pan" },
        { name: "Arbosana", description: "Cocina diaria con notas de almendra cremosa" },
      ];
    } else if (selectedAroma === "intenso") {
      return [
        { name: "Coratina", description: "Alto en polifenoles, perfecto para carnes y finales" },
        { name: "Picual", description: "Estable al calor, ideal para cocinar" },
      ];
    } else {
      return [
        { name: "Blend IG", description: "Equilibrio perfecto de Arbequina, Arauco y Coratina" },
        { name: "Arauco", description: "La criolla mendocina, carácter único" },
      ];
    }
  };

  return (
    <Reveal as="section" className="oil-quiz" aria-labelledby="quiz-title">
      <div className="fm-page oil-quiz__inner">
        <div className="oil-quiz__header">
          <span className="oil-quiz__step">Pregunta {step} de 2</span>
          <h2 id="quiz-title">
            {step === 1 ? "¿Para qué lo vas a usar?" : "¿Qué sabor preferís?"}
          </h2>
        </div>

        {step === 1 && (
          <div className="oil-quiz__step">
            <div className="oil-quiz__grid">
              {useCases.map((use) => (
                <button
                  key={use.id}
                  type="button"
                  className={`oil-quiz__option ${selectedUses.includes(use.id) ? "is-selected" : ""}`}
                  onClick={() => toggleUse(use)}
                >
                  <img src={use.image} alt={use.label} />
                  <span>{use.label}</span>
                </button>
              ))}
            </div>
            <button
              className="fm-button fm-button--gold oil-quiz__next"
              type="button"
              onClick={handleNext}
              disabled={selectedUses.length === 0}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="oil-quiz__step">
            <div className="oil-quiz__aromas">
              {aromaProfiles.map((aroma) => (
                <button
                  key={aroma.id}
                  type="button"
                  className={`oil-quiz__aroma ${selectedAroma === aroma.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedAroma(aroma.id)}
                >
                  <h3>{aroma.label}</h3>
                  <p>{aroma.description}</p>
                </button>
              ))}
            </div>
            <button
              className="fm-button fm-button--gold oil-quiz__next"
              type="button"
              onClick={handleNext}
              disabled={!selectedAroma}
            >
              VER RECOMENDACIONES
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="oil-quiz__step">
            <div className="oil-quiz__results">
              <h3>Te recomendamos:</h3>
              {getRecommendations().map((rec, index) => (
                <div key={index} className="oil-quiz__recommendation">
                  <h4>{rec.name}</h4>
                  <p>{rec.description}</p>
                </div>
              ))}
            </div>
            <button
              className="fm-button fm-button--black oil-quiz__reset"
              type="button"
              onClick={() => onComplete()}
            >
              VER TIENDA
            </button>
          </div>
        )}
      </div>
    </Reveal>
  );
}
