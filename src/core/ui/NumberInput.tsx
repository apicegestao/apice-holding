// Campo numérico que entende como brasileiro digita: "1.000.000,00" vira
// 1000000, e não 1. O <input type="number"> nativo não dá conta disso, porque
// o navegador só aceita ponto decimal e descarta o resto.
import { useEffect, useState } from 'react'
import { formatNumberInput, parseNumberInput, unitAffix } from '../lib/format'
import type { KpiUnit } from '../types'

export function NumberInput({
  value,
  onChange,
  unit = 'number',
  placeholder,
  required = false,
  disabled = false,
  className = '',
  id,
}: {
  value: number | null
  onChange: (value: number | null) => void
  unit?: KpiUnit
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  id?: string
}) {
  const [text, setText] = useState(() => formatNumberInput(value, unit))
  const [focused, setFocused] = useState(false)

  // Enquanto a pessoa digita, o texto é dela. Fora disso, o campo reflete o
  // valor de verdade — inclusive quando o formulário é preenchido de fora.
  useEffect(() => {
    if (!focused) setText(formatNumberInput(value, unit))
  }, [value, unit, focused])

  const { prefix, suffix } = unitAffix(unit)

  return (
    <span className={`relative block ${className}`}>
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-content-soft">
          {prefix}
        </span>
      )}
      <input
        id={id}
        className={`input ${prefix ? 'pl-10' : ''} ${suffix ? 'pr-12' : ''}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder ?? (unit === 'currency' ? '0,00' : '0')}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setText(event.target.value)
          onChange(parseNumberInput(event.target.value))
        }}
        onBlur={() => {
          setFocused(false)
          const parsed = parseNumberInput(text)
          onChange(parsed)
          setText(formatNumberInput(parsed, unit))
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-content-soft">
          {suffix}
        </span>
      )}
    </span>
  )
}
