import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
} from "react";
import { Icon } from "../gestion/components/icons";

export const Button = forwardRef(function Button(
  {
    children,
    variant = "primary",
    icon,
    iconPosition = "start",
    loading = false,
    className = "",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`fm-button fm-button--${variant} ${className}`.trim()}
      aria-busy={loading || undefined}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Icon name="LoaderCircle" className="fm-spinner" /> : null}
      {!loading && icon && iconPosition === "start" ? <Icon name={icon} /> : null}
      <span>{children}</span>
      {!loading && icon && iconPosition === "end" ? <Icon name={icon} /> : null}
    </button>
  );
});

export const LoadingButton = Button;

export const IconButton = forwardRef(function IconButton(
  { label, icon, variant = "secondary", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`fm-icon-button fm-icon-button--${variant} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
});

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="fm-page-header">
      <div>
        {eyebrow ? <p className="fm-overline">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="fm-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function HeroBanner({ eyebrow, title, description, action, children }) {
  return (
    <section className="fm-hero-banner">
      <div className="fm-hero-banner__content">
        {eyebrow ? <p className="fm-overline fm-overline--inverse">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {action ? <div className="fm-hero-banner__action">{action}</div> : null}
      </div>
      {children ? <div className="fm-hero-banner__aside">{children}</div> : null}
      <svg className="fm-hero-banner__botanical" viewBox="0 0 300 160" aria-hidden="true">
        <path d="M290 155C245 121 250 64 178 38M238 112c-26-3-43-17-51-38m60 22c4-22 16-38 38-49M178 38c-26 21-41 46-46 76m46-76c-4-17 1-29 16-38M132 114c-19-17-39-24-62-19m62 19c-10 13-15 28-14 44" />
      </svg>
    </section>
  );
}

export function StatCard({ label, value, hint, icon, tone = "gold" }) {
  return (
    <article className={`fm-stat-card fm-stat-card--${tone}`}>
      <div className="fm-stat-card__icon"><Icon name={icon} /></div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {hint ? <span>{hint}</span> : null}
      </div>
    </article>
  );
}

export function Panel({ title, description, action, className = "", children }) {
  return (
    <section className={`fm-panel ${className}`.trim()}>
      {title || action ? (
        <header className="fm-panel__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </header>
      ) : null}
      <div className="fm-panel__body">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral", icon }) {
  return (
    <span className={`fm-badge fm-badge--${tone}`}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

export function EmptyState({ icon = "Box", title, description, action }) {
  return (
    <div className="fm-empty-state">
      <div className="fm-empty-state__icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="fm-skeleton" aria-label="Cargando" aria-busy="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} style={{ width: `${100 - index * 11}%` }} />
      ))}
    </div>
  );
}

export const SearchInput = forwardRef(function SearchInput(
  { label = "Buscar", ...props },
  ref,
) {
  return (
    <label className="fm-search-input">
      <span className="sr-only">{label}</span>
      <Icon name="Search" />
      <input ref={ref} type="search" placeholder={label} {...props} />
    </label>
  );
});

export function FilterBar({ children, search, actions }) {
  return (
    <div className="fm-filter-bar">
      {search ? <div className="fm-filter-bar__search">{search}</div> : null}
      <div className="fm-filter-bar__controls">{children}</div>
      {actions ? <div className="fm-filter-bar__actions">{actions}</div> : null}
    </div>
  );
}

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className = "",
}) {
  const generatedId = useId();
  const control = Children.only(children);
  const controlId = control.props.id || `field-${generatedId}`;
  const describedBy = error
    ? `${controlId}-error`
    : hint
      ? `${controlId}-hint`
      : undefined;
  return (
    <div className={`fm-field ${error ? "fm-field--error" : ""} ${className}`.trim()}>
      <label htmlFor={controlId}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {isValidElement(control)
        ? cloneElement(control, {
            id: controlId,
            "aria-describedby": describedBy,
            "aria-invalid": Boolean(error) || undefined,
            required: required || control.props.required,
          })
        : control}
      {error ? <p id={`${controlId}-error`} className="fm-field__error">{error}</p> : null}
      {!error && hint ? <p id={`${controlId}-hint`} className="fm-field__hint">{hint}</p> : null}
    </div>
  );
}

export const Select = forwardRef(function Select(props, ref) {
  return <select ref={ref} {...props} />;
});

export function Multiselect({ options = [], value = [], onChange, ...props }) {
  return (
    <select
      multiple
      value={value}
      onChange={(event) =>
        onChange?.([...event.target.selectedOptions].map((item) => item.value))
      }
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export const DatePicker = forwardRef(function DatePicker(props, ref) {
  return <input ref={ref} type="date" {...props} />;
});

function useOverlay(open, onClose, initialFocusRef) {
  const containerRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ||
        containerRef.current?.querySelector(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ))?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(containerRef.current?.querySelectorAll(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ) || []),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("fm-overlay-open");
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("fm-overlay-open");
      window.requestAnimationFrame(() => returnFocusRef.current?.focus?.());
    };
  }, [initialFocusRef, open]);
  return containerRef;
}

export function Modal({ open, onClose, title, description, children, footer }) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className="fm-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section ref={ref} className="fm-modal" role="dialog" aria-modal="true" aria-labelledby="fm-modal-title">
        <header>
          <div>
            <h2 id="fm-modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton label="Cerrar" icon="X" onClick={onClose} />
        </header>
        <div className="fm-modal__body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className="fm-overlay fm-overlay--drawer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <aside ref={ref} className="fm-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><IconButton label="Cerrar" icon="X" onClick={onClose} /></header>
        <div>{children}</div>
      </aside>
    </div>
  );
}

export function ConfirmationDialog({ open, title = "Confirmar", description, onConfirm, onClose, busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="fm-dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <LoadingButton variant="destructive" loading={busy} onClick={onConfirm}>Confirmar</LoadingButton>
        </div>
      }
    />
  );
}

export function DataTable({ columns, rows, rowKey = "id", empty }) {
  if (!rows?.length) return empty || null;
  return (
    <div className="fm-data-table-wrap">
      <table className="fm-data-table">
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row[rowKey] || index}>
              {columns.map((column) => <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : row[column.key] ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MobileDataCard({ title, badge, rows, actions }) {
  return (
    <article className="fm-mobile-data-card">
      <header><h3>{title}</h3>{badge}</header>
      <dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value ?? "—"}</dd></div>)}</dl>
      {actions ? <footer>{actions}</footer> : null}
    </article>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="fm-tabs" role="tablist" aria-label="Secciones">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} onClick={() => onChange(tab.id)}>{tab.label}</button>)}
    </div>
  );
}

export function Accordion({ title, open, onToggle, children }) {
  const id = useId();
  return (
    <section className="fm-accordion">
      <h3><button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>{title}<Icon name="ChevronDown" /></button></h3>
      {open ? <div id={id}>{children}</div> : null}
    </section>
  );
}

export function ProgressBar({ value = 0, label }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="fm-progress"><div className="fm-progress__meta"><span>{label}</span><span>{safe}%</span></div><div className="fm-progress__track" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={safe}><span style={{ width: `${safe}%` }} /></div></div>;
}

export function Pagination({ page, totalPages, onChange }) {
  return <nav className="fm-pagination" aria-label="Paginación"><IconButton label="Página anterior" icon="ChevronLeft" disabled={page <= 1} onClick={() => onChange(page - 1)} /><span>Página {page} de {totalPages}</span><IconButton label="Página siguiente" icon="ChevronRight" disabled={page >= totalPages} onClick={() => onChange(page + 1)} /></nav>;
}

export function ChartContainer({ title, summary, children }) {
  return <section className="fm-chart" aria-label={title}><header><h3>{title}</h3></header><div aria-hidden="true">{children}</div><p className="sr-only">{summary}</p></section>;
}

export function PermissionGuard({ allowed, fallback = null, children }) {
  return allowed ? children : fallback;
}

export function Tooltip({ label, children }) {
  return <span className="fm-tooltip" data-tooltip={label}>{children}</span>;
}

export function Toast({ tone = "info", children }) {
  return <div className={`fm-toast fm-toast--${tone}`} role="status"><Icon name={tone === "error" ? "AlertTriangle" : "Check"} />{children}</div>;
}

export function Dropdown({ label, children }) {
  return <details className="fm-dropdown"><summary>{label}<Icon name="ChevronDown" /></summary><div>{children}</div></details>;
}

export const AppShell = ({ children }) => children;
export const Sidebar = ({ children }) => <aside>{children}</aside>;
export const Header = ({ children }) => <header>{children}</header>;
export const ModuleNavigation = ({ children }) => <nav>{children}</nav>;
