import { describe, expect, it } from 'vitest'
import { subItemLabel } from '../labels'

describe('subItemLabel', () => {
  it('sem personalização (null), sem produto, ou string vazia, cai no padrão "Turma"', () => {
    expect(subItemLabel({ sub_item_label: null })).toBe('Turma')
    expect(subItemLabel(null)).toBe('Turma')
    expect(subItemLabel(undefined)).toBe('Turma')
    expect(subItemLabel({ sub_item_label: '   ' })).toBe('Turma')
  })

  it('usa o rótulo personalizado do produto', () => {
    expect(subItemLabel({ sub_item_label: 'Projeto' })).toBe('Projeto')
    expect(subItemLabel({ sub_item_label: '  Conta  ' })).toBe('Conta')
  })

  it('pluraliza (+s) no caso comum', () => {
    expect(subItemLabel({ sub_item_label: 'Turma' }, { plural: true })).toBe('Turmas')
    expect(subItemLabel({ sub_item_label: 'Projeto' }, { plural: true })).toBe('Projetos')
    expect(subItemLabel({ sub_item_label: 'Conta' }, { plural: true })).toBe('Contas')
  })

  it('pluraliza terminado em "m" trocando por "ns"', () => {
    expect(subItemLabel({ sub_item_label: 'Item' }, { plural: true })).toBe('Itens')
  })

  it('pluraliza terminado em "r"/"z" com "es"', () => {
    expect(subItemLabel({ sub_item_label: 'Lugar' }, { plural: true })).toBe('Lugares')
  })

  it('não duplica "s" em palavra que já termina em "s"', () => {
    expect(subItemLabel({ sub_item_label: 'Status' }, { plural: true })).toBe('Status')
  })

  it('lower deixa minúsculo', () => {
    expect(subItemLabel({ sub_item_label: 'Turma' }, { lower: true })).toBe('turma')
    expect(subItemLabel({ sub_item_label: 'Turma' }, { plural: true, lower: true })).toBe('turmas')
  })
})
