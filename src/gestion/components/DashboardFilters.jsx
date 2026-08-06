import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, Modal, Select } from "../../design-system";
import { locationActivity } from "../../modules/locations/domain/locations";
import {
  ARGENTINA_TIME_ZONE,
  addArgentinaDays,
  argentinaDateKey,
  argentinaMonthKey,
  argentinaMonthLabel,
  argentinaMonthRange,
  argentinaParts,
  argentinaPeriodLabel,
  argentinaPeriodRange,
  canAdvanceArgentinaPeriod,
  isArgentinaPeriodFuture,
  shiftArgentinaPeriodReference,
} from "../../modules/locations/domain/time";
import { Icon } from "./icons";

const FORMAT_OPTIONS = [
  { value: "year", label: "Año" },
  { value: "month", label: "Mes" },
  { value: "week", label: "Semana" },
  { value: "day", label: "Día" },
];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const uniqueIds = (values = []) => [...new Set(values.filter(Boolean))];
const compareDates = (left, right) => left.getTime() - right.getTime();

function calendarDays(monthKey) {
  const { start, end } = argentinaMonthRange(monthKey);
  const weekday = (start.getUTCDay() + 6) % 7;
  const gridStart = addArgentinaDays(start, -weekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addArgentinaDays(gridStart, index);
    return {
      date,
      key: argentinaDateKey(date),
      day: argentinaParts(date).day,
      inMonth: date >= start && date < end,
    };
  });
}

function CalendarNavigation({ label, onPrevious, onNext, nextDisabled }) {
  return (
    <div className="fm-dashboard-calendar__navigation">
      <IconButton label="Período anterior del calendario" icon="ChevronLeft" onClick={onPrevious} />
      <strong>{label}</strong>
      <IconButton
        label={nextDisabled ? "No hay períodos futuros disponibles" : "Período siguiente del calendario"}
        icon="ChevronRight"
        disabled={nextDisabled}
        onClick={onNext}
      />
    </div>
  );
}

function YearPicker({ referenceKey, onSelect }) {
  const selectedYear = argentinaParts(referenceKey).year;
  const currentYear = argentinaParts().year;
  const [groupStart, setGroupStart] = useState(() => Math.floor(selectedYear / 12) * 12);
  const years = Array.from({ length: 12 }, (_, index) => groupStart + index);
  return (
    <div className="fm-dashboard-calendar">
      <CalendarNavigation
        label={`${groupStart} — ${groupStart + 11}`}
        onPrevious={() => setGroupStart((value) => value - 12)}
        onNext={() => setGroupStart((value) => value + 12)}
        nextDisabled={groupStart + 12 > currentYear}
      />
      <div className="fm-dashboard-year-grid" role="grid" aria-label="Elegir año">
        {years.map((year) => (
          <button
            key={year}
            type="button"
            role="gridcell"
            disabled={year > currentYear}
            aria-current={year === currentYear ? "date" : undefined}
            aria-pressed={year === selectedYear}
            className={year === selectedYear ? "is-selected" : ""}
            onClick={() => onSelect(`${year}-01-01`)}
          >
            {year}
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthPicker({ referenceKey, onSelect }) {
  const selected = argentinaParts(referenceKey);
  const current = argentinaParts();
  const [year, setYear] = useState(selected.year);
  return (
    <div className="fm-dashboard-calendar">
      <CalendarNavigation
        label={String(year)}
        onPrevious={() => setYear((value) => value - 1)}
        onNext={() => setYear((value) => value + 1)}
        nextDisabled={year >= current.year}
      />
      <div className="fm-dashboard-month-grid" role="grid" aria-label="Elegir mes">
        {MONTHS.map((month, index) => {
          const monthNumber = index + 1;
          const disabled = year > current.year || (year === current.year && monthNumber > current.month);
          const selectedMonth = year === selected.year && monthNumber === selected.month;
          return (
            <button
              key={month}
              type="button"
              role="gridcell"
              disabled={disabled}
              aria-pressed={selectedMonth}
              className={selectedMonth ? "is-selected" : ""}
              onClick={() => onSelect(`${year}-${String(monthNumber).padStart(2, "0")}-01`)}
            >
              {month}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayWeekPicker({ format, referenceKey, onSelect }) {
  const todayKey = argentinaDateKey();
  const currentMonth = argentinaMonthKey();
  const [monthKey, setMonthKey] = useState(() => referenceKey.slice(0, 7));
  const selectedRange = argentinaPeriodRange(format, referenceKey);
  const days = useMemo(() => calendarDays(monthKey), [monthKey]);
  const { year, month } = argentinaMonthRange(monthKey);
  const nextMonth = argentinaMonthKey(new Date(Date.UTC(year, month, 15, 12)));
  const moveMonth = (amount) => {
    setMonthKey(argentinaMonthKey(new Date(Date.UTC(year, month - 1 + amount, 15, 12))));
  };
  return (
    <div className="fm-dashboard-calendar">
      <CalendarNavigation
        label={argentinaMonthLabel(monthKey)}
        onPrevious={() => moveMonth(-1)}
        onNext={() => moveMonth(1)}
        nextDisabled={nextMonth > currentMonth}
      />
      <div className="fm-dashboard-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="fm-dashboard-day-grid" role="grid" aria-label={format === "week" ? "Elegir semana" : "Elegir día"}>
        {days.map((item) => {
          const candidateFuture = format === "day" ? item.key > todayKey : isArgentinaPeriodFuture("week", item.key);
          const selected = compareDates(item.date, selectedRange.start) >= 0 && compareDates(item.date, selectedRange.end) < 0;
          const label = new Intl.DateTimeFormat("es-AR", {
            timeZone: ARGENTINA_TIME_ZONE,
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(item.date);
          return (
            <button
              key={item.key}
              type="button"
              role="gridcell"
              data-date={item.key}
              disabled={candidateFuture}
              aria-label={format === "week" ? `Seleccionar la semana de ${label}` : `Seleccionar ${label}`}
              aria-current={item.key === todayKey ? "date" : undefined}
              aria-pressed={selected}
              className={`${item.inMonth ? "" : "is-outside"} ${selected ? "is-selected" : ""} ${item.key === todayKey ? "is-today" : ""}`.trim()}
              onClick={() => onSelect(item.key)}
            >
              {item.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodPicker({ format, referenceKey, onSelect }) {
  if (format === "year") return <YearPicker referenceKey={referenceKey} onSelect={onSelect} />;
  if (format === "month") return <MonthPicker referenceKey={referenceKey} onSelect={onSelect} />;
  return <DayWeekPicker format={format} referenceKey={referenceKey} onSelect={onSelect} />;
}

function locationSelectionLabel(locations, selectedIds) {
  if (!locations.length) return "Sin ubicaciones";
  const selected = new Set(selectedIds);
  if (selected.size === locations.length) return "Todas las ubicaciones";
  const activeIds = locations.filter((location) => locationActivity(location).active).map((location) => location.id);
  const inactiveIds = locations.filter((location) => !locationActivity(location).active).map((location) => location.id);
  const exactly = (ids) => ids.length === selected.size && ids.every((id) => selected.has(id));
  if (activeIds.length && exactly(activeIds)) return "Solo activas";
  if (inactiveIds.length && exactly(inactiveIds)) return "Solo inactivas";
  if (selected.size === 1) return "1 ubicación";
  return selected.size ? `${selected.size} ubicaciones` : "Sin ubicaciones";
}

function LocationGroup({ title, locations, selectedIds, onToggle }) {
  const id = `location-group-${title.toLowerCase()}`;
  return (
    <section className="fm-dashboard-location-group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {locations.length ? locations.map((location) => {
        const state = locationActivity(location);
        return (
          <label key={location.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(location.id)}
              onChange={() => onToggle(location.id)}
            />
            <span>
              <strong>{location.name}</strong>
              <small>{state.label}</small>
            </span>
          </label>
        );
      }) : <p>No hay ubicaciones en esta categoría.</p>}
    </section>
  );
}

export default function DashboardFilters({
  format,
  referenceKey,
  locations,
  selectedLocationIds,
  onFormatChange,
  onReferenceChange,
  onLocationsChange,
  busy,
}) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const allIds = useMemo(() => locations.map((location) => location.id), [locations]);
  const effectiveSelectedIds = selectedLocationIds == null ? allIds : selectedLocationIds.filter((id) => allIds.includes(id));
  const [draftLocationIds, setDraftLocationIds] = useState(effectiveSelectedIds);
  const activeLocations = locations.filter((location) => locationActivity(location).active);
  const inactiveLocations = locations.filter((location) => !locationActivity(location).active);
  const canAdvance = canAdvanceArgentinaPeriod(format, referenceKey);

  useEffect(() => {
    if (locationsOpen) setDraftLocationIds(effectiveSelectedIds);
  }, [locationsOpen, locations, selectedLocationIds]);

  const choosePeriod = (nextReference) => {
    onReferenceChange(nextReference);
    setPeriodOpen(false);
  };
  const toggleDraftLocation = (locationId) => {
    setDraftLocationIds((current) => current.includes(locationId)
      ? current.filter((id) => id !== locationId)
      : [...current, locationId]);
  };
  const applyLocations = () => {
    const clean = uniqueIds(draftLocationIds).filter((id) => allIds.includes(id));
    onLocationsChange(clean.length === allIds.length ? null : clean);
    setLocationsOpen(false);
  };

  return (
    <>
      <div className="fm-dashboard-filter-bar" aria-busy={busy || undefined}>
        <div className="fm-dashboard-period-control">
          <IconButton
            label={`Retroceder un período (${FORMAT_OPTIONS.find((item) => item.value === format)?.label})`}
            icon="ChevronLeft"
            onClick={() => onReferenceChange(shiftArgentinaPeriodReference(format, referenceKey, -1))}
          />
          <button
            type="button"
            className="fm-dashboard-period-trigger"
            aria-haspopup="dialog"
            aria-expanded={periodOpen}
            onClick={() => setPeriodOpen(true)}
          >
            <Icon name="CalendarDays" />
            <span>{argentinaPeriodLabel(format, referenceKey)}</span>
            <Icon name="ChevronDown" />
          </button>
          <IconButton
            label={canAdvance ? `Avanzar un período (${FORMAT_OPTIONS.find((item) => item.value === format)?.label})` : "No se puede avanzar a un período futuro"}
            icon="ChevronRight"
            disabled={!canAdvance}
            onClick={() => onReferenceChange(shiftArgentinaPeriodReference(format, referenceKey, 1))}
          />
        </div>

        <label className="fm-dashboard-select-control">
          <Icon name="CalendarRange" />
          <span>Formato</span>
          <Select aria-label="Formato temporal" value={format} onChange={(event) => onFormatChange(event.target.value)}>
            {FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </label>

        <Button
          variant="secondary"
          icon="MapPinned"
          className="fm-dashboard-locations-trigger"
          aria-haspopup="dialog"
          aria-expanded={locationsOpen}
          onClick={() => setLocationsOpen(true)}
        >
          <span className="fm-dashboard-locations-trigger__label">Ubicaciones</span>
          <strong>{locationSelectionLabel(locations, effectiveSelectedIds)}</strong>
        </Button>
      </div>

      <Modal
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title={`Seleccionar ${FORMAT_OPTIONS.find((item) => item.value === format)?.label.toLowerCase()}`}
        description="Los períodos usan la zona horaria de Buenos Aires y no permiten avanzar a rangos completamente futuros."
        footer={(
          <div className="fm-dialog-actions">
            <Button variant="ghost" icon="RotateCcw" onClick={() => choosePeriod(argentinaDateKey())}>Período actual</Button>
            <Button variant="secondary" onClick={() => setPeriodOpen(false)}>Cerrar</Button>
          </div>
        )}
      >
        <PeriodPicker format={format} referenceKey={referenceKey} onSelect={choosePeriod} />
      </Modal>

      <Modal
        open={locationsOpen}
        onClose={() => setLocationsOpen(false)}
        title="Filtrar ubicaciones"
        description="Solo aparecen ubicaciones permitidas para tu usuario. Las eliminadas no se incluyen."
        footer={(
          <div className="fm-dashboard-location-actions">
            <div>
              <Button variant="ghost" onClick={() => setDraftLocationIds(allIds)}>Seleccionar todas</Button>
              <Button variant="ghost" onClick={() => setDraftLocationIds([])}>Limpiar selección</Button>
            </div>
            <div>
              <Button variant="secondary" onClick={() => setLocationsOpen(false)}>Cancelar</Button>
              <Button icon="Check" onClick={applyLocations}>Aplicar</Button>
            </div>
          </div>
        )}
      >
        <div className="fm-dashboard-location-selector">
          <LocationGroup title="Activas" locations={activeLocations} selectedIds={draftLocationIds} onToggle={toggleDraftLocation} />
          <LocationGroup title="Inactivas" locations={inactiveLocations} selectedIds={draftLocationIds} onToggle={toggleDraftLocation} />
        </div>
      </Modal>
    </>
  );
}
