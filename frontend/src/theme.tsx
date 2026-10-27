import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import Tabs from './components/Tabs'

export type ThemePref = 'system' | 'light' | 'dark'

interface ThemeCtx {
  pref: ThemePref
  setPref: (p: ThemePref) => void
}

const Ctx = createContext<ThemeCtx>({ pref: 'system', setPref: () => {} })
const KEY = 'nora-theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(pref: ThemePref) {
  const dark = pref === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : pref === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.themePref = pref
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)

  useEffect(() => {
    apply(pref)
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => apply('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])

  const setPref = useCallback((p: ThemePref) => {
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      /* sin almacenamiento: el tema solo dura esta sesión */
    }
    setPrefState(p)
  }, [])

  const value = useMemo(() => ({ pref, setPref }), [pref, setPref])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)

const OPTIONS: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Tema claro', icon: Sun },
  { id: 'system', label: 'Tema del sistema', icon: Monitor },
  { id: 'dark', label: 'Tema oscuro', icon: Moon },
]

/** Selector claro / sistema / oscuro con indicador deslizante. */
export function ThemeToggle() {
  const { pref, setPref } = useTheme()
  return (
    <Tabs
      role="radiogroup"
      label="Tema"
      value={pref}
      onChange={(id) => setPref(id as ThemePref)}
      items={OPTIONS.map(({ id, label, icon: Icon }) => ({ id, title: label, icon: <Icon size={15} /> }))}
    />
  )
}
