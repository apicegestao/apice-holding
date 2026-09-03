import { describe, expect, it } from 'vitest'
import { buildChildrenByParent, contributionRatio, effectiveKpiValue, type RollupRow } from '../kpiRollup'

function row(kpi_id: string, value: number | null, parent_kpi_id: string | null = null): RollupRow {
  return { kpi_id, value, parent_kpi_id }
}

describe('effectiveKpiValue', () => {
  it('sem filhos, é o próprio valor', () => {
    const rows = [row('a', 42)]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(effectiveKpiValue('a', children, byId)).toBe(42)
  })

  it('sem filhos e sem valor próprio, é nulo', () => {
    const rows = [row('a', null)]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(effectiveKpiValue('a', children, byId)).toBeNull()
  })

  it('com filhos, soma os filhos — nunca usa um valor próprio que porventura exista', () => {
    // "produto" tem 1000 lançado nele mesmo por engano, mas o que vale é
    // a soma das turmas (600 + 900 = 1500), não o 1000.
    const rows = [
      row('produto', 1000),
      row('turma-set', 600, 'produto'),
      row('turma-out', 900, 'produto'),
    ]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(effectiveKpiValue('produto', children, byId)).toBe(1500)
  })

  it('cadeia de 3 níveis: avô soma o rollup do pai, não um valor direto dele', () => {
    const rows = [
      row('empresa', null),
      row('produto', null, 'empresa'),
      row('turma-set', 600, 'produto'),
      row('turma-out', 900, 'produto'),
    ]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(effectiveKpiValue('produto', children, byId)).toBe(1500)
    expect(effectiveKpiValue('empresa', children, byId)).toBe(1500)
  })

  it('soma só quem já tem valor — filho sem lançamento não vira zero, só é ignorado', () => {
    const rows = [row('produto', null), row('turma-set', 600, 'produto'), row('turma-out', null, 'produto')]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(effectiveKpiValue('produto', children, byId)).toBe(600)
  })

  it('nenhum filho com valor ainda: nulo, não zero (não faz sentido "meta zerada" antes de qualquer lançamento)', () => {
    const rows = [row('produto', null), row('turma-set', null, 'produto')]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(effectiveKpiValue('produto', children, byId)).toBeNull()
  })

  it('não trava num ciclo (defesa extra — o banco já impede formar um de verdade)', () => {
    const rows = [row('a', 10, 'b'), row('b', 20, 'a')]
    const children = buildChildrenByParent(rows)
    const byId = new Map(rows.map((r) => [r.kpi_id, r]))
    expect(() => effectiveKpiValue('a', children, byId)).not.toThrow()
  })
})

describe('contributionRatio', () => {
  it('fração simples do filho sobre o pai', () => {
    expect(contributionRatio(900, 10000)).toBeCloseTo(0.09)
  })

  it('sem valor do filho, é nulo (não é 0%)', () => {
    expect(contributionRatio(null, 10000)).toBeNull()
  })

  it('sem valor do pai, é nulo', () => {
    expect(contributionRatio(900, null)).toBeNull()
  })

  it('pai zerado, é nulo (não dá pra dividir por zero)', () => {
    expect(contributionRatio(900, 0)).toBeNull()
  })
})
