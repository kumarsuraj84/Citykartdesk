"use client"

import * as React from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Search, ChevronDown, X, Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { filterActiveOptions } from "@/lib/forms/options"
import type { FormFieldOption } from "@/types"

// Base UI's Combobox accepts a nested option tree (FormFieldOption.children) via
// grouping, but the flat item list this component builds is simpler and matches
// what the plain <select>/checkbox-grid renderers already did — indent non-leaf
// entries as disabled group headers instead of wiring up Combobox.Group.
type FlatOption = { value: string; label: string; depth: number; disabled?: boolean }

function flattenOptions(options: FormFieldOption[] | undefined, depth = 0): FlatOption[] {
  // Archived options are excluded — this is only ever used to offer NEW
  // selections (request creation), never to redisplay a past request's
  // already-submitted value, so there's no need to keep them for lookup here.
  return filterActiveOptions(options).flatMap((opt) => {
    if (opt.children?.length) {
      return [
        { value: opt.value, label: opt.label, depth, disabled: true },
        ...flattenOptions(opt.children, depth + 1),
      ]
    }
    return [{ value: opt.value, label: opt.label, depth }]
  })
}

const popupCls =
  "z-50 max-h-72 w-(--anchor-width) min-w-[200px] overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

interface SearchableSelectProps {
  options: FormFieldOption[]
  placeholder?: string
  className?: string
  id?: string
}

interface SingleProps extends SearchableSelectProps {
  multiple?: false
  value: string
  onChange: (value: string) => void
}

interface MultiProps extends SearchableSelectProps {
  multiple: true
  value: string[]
  onChange: (value: string[]) => void
}

/** A type-to-filter dropdown for fields with long option lists — built on Base UI's
 *  Combobox. Drop-in alternative to a plain `<select>` (single) or checkbox grid (multi).
 *
 *  The Combobox's `items` prop takes `FlatOption` objects (that's what drives its
 *  generic `Value` type), so `itemToStringLabel`/`filter` receive whole `FlatOption`
 *  objects, not the bare string `value` — every callback below is written against
 *  that object, and only the boundary props (`value`/`onChange`) deal in plain
 *  strings, converting via `byValue`. */
export function SearchableSelect(props: SingleProps | MultiProps) {
  const { options, placeholder, className, id } = props
  const flat = React.useMemo(() => flattenOptions(options), [options])
  const byValue = React.useMemo(() => new Map(flat.map((o) => [o.value, o])), [flat])

  const itemToStringLabel = React.useCallback((item: FlatOption) => item.label, [])

  const filterByLabel = React.useCallback(
    (item: FlatOption, query: string) => item.label.toLowerCase().includes(query.trim().toLowerCase()),
    []
  )

  const selectedItems = React.useMemo(() => {
    const values = props.multiple ? props.value : props.value ? [props.value] : []
    return values.map((v) => byValue.get(v)).filter((o): o is FlatOption => !!o)
  }, [props.multiple, props.value, byValue])

  const inputCls = cn(
    "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground",
    "placeholder:text-muted-foreground/50 transition-colors border-border hover:border-ring/50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring",
    className
  )

  if (props.multiple) {
    const selected = props.value
    return (
      <Combobox.Root
        items={flat}
        multiple
        value={selectedItems}
        onValueChange={(next) => props.onChange((next as FlatOption[]).map((o) => o.value))}
        itemToStringLabel={itemToStringLabel}
        filter={filterByLabel}
      >
        <Combobox.InputGroup className={cn(inputCls, "flex flex-wrap items-center gap-1.5 py-1.5")}>
          <Combobox.Chips className="flex flex-wrap items-center gap-1 empty:hidden">
            {selectedItems.map((item) => (
              <Combobox.Chip
                key={item.value}
                className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary data-highlighted:bg-primary/20"
              >
                {item.label}
                <Combobox.ChipRemove className="rounded-full hover:bg-primary/20">
                  <X className="h-3 w-3" />
                </Combobox.ChipRemove>
              </Combobox.Chip>
            ))}
          </Combobox.Chips>
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <Combobox.Input
            id={id}
            placeholder={selected.length === 0 ? (placeholder ?? "Search…") : "Add more…"}
            className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner className="z-50 outline-none" sideOffset={4}>
            <Combobox.Popup className={popupCls}>
              <Combobox.Empty className="px-3 py-2 text-xs text-muted-foreground">
                No matches found.
              </Combobox.Empty>
              <Combobox.List>
                {(item: FlatOption) => (
                  <Combobox.Item
                    key={item.value}
                    value={item}
                    disabled={item.disabled}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-sm outline-none",
                      "data-highlighted:bg-muted",
                      item.disabled && "cursor-default font-semibold text-muted-foreground"
                    )}
                    style={{ paddingLeft: `${10 + item.depth * 14}px` }}
                  >
                    {item.label}
                    <Combobox.ItemIndicator className="text-primary">
                      <Check className="h-3.5 w-3.5" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    )
  }

  const selectedItem = props.value ? byValue.get(props.value) ?? null : null

  return (
    <Combobox.Root
      items={flat}
      value={selectedItem}
      onValueChange={(next) => props.onChange((next as FlatOption | null)?.value ?? '')}
      itemToStringLabel={itemToStringLabel}
      filter={filterByLabel}
    >
      <Combobox.InputGroup className={cn(inputCls, "flex items-center gap-1.5")}>
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <Combobox.Input
          id={id}
          placeholder={placeholder ?? "Search…"}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        />
        {props.value ? (
          <Combobox.Clear className="shrink-0 rounded-full p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </Combobox.Clear>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner className="z-50 outline-none" sideOffset={4}>
          <Combobox.Popup className={popupCls}>
            <Combobox.Empty className="px-3 py-2 text-xs text-muted-foreground">
              No matches found.
            </Combobox.Empty>
            <Combobox.List>
              {(item: FlatOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  disabled={item.disabled}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-sm outline-none",
                    "data-highlighted:bg-muted",
                    item.disabled && "cursor-default font-semibold text-muted-foreground"
                  )}
                  style={{ paddingLeft: `${10 + item.depth * 14}px` }}
                >
                  {item.label}
                  <Combobox.ItemIndicator className="text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
