import { useCallback, type RefObject } from 'react'
import type { ApplyMode } from './AiAssist'

/** Une la IA con un <textarea>: actúa sobre lo seleccionado (o todo si no hay selección) y reemplaza o inserta debajo. */
export function useTextareaAi(ref: RefObject<HTMLTextAreaElement>, value: string, setValue: (v: string) => void) {
  const range = useCallback((): [number, number] => {
    const el = ref.current
    if (!el || el.selectionStart === el.selectionEnd) return [0, value.length]
    return [el.selectionStart, el.selectionEnd]
  }, [ref, value])

  const getText = useCallback(() => {
    const [a, b] = range()
    return value.slice(a, b)
  }, [range, value])

  const onApply = useCallback((out: string, mode: ApplyMode) => {
    const [a, b] = range()
    setValue(mode === 'replace' ? value.slice(0, a) + out + value.slice(b) : value.slice(0, b) + (value.slice(0, b).endsWith('\n') || !value.slice(0, b) ? '' : '\n\n') + out + value.slice(b))
  }, [range, value, setValue])

  return { getText, onApply }
}
