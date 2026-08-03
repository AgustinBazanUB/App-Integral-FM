import { useRef } from "react";
import { X } from "lucide-react";
import SearchExperience from "./SearchExperience";
import { useFocusTrap } from "../hooks/useFocusTrap";

export default function SearchModal({ open, onClose, returnFocusRef }) {
  const dialogRef = useRef(null);

  useFocusTrap({
    active: open,
    containerRef: dialogRef,
    returnFocusRef,
    onEscape: onClose,
  });

  if (!open) return null;

  return (
    <div
      className="modal-layer search-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar en Flor Mía"
      ref={dialogRef}
      tabIndex={-1}
    >
      <button
        type="button"
        className="modal-backdrop"
        onClick={onClose}
        aria-label="Cerrar buscador"
      />
      <div className="search-modal__panel">
        <div className="search-modal__header">
          <div>
            <p className="eyebrow">BÚSQUEDA GLOBAL</p>
            <h2>Encontrá tu sabor.</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar buscador"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <SearchExperience
          autofocus
          showQuickFilters={false}
          onNavigate={onClose}
        />
      </div>
    </div>
  );
}
