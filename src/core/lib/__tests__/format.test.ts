import { describe, expect, it } from 'vitest'
import { attainmentRatio, formatNumberInput, formatValue, labelPeriod, parseNumberInput, periodBounds } from '../format'

describe('parseNumberInput', () => {
  it('lê o formato brasileiro com milhar e decimal', () => {
    expect(parseNumberInput('1.000.000,00')).toBe(1_000_000)
    expect(parseNumberInput('1.234,56')).toBe(1234.56)
    expect(parseNumberInput('12.000')).toBe(12_000)
    expect(parseNumberInput('1.000')).toBe(1000)
  })

  it('lê número solto, com ou sem decimal', () => {
    expect(parseNumberInput('1000000')).toBe(1_000_000)
    expect(parseNumberInput('1,5')).toBe(1.5)
    expect(parseNumberInput('1.5')).toBe(1.5)
    expect(parseNumberInput('1.50')).toBe(1.5)
    expect(parseNumberInput('0,001')).toBe(0.001)
  })

  it('ignora símbolo de moeda, porcentagem e espaços', () => {
    expect(parseNumberInput('R$ 1.234,56')).toBe(1234.56)
    expect(parseNumberInput('12,5%')).toBe(12.5)
    expect(parseNumberInput('  500  ')).toBe(500)
  })

  it('aceita também o formato americano', () => {
    expect(parseNumberInput('1,234.56')).toBe(1234.56)
    expect(parseNumberInput('1,000,000.00')).toBe(1_000_000)
  })

  it('entende negativo', () => {
    expect(parseNumberInput('-1.234,50')).toBe(-1234.5)
    expect(parseNumberInput('-0,5')).toBe(-0.5)
  })

  it('devolve nulo quando não há número', () => {
    expect(parseNumberInput('')).toBeNull()
    expect(parseNumberInput('   ')).toBeNull()
    expect(parseNumberInput('abc')).toBeNull()
    expect(parseNumberInput('-')).toBeNull()
    expect(parseNumberInput(',')).toBeNull()
    expect(parseNumberInput(null)).toBeNull()
  })

  it('sobrevive à ida e volta pelo formatador do campo', () => {
    for (const original of [0, 1, 1.5, 1234.56, 1_000_000, -250.75]) {
      expect(parseNumberInput(formatNumberInput(original, 'currency'))).toBe(original)
    }
  })
})

describe('formatValue', () => {
  // Intl usa espaço não separável depois do "R$"; normalizamos para comparar.
  const plain = (value: string) => value.replace(/\u00a0/g, ' ')

  it('mostra moeda, percentual e dias em português', () => {
    expect(plain(formatValue(1_000_000, 'currency'))).toBe('R$ 1.000.000,00')
    expect(plain(formatValue(12.5, 'percent'))).toBe('12,5%')
    expect(plain(formatValue(30, 'days'))).toBe('30 d')
    expect(plain(formatValue(1234.5, 'number'))).toBe('1.234,5')
  })

  it('mostra travessão quando não há valor', () => {
    expect(formatValue(null)).toBe('—')
    expect(formatValue(undefined)).toBe('—')
  })
})

describe('attainmentRatio', () => {
  it('num KPI "up" (maior é melhor), é valor sobre meta', () => {
    expect(attainmentRatio(50, 100, 'up')).toBe(0.5)
    expect(attainmentRatio(120, 100, 'up')).toBe(1.2)
    expect(attainmentRatio(0, 100, 'up')).toBe(0)
  })

  it('num KPI "down" (menor é melhor, ex. churn), é meta sobre valor', () => {
    expect(attainmentRatio(10, 5, 'down')).toBe(0.5)
    expect(attainmentRatio(5, 10, 'down')).toBe(2)
  })

  it('sem valor ainda lançado (0) num KPI "down", não dá pra dividir — trata como 0', () => {
    expect(attainmentRatio(0, 5, 'down')).toBe(0)
  })

  it('devolve nulo quando falta valor, meta, ou a meta é zero', () => {
    expect(attainmentRatio(null, 100, 'up')).toBeNull()
    expect(attainmentRatio(50, null, 'up')).toBeNull()
    expect(attainmentRatio(50, 0, 'up')).toBeNull()
  })
})

describe('periodBounds quinzenal', () => {
  // Mesma âncora e mesma conta que app.coarse_period_bounds() no banco
  // (migração 0026_kpi_lifecycle.sql) — os dois têm que bater exatamente,
  // senão um lançamento cai num período aqui e noutro lá. Casos conferidos
  // rodando a função SQL de verdade contra as mesmas datas.
  it('a própria âncora (uma segunda-feira) inicia a primeira quinzena', () => {
    expect(periodBounds('biweekly', new Date(2024, 0, 1))).toEqual({ start: '2024-01-01', end: '2024-01-14' })
  })

  it('qualquer dia dentro da quinzena cai no mesmo período', () => {
    expect(periodBounds('biweekly', new Date(2024, 0, 8))).toEqual({ start: '2024-01-01', end: '2024-01-14' })
    expect(periodBounds('biweekly', new Date(2024, 0, 14))).toEqual({ start: '2024-01-01', end: '2024-01-14' })
  })

  it('quinzena seguinte começa exatamente 14 dias depois', () => {
    expect(periodBounds('biweekly', new Date(2024, 0, 15))).toEqual({ start: '2024-01-15', end: '2024-01-28' })
  })

  it('funciona longe da âncora, atravessando ano', () => {
    expect(periodBounds('biweekly', new Date(2026, 8, 2))).toEqual({ start: '2026-08-24', end: '2026-09-06' })
    expect(periodBounds('biweekly', new Date(2026, 11, 31))).toEqual({ start: '2026-12-28', end: '2027-01-10' })
  })

  it('funciona antes da âncora também (quinzenas negativas)', () => {
    expect(periodBounds('biweekly', new Date(2023, 11, 31))).toEqual({ start: '2023-12-18', end: '2023-12-31' })
  })
})

describe('labelPeriod', () => {
  it('rotula a quinzena pela data de início', () => {
    expect(labelPeriod('2024-01-15', 'biweekly')).toBe('quinz. 15/01')
  })
})
