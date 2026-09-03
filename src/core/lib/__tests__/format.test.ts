import { describe, expect, it } from 'vitest'
import {
  attainmentRatio,
  formatNumberInput,
  formatValue,
  labelPeriod,
  parseNumberInput,
  periodBounds,
  splitTargetIntoPeriods,
  sumValuesInRange,
} from '../format'
import { FINER_FREQUENCIES, FREQUENCIES } from '../../types'

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

// Regressão do bug relatado: KPI criado com frequency='daily' nunca soma
// lançamentos de dias diferentes (o período de um dia É um único dia — não
// tem entry_frequency mais fina possível pra somar nele). 'daily' só pode
// ser a cadência principal do KPI se alguém reintroduzir a opção aqui; o
// banco também trava isso com uma constraint (migração 0030).
describe("'daily' não pode ser frequência principal de KPI", () => {
  it('não aparece entre as opções de frequência principal', () => {
    expect(FREQUENCIES).not.toContain('daily')
  })

  it('continua disponível como cadência de lançamento (entry_frequency) de toda frequência restante', () => {
    for (const frequency of FREQUENCIES) {
      expect(FINER_FREQUENCIES[frequency]).toContain('daily')
    }
  })
})

describe('splitTargetIntoPeriods', () => {
  it('reparte em parcelas iguais, não acumuladas — exemplo do usuário: 100.000 em 4 meses = 4x 25.000', () => {
    const chunks = splitTargetIntoPeriods(new Date(2026, 8, 3), new Date(2026, 11, 30), 'monthly', 100_000)
    expect(chunks).toHaveLength(4)
    expect(chunks.map((c) => c.target_value)).toEqual([25_000, 25_000, 25_000, 25_000])
    expect(chunks.map((c) => c.seq)).toEqual([1, 2, 3, 4])
  })

  it('a soma das parcelas bate exatamente com o total, mesmo quando não divide exato (100/3)', () => {
    const chunks = splitTargetIntoPeriods(new Date(2026, 8, 15), new Date(2026, 11, 1), 'monthly', 100)
    expect(chunks).toHaveLength(3)
    expect(chunks[0].target_value).toBe(33.33)
    const total = chunks.reduce((sum, c) => sum + c.target_value, 0)
    expect(Math.round(total * 100) / 100).toBe(100)
  })

  it('meses de calendário de verdade — fevereiro (28 dias em 2026) não vira "30 dias fixos"', () => {
    const chunks = splitTargetIntoPeriods(new Date(2026, 0, 1), new Date(2026, 2, 1), 'monthly', 90)
    expect(chunks.map((c) => c.period_start)).toEqual(['2026-01-01', '2026-02-01'])
    expect(chunks.map((c) => c.period_end)).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('dia/semana/quinzena avançam por dias fixos, não por mês', () => {
    // 2024-01-01 é segunda-feira (mesma âncora usada em periodBounds) —
    // datas escolhidas de propósito pra não precisar calcular dia da
    // semana à mão no teste.
    const chunks = splitTargetIntoPeriods(new Date(2024, 0, 1), new Date(2024, 0, 15), 'weekly', 200)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].period_start).toBe('2024-01-01')
    expect(chunks[0].period_end).toBe('2024-01-07')
  })

  it('período curto demais pra periodicidade escolhida ainda gera uma parcela só', () => {
    const chunks = splitTargetIntoPeriods(new Date(2026, 0, 1), new Date(2026, 0, 5), 'yearly', 500)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].target_value).toBe(500)
  })

  // Regressão de bug relatado: repartir "por mês" a partir de hoje (dia 3,
  // por exemplo) gerava parcelas começando no dia 3 de cada mês — nunca
  // batia com o lançamento do mês, sempre datado no dia 1 (mesma convenção
  // de periodBounds). A primeira parcela tem que começar no 1º dia do mês
  // corrente, não em "hoje" cru, senão um lançamento de início de mês
  // nunca aparece em nenhuma parcela.
  it('a primeira parcela mensal começa no 1º dia do mês corrente, não em "hoje" — senão o lançamento do mês nunca bate em nenhuma parcela', () => {
    const chunks = splitTargetIntoPeriods(new Date(2026, 8, 3), new Date(2026, 11, 30), 'monthly', 80_000)
    expect(chunks[0].period_start).toBe('2026-09-01')
    expect(sumValuesInRange([{ period_start: '2026-09-01', value: 1682 }], chunks[0].period_start, chunks[0].period_end)).toBe(1682)
  })

  it('repartir por trimestre também ancora no início do trimestre corrente, não em "hoje"', () => {
    // 3/set cai no 3º trimestre (jul-set) — a parcela tem que começar 1/jul.
    const chunks = splitTargetIntoPeriods(new Date(2026, 8, 3), new Date(2027, 0, 1), 'quarterly', 300)
    expect(chunks[0].period_start).toBe('2026-07-01')
  })
})

describe('sumValuesInRange', () => {
  const series = [
    { period_start: '2026-01-01', value: 10 },
    { period_start: '2026-02-01', value: 20 },
    { period_start: '2026-03-01', value: 5 },
  ]

  it('soma só os lançamentos cujo período começa dentro do intervalo', () => {
    expect(sumValuesInRange(series, '2026-01-01', '2026-02-28')).toBe(30)
  })

  it('sem nenhum lançamento no intervalo, é nulo (não é zero)', () => {
    expect(sumValuesInRange(series, '2026-06-01', '2026-06-30')).toBeNull()
  })

  it('aceita value como string (vindo direto do supabase)', () => {
    expect(sumValuesInRange([{ period_start: '2026-01-01', value: '15.5' }], '2026-01-01', '2026-01-31')).toBe(15.5)
  })
})
