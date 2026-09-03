import { describe, expect, it } from 'vitest'
import { buildBulkEditions } from '../bulkEditions'

describe('buildBulkEditions', () => {
  it('gera 12 turmas mensais, uma por mês, começando no mês pedido', () => {
    const rows = buildBulkEditions({
      prefix: 'Imersão',
      count: 12,
      startMonth: '2027-01',
      intervalMonths: 1,
      durationMode: 'month',
      startDay: 1,
      durationDays: 1,
    })
    expect(rows).toHaveLength(12)
    expect(rows[0]).toEqual({ name: 'Imersão Janeiro 2027', start_date: '2027-01-01', end_date: '2027-01-31' })
    expect(rows[1].name).toBe('Imersão Fevereiro 2027')
    expect(rows[11]).toEqual({ name: 'Imersão Dezembro 2027', start_date: '2027-12-01', end_date: '2027-12-31' })
  })

  it('mês inteiro respeita fevereiro de 28/29 dias (calendário de verdade)', () => {
    const rows = buildBulkEditions({
      prefix: '',
      count: 1,
      startMonth: '2027-02',
      intervalMonths: 1,
      durationMode: 'month',
      startDay: 1,
      durationDays: 1,
    })
    expect(rows[0]).toEqual({ name: 'Fevereiro 2027', start_date: '2027-02-01', end_date: '2027-02-28' })
  })

  it('atravessa o ano quando o intervalo empurra o mês além de dezembro', () => {
    const rows = buildBulkEditions({
      prefix: 'Imersão',
      count: 3,
      startMonth: '2026-11',
      intervalMonths: 1,
      durationMode: 'month',
      startDay: 1,
      durationDays: 1,
    })
    expect(rows.map((r) => r.name)).toEqual(['Imersão Novembro 2026', 'Imersão Dezembro 2026', 'Imersão Janeiro 2027'])
  })

  it('intervalo maior que 1 pula meses (ex. trimestral)', () => {
    const rows = buildBulkEditions({
      prefix: 'Ciclo',
      count: 4,
      startMonth: '2027-01',
      intervalMonths: 3,
      durationMode: 'month',
      startDay: 1,
      durationDays: 1,
    })
    expect(rows.map((r) => r.name)).toEqual(['Ciclo Janeiro 2027', 'Ciclo Abril 2027', 'Ciclo Julho 2027', 'Ciclo Outubro 2027'])
  })

  it('duração customizada usa dia de início e quantidade de dias, não o mês inteiro', () => {
    const rows = buildBulkEditions({
      prefix: 'Imersão',
      count: 2,
      startMonth: '2027-03',
      intervalMonths: 1,
      durationMode: 'custom',
      startDay: 15,
      durationDays: 3,
    })
    expect(rows[0]).toEqual({ name: 'Imersão Março 2027', start_date: '2027-03-15', end_date: '2027-03-17' })
    expect(rows[1]).toEqual({ name: 'Imersão Abril 2027', start_date: '2027-04-15', end_date: '2027-04-17' })
  })

  it('sem prefixo, o nome é só mês e ano', () => {
    const rows = buildBulkEditions({
      prefix: '',
      count: 1,
      startMonth: '2027-05',
      intervalMonths: 1,
      durationMode: 'month',
      startDay: 1,
      durationDays: 1,
    })
    expect(rows[0].name).toBe('Maio 2027')
  })
})
