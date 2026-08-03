import { Check } from "lucide-react";
import { useState } from "react";
import { oliveProfiles, sensoryDimensions } from "../data/oliveProfiles";

export default function SensoryComparison() {
  const [selectedIds, setSelectedIds] = useState(["arbequina", "blend"]);

  const toggleProfile = (profileId) => {
    setSelectedIds((current) => {
      if (current.includes(profileId)) {
        return current.filter((id) => id !== profileId);
      }
      if (current.length >= 3) return current;
      return [...current, profileId];
    });
  };

  const selectedProfiles = oliveProfiles.filter((profile) =>
    selectedIds.includes(profile.id),
  );

  return (
    <div className="sensory-comparison">
      <div
        className="comparison-selector"
        aria-label="Elegir hasta tres varietales"
      >
        {oliveProfiles.map((profile) => {
          const selected = selectedIds.includes(profile.id);
          const disabled = !selected && selectedIds.length >= 3;
          return (
            <button
              type="button"
              key={profile.id}
              onClick={() => toggleProfile(profile.id)}
              className={selected ? "is-selected" : ""}
              aria-pressed={selected}
              disabled={disabled}
            >
              {selected ? <Check size={15} aria-hidden="true" /> : null}
              {profile.name}
            </button>
          );
        })}
      </div>

      <p className="comparison-note">
        Los perfiles sensoriales todavía no fueron validados. La herramienta
        está lista para recibir los datos reales de Flor Mía.
      </p>

      <div className="comparison-table" role="table" aria-label="Comparador sensorial">
        <div className="comparison-table__row comparison-table__head" role="row">
          <span role="columnheader">Dimensión</span>
          {selectedProfiles.map((profile) => (
            <strong role="columnheader" key={profile.id}>
              {profile.name}
            </strong>
          ))}
        </div>
        {sensoryDimensions.map((dimension) => (
          <div className="comparison-table__row" role="row" key={dimension}>
            <span role="rowheader">{dimension}</span>
            {selectedProfiles.map((profile) => (
              <div role="cell" key={`${profile.id}-${dimension}`}>
                <span className="pending-value">Pendiente de validación</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
