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

/**
 * Quanto já foi entregue da meta, em fração de 1 (não em %). Mesma conta
 * usada nos gráficos de atingimento: num KPI "up" (maior é melhor) é
 * valor/meta; num "down" (menor é melhor, ex. churn) é meta/valor — assim
 * também sobe acima de 1 quando o resultado supera a meta. Sem meta ou sem
 * valor ainda, não dá pra calcular.
 */
export function attainmentRatio(
  value: number | null,
  target: number | null,
  direction: 'up' | 'down',
): number | null {
  if (value === null || target === null || target === 0) return null
  return direction === 'up' ? value / target : value > 0 ? target / value : 0
}

/**
 * Lê um número digitado por gente. Aceita "1.000.000,00", "1000000",
 * "R$ 1.234,56", "12,5%" e também o formato americano "1,234.56".
 *
 * Regra: se houver vírgula e ponto, o último dos dois é o decimal. Só vírgula,
 * ela é o decimal. Só ponto, ele é separador de milhar quando vier seguido de
 * exatamente três dígitos ("1.000" = mil) — em português é o que a pessoa quer
 * dizer; "1.5" e "1.50" continuam sendo decimais.
 */
export function parseNumberInput(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null

  const cleaned = raw.replace(/[^\d.,-]/g, '').trim()
  if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.') return null

  const negative = cleaned.trimStart().startsWith('-')
  let body = cleaned.replace(/-/g, '')

  const lastComma = body.lastIndexOf(',')
  const lastDot = body.lastIndexOf('.')

  let decimal = ''
  if (lastComma !== -1 && lastDot !== -1) {
    decimal = lastComma > lastDot ? ',' : '.'
  } else if (lastComma !== -1) {
    decimal = ','
  } else if (lastDot !== -1) {
    const digitsAfter = body.length - lastDot - 1
    const dots = body.split('.').length - 1
    decimal = dots === 1 && digitsAfter !== 3 ? '.' : ''
  }

  if (decimal) {
    const grouping = decimal === ',' ? '.' : ','
    body = body.split(grouping).join('')
    const index = body.lastIndexOf(decimal)
    body = `${body.slice(0, index).split(decimal).join('')}.${body.slice(index + 1)}`
  } else {
    body = body.replace(/[.,]/g, '')
  }

  if (body === '' || body === '.') return null
  const parsed = Number(body)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

/** Como o número aparece no campo quando ele perde o foco. */
export function formatNumberInput(value: number | null | undefined, unit: KpiUnit = 'number') {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  const fractionDigits = unit === 'currency' ? 2 : unit === 'percent' ? 2 : 4
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: unit === 'currency' ? 2 : 0,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** Prefixo e sufixo mostrados junto ao campo, conforme a unidade do indicador. */
export function unitAffix(unit: KpiUnit): { prefix?: string; suffix?: string } {
  switch (unit) {
    case 'currency':
      return { prefix: 'R$' }
    case 'percent':
      return { suffix: '%' }
    case 'days':
      return { suffix: 'dias' }
    case 'ratio':
      return { suffix: 'x' }
    default:
      return {}
  }
}
