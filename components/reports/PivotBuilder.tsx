'use client'

import { useState, useEffect, useTransition, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  GripVertical, X, Loader2, Table2, LayoutGrid, Download,
  ChevronUp, ChevronDown, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { getReportFields, getReportData } from '@/lib/actions/reporting'
import { exportReportXlsx, type ReportExportConfig } from '@/lib/actions/reportExport'
import { downloadXlsxBase64 } from '@/lib/export/xlsx'
import { computePivot, toFlatTable, type PivotConfig, type ValueFieldConfig, type FieldFilter, type AggFunc, type FilterOp } from '@/lib/reporting/pivot-engine'
import {
  REPORT_ENTITIES, aggregationsForType,
  type EntityKey, type ReportField,
} from '@/lib/reporting/field-registry'
import type { ReportRow } from '@/lib/queries/reporting'
import { PivotTableView } from './PivotTableView'
import { FlatTableView } from './FlatTableView'

type Well = 'rows' | 'cols' | 'values' | 'filters' | 'columns'
type Mode = 'table' | 'pivot'

const ENTITY_OPTIONS = Object.values(REPORT_ENTITIES).map((e) => ({ key: e.key, label: e.label }))

function moveInArray<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const next = [...arr]
  const target = index + dir
  if (target < 0 || target >= next.length) return arr
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function defaultFilterFor(field: ReportField): FieldFilter {
  switch (field.type) {
    case 'enum': return { field: field.key, op: 'eq', value: field.options?.[0]?.value ?? '' }
    case 'boolean': return { field: field.key, op: 'eq', value: 'true' }
    case 'number': return { field: field.key, op: 'gte', value: 0 }
    case 'date': return { field: field.key, op: 'gte', value: '' }
    default: return { field: field.key, op: 'contains', value: '' }
  }
}

export function PivotBuilder() {
  const [entity, setEntity] = useState<EntityKey>('requests')
  const [mode, setMode] = useState<Mode>('table')
  const [fields, setFields] = useState<ReportField[]>([])
  const [rows, setRows] = useState<ReportRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, startLoading] = useTransition()
  const [exporting, startExporting] = useTransition()
  const [activeDragField, setActiveDragField] = useState<ReportField | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [columns, setColumns] = useState<string[]>([])
  const [rowFields, setRowFields] = useState<string[]>([])
  const [colFields, setColFields] = useState<string[]>([])
  const [valueFields, setValueFields] = useState<ValueFieldConfig[]>([{ field: '__count__', agg: 'count' }])
  const [filters, setFilters] = useState<FieldFilter[]>([])

  // getReportFields already prepends the synthetic Record Count field server-side.
  const allFields = fields
  const fieldByKey = useMemo(() => new Map(allFields.map((f) => [f.key, f])), [allFields])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    startLoading(async () => {
      setLoadError(null)
      try {
        const [fRes, dRes] = await Promise.all([getReportFields(entity), getReportData(entity)])
        if (fRes.error || dRes.error) {
          const msg = fRes.error || dRes.error || 'Failed to load report data.'
          setLoadError(msg)
          toast.error(msg)
          return
        }
        const loadedFields = fRes.data ?? []
        setFields(loadedFields)
        setRows(dRes.data?.rows ?? [])
        setTruncated(dRes.data?.truncated ?? false)
        setColumns(loadedFields.filter((f) => f.key !== '__count__').slice(0, 6).map((f) => f.key))
        setRowFields([])
        setColFields([])
        setValueFields([{ field: '__count__', agg: 'count' }])
        setFilters([])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load report data.'
        setLoadError(msg)
        toast.error(msg)
      }
    })
  }, [entity])

  function addToWell(well: Well, key: string) {
    const field = fieldByKey.get(key)
    if (!field) return
    if (well === 'columns') setColumns((prev) => (prev.includes(key) ? prev : [...prev, key]))
    else if (well === 'rows') setRowFields((prev) => (prev.includes(key) ? prev : [...prev, key]))
    else if (well === 'cols') setColFields((prev) => (prev.includes(key) ? prev : [...prev, key]))
    else if (well === 'values')
      setValueFields((prev) =>
        prev.some((v) => v.field === key) ? prev : [...prev, { field: key, agg: aggregationsForType(field.type)[0].value as AggFunc }]
      )
    else if (well === 'filters') setFilters((prev) => [...prev, defaultFilterFor(field)])
  }

  function handleDragStart(e: DragStartEvent) {
    const key = String(e.active.id).replace('field:', '')
    setActiveDragField(fieldByKey.get(key) ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragField(null)
    if (!e.over) return
    const key = String(e.active.id).replace('field:', '')
    const well = String(e.over.id).replace('well:', '') as Well
    addToWell(well, key)
  }

  function resetLayout() {
    setColumns(fields.slice(0, 6).map((f) => f.key))
    setRowFields([])
    setColFields([])
    setValueFields([{ field: '__count__', agg: 'count' }])
    setFilters([])
  }

  const pivotConfig: PivotConfig = useMemo(
    () => ({ rowFields, colFields, valueFields: valueFields.length ? valueFields : [{ field: '__count__', agg: 'count' }], filters }),
    [rowFields, colFields, valueFields, filters]
  )

  const pivotResult = useMemo(() => (mode === 'pivot' ? computePivot(rows, pivotConfig, allFields) : null), [mode, rows, pivotConfig, allFields])

  const flatColumns = useMemo(() => columns.map((k) => fieldByKey.get(k)).filter((f): f is ReportField => !!f), [columns, fieldByKey])
  const flatRows = useMemo(() => (mode === 'table' ? toFlatTable(rows, filters, columns) : []), [mode, rows, filters, columns])

  function handleExport() {
    startExporting(async () => {
      const config: ReportExportConfig = { mode, columns, pivot: pivotConfig }
      const res = await exportReportXlsx(entity, config)
      if (res.error || !res.data || !res.filename) {
        toast.error(res.error || 'Export failed.')
        return
      }
      downloadXlsxBase64(res.filename, res.data)
      toast.success('Report exported.')
    })
  }

  return (
    <div className="space-y-4">
      {/* Entity + mode + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value as EntityKey)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ENTITY_OPTIONS.map((e) => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>

          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setMode('table')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${mode === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
            <button
              type="button"
              onClick={() => setMode('pivot')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${mode === 'pivot' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Pivot
            </button>
          </div>

          <button type="button" onClick={resetLayout} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || loading}
          className="btn-glossy-light btn-glossy-light-hover disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {exporting ? 'Exporting…' : 'Export .xlsx'}
        </button>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {loadError}
        </div>
      )}

      {truncated && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Showing the first 20,000 records — narrow with filters for a complete view.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-card py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
            {/* Available fields */}
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Fields</div>
              <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                {allFields.map((f) => (
                  <FieldChip key={f.key} field={f} mode={mode} onAdd={addToWell} />
                ))}
              </div>
            </div>

            {/* Wells + filters + preview */}
            <div className="space-y-4">
              {mode === 'table' ? (
                <Well_ id="columns" label="Columns">
                  {columns.length === 0 && <EmptyHint text="Drag fields here or use the + menu" />}
                  {columns.map((key, i) => (
                    <Chip
                      key={key}
                      label={fieldByKey.get(key)?.label ?? key}
                      onRemove={() => setColumns((prev) => prev.filter((k) => k !== key))}
                      onMoveUp={i > 0 ? () => setColumns((prev) => moveInArray(prev, i, -1)) : undefined}
                      onMoveDown={i < columns.length - 1 ? () => setColumns((prev) => moveInArray(prev, i, 1)) : undefined}
                    />
                  ))}
                </Well_>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Well_ id="rows" label="Rows">
                    {rowFields.length === 0 && <EmptyHint text="Drop fields to group rows" />}
                    {rowFields.map((key, i) => (
                      <Chip
                        key={key}
                        label={fieldByKey.get(key)?.label ?? key}
                        onRemove={() => setRowFields((prev) => prev.filter((k) => k !== key))}
                        onMoveUp={i > 0 ? () => setRowFields((prev) => moveInArray(prev, i, -1)) : undefined}
                        onMoveDown={i < rowFields.length - 1 ? () => setRowFields((prev) => moveInArray(prev, i, 1)) : undefined}
                      />
                    ))}
                  </Well_>
                  <Well_ id="cols" label="Columns">
                    {colFields.length === 0 && <EmptyHint text="Drop fields to group columns" />}
                    {colFields.map((key, i) => (
                      <Chip
                        key={key}
                        label={fieldByKey.get(key)?.label ?? key}
                        onRemove={() => setColFields((prev) => prev.filter((k) => k !== key))}
                        onMoveUp={i > 0 ? () => setColFields((prev) => moveInArray(prev, i, -1)) : undefined}
                        onMoveDown={i < colFields.length - 1 ? () => setColFields((prev) => moveInArray(prev, i, 1)) : undefined}
                      />
                    ))}
                  </Well_>
                  <Well_ id="values" label="Values">
                    {valueFields.length === 0 && <EmptyHint text="Drop fields to aggregate" />}
                    {valueFields.map((vf, i) => {
                      const f = fieldByKey.get(vf.field)
                      return (
                        <div key={vf.field} className="flex items-center gap-1 rounded-md bg-primary/10 pl-2 pr-1 py-1 text-xs text-foreground">
                          <span className="truncate max-w-[90px]">{f?.label ?? vf.field}</span>
                          <select
                            value={vf.agg}
                            onChange={(e) =>
                              setValueFields((prev) => prev.map((v, vi) => (vi === i ? { ...v, agg: e.target.value as AggFunc } : v)))
                            }
                            className="bg-transparent text-[11px] font-medium text-muted-foreground outline-none"
                          >
                            {aggregationsForType(f?.type ?? 'string').map((a) => (
                              <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setValueFields((prev) => prev.filter((_, vi) => vi !== i))} className="text-muted-foreground hover:text-foreground">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })}
                  </Well_>
                </div>
              )}

              <Well_ id="filters" label="Filters">
                {filters.length === 0 && <EmptyHint text="Drop a field to filter the data" />}
                <div className="flex flex-col gap-1.5 w-full">
                  {filters.map((flt, i) => (
                    <FilterRow
                      key={`${flt.field}-${i}`}
                      filter={flt}
                      field={fieldByKey.get(flt.field)}
                      onChange={(next) => setFilters((prev) => prev.map((f, fi) => (fi === i ? next : f)))}
                      onRemove={() => setFilters((prev) => prev.filter((_, fi) => fi !== i))}
                    />
                  ))}
                </div>
              </Well_>

              {/* Preview */}
              {mode === 'pivot' && pivotResult ? (
                <PivotTableView
                  result={pivotResult}
                  valueFields={pivotConfig.valueFields}
                  fields={allFields}
                  rowFieldLabels={rowFields.map((k) => fieldByKey.get(k)?.label ?? k)}
                />
              ) : (
                <FlatTableView rows={flatRows} columns={flatColumns} />
              )}
            </div>
          </div>

          <DragOverlay>
            {activeDragField && (
              <div className="flex items-center gap-1.5 rounded-md border border-primary bg-card px-2 py-1.5 text-xs font-medium text-foreground shadow-lg">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" /> {activeDragField.label}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldChip({ field, mode, onAdd }: { field: ReportField; mode: Mode; onAdd: (well: Well, key: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `field:${field.key}` })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined

  const addOptions: { well: Well; label: string }[] =
    mode === 'table'
      ? [{ well: 'columns', label: 'Add to Columns' }, { well: 'filters', label: 'Add to Filters' }]
      : [
          { well: 'rows', label: 'Add to Rows' },
          { well: 'cols', label: 'Add to Columns' },
          { well: 'values', label: 'Add to Values' },
          { well: 'filters', label: 'Add to Filters' },
        ]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs text-foreground hover:border-border transition-colors ${isDragging ? 'opacity-40' : ''}`}
    >
      <span {...listeners} {...attributes} className="flex items-center gap-1.5 flex-1 min-w-0 cursor-grab active:cursor-grabbing">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{field.label}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><circle cx="8" cy="3" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="13" r="1.3"/></svg>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {addOptions.map((opt) => (
            <DropdownMenuItem key={opt.well} onClick={() => onAdd(opt.well, field.key)}>
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Well_({ id, label, children }: { id: Well; label: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `well:${id}` })
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 border-dashed p-3 space-y-2 transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-border/60 bg-muted/10'}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5 min-h-[36px]">{children}</div>
    </div>
  )
}

function Chip({
  label, onRemove, onMoveUp, onMoveDown,
}: {
  label: string
  onRemove: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-md bg-primary/10 pl-2 pr-1 py-1 text-xs text-foreground">
      <span className="truncate max-w-[120px]">{label}</span>
      {onMoveUp && (
        <button type="button" onClick={onMoveUp} className="text-muted-foreground hover:text-foreground">
          <ChevronUp className="h-3 w-3" />
        </button>
      )}
      {onMoveDown && (
        <button type="button" onClick={onMoveDown} className="text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <span className="text-[11px] text-muted-foreground/70 py-1.5">{text}</span>
}

const inputCls = 'rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function FilterRow({
  filter, field, onChange, onRemove,
}: {
  filter: FieldFilter
  field?: ReportField
  onChange: (next: FieldFilter) => void
  onRemove: () => void
}) {
  const label = field?.label ?? filter.field
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5">
      <span className="text-[11px] font-medium text-foreground min-w-[90px]">{label}</span>
      {field?.type === 'enum' && (
        <select value={String(filter.value)} onChange={(e) => onChange({ ...filter, op: 'eq', value: e.target.value })} className={inputCls}>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {field?.type === 'boolean' && (
        <select value={String(filter.value)} onChange={(e) => onChange({ ...filter, op: 'eq', value: e.target.value })} className={inputCls}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )}
      {field?.type === 'number' && (
        <>
          <select value={filter.op} onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp })} className={inputCls}>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
            <option value="eq">=</option>
          </select>
          <input type="number" value={Number(filter.value)} onChange={(e) => onChange({ ...filter, value: Number(e.target.value) })} className={`${inputCls} w-24`} />
        </>
      )}
      {field?.type === 'date' && (
        <>
          <select value={filter.op} onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp })} className={inputCls}>
            <option value="gte">From</option>
            <option value="lte">Until</option>
          </select>
          <input type="date" value={String(filter.value)} onChange={(e) => onChange({ ...filter, value: e.target.value })} className={inputCls} />
        </>
      )}
      {(!field || field.type === 'string') && (
        <input
          type="text"
          placeholder="contains…"
          value={String(filter.value)}
          onChange={(e) => onChange({ ...filter, op: 'contains', value: e.target.value })}
          className={`${inputCls} w-40`}
        />
      )}
      <button type="button" onClick={onRemove} className="ml-auto text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
