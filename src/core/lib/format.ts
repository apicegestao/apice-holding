import type { KpiUnit } from '../types'

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export function formatValue(value: number | null | undefined, unit: KpiUnit = 'number') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  switch (unit) {
    case 'currency':
      return currency.format(value)
    case 'percent':
      return `${decimal.format(value)}%`
    case 'days':
      return `${decimal.format(value)} d`
    default:
      return decimal.format(value)
  }
}

export function formatCompact(value: number | null | undefined, unit: KpiUnit = 'number') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (unit === 'percent') return `${decimal.format(value)}%`
  const abs = Math.abs(value)
  const prefix = unit === 'currency' ? 'R$ ' : ''
  if (abs >= 1_000_000) return `${prefix}${decimal.format(value / 1_000_000)} mi`
  if (abs >= 1_000) return `${prefix}${decimal.format(value / 1_000)} mil`
  return formatValue(value, unit)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR')
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** "há 3 dias", "em 2 dias" — usado nos prazos de tarefa. */
export function relativeDays(dateStr: string | null | undefined) {
  if (!dateStr) return null
  const target = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'amanhã'
  if (diff === -1) return 'ontem'
  return diff > 0 ? `em ${diff} dias` : `há ${Math.abs(diff)} dias`
}

/** Início e fim do período de acordo com a frequência do KPI. */
export function periodBounds(frequency: string, reference = new Date()) {
  const y = reference.getFullYear()
  const m = reference.getMonth()
  const d = reference.getDate()
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  switch (frequency) {
    case 'daily':
      return { start: iso(new Date(y, m, d)), end: iso(new Date(y, m, d)) }
    case 'weekly': {
      const weekday = new Date(y, m, d).getDay()
      const monday = new Date(y, m, d - ((weekday + 6) % 7))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { start: iso(monday), end: iso(sunday) }
    }
    case 'quarterly': {
      const first = Math.floor(m / 3) * 3
      return { start: iso(new Date(y, first, 1)), end: iso(new Date(y, first + 3, 0)) }
    }
    case 'yearly':
      return { start: iso(new Date(y, 0, 1)), end: iso(new Date(y, 11, 31)) }
    case 'monthly':
    default:
      return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) }
  }
}

export function labelPeriod(periodStart: string, frequency: string) {
  const date = new Date(`${periodStart}T12:00:00`)
  if (Number.isNaN(date.getTime())) return periodStart
  switch (frequency) {
    case 'daily':
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    case 'weekly':
      return `sem. ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
    case 'quarterly':
      return `${Math.floor(date.getMonth() / 3) + 1}º tri/${String(date.getFullYear()).slice(2)}`
    case 'yearly':
      return String(date.getFullYear())
    case 'monthly':
    default:
      return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
  }
}

export function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Verdadeiro quando o valor bateu a meta, respeitando a direção do KPI. */
export function isOnTarget(value: number, target: number | null, direction: 'up' | 'down') {
  if (target === null || target === undefined) return null
  return direction === 'up' ? value >= target : value <= target
}
