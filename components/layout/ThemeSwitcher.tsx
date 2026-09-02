'use client'

import { useEffect, useState } from 'react'
import { Palette, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ThemeValue = 'light' | 'petrol' | 'bordeaux' | 'slate' | 'pastel' | 'dark'

const THEME_STORAGE_KEY = 'citykart-theme'

const THEME_OPTIONS: { value: ThemeValue; label: string; hint: string; swatch: string }[] = [
  { value: 'light', label: 'Blue', hint: 'Default royal blue', swatch: '#1A4D8F' },
  { value: 'petrol', label: 'Petrol', hint: 'Deep teal', swatch: '#0F3D44' },
  { value: 'bordeaux', label: 'Bordeaux', hint: 'Wine red', swatch: '#33091B' },
  { value: 'slate', label: 'Slate', hint: 'Storm grey', swatch: '#283440' },
  { value: 'pastel', label: 'Pastel', hint: 'Soft violet', swatch: '#564080' },
  { value: 'dark', label: 'Synthwave', hint: 'Dark / electric', swatch: '#5B8FD6' },
]

/** data-theme drives the token overrides; the .dark class additionally
 *  activates `dark:` Tailwind utilities for the Synthwave theme. */
function applyTheme(value: ThemeValue) {
  const root = document.documentElement
  root.setAttribute('data-theme', value)
  root.classList.toggle('dark', value === 'dark')
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeValue>('light')

  // Sync state to whatever the no-flash script already applied on first paint.
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeValue | null
    const valid = THEME_OPTIONS.some((o) => o.value === stored) ? (stored as ThemeValue) : 'light'
    // client-only hydration from localStorage — must run after mount to avoid SSR mismatch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(valid)
    applyTheme(valid)
  }, [])

  const choose = (value: ThemeValue) => {
    localStorage.setItem(THEME_STORAGE_KEY, value)
    setTheme(value)
    applyTheme(value)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="grid h-9 w-9 place-items-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Change theme"
          >
            <Palette className="h-4 w-4" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Theme
          </DropdownMenuLabel>
          {THEME_OPTIONS.map((opt) => {
            const active = opt.value === theme
            return (
              <DropdownMenuItem key={opt.value} onClick={() => choose(opt.value)} className="gap-2.5">
                <span
                  className="h-5 w-5 flex-shrink-0 rounded-full ring-1 ring-border"
                  style={{ background: opt.swatch }}
                />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[12px] font-semibold">{opt.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{opt.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
