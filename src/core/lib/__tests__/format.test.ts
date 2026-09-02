import { describe, expect, it } from 'vitest'
import { formatNumberInput, formatValue, parseNumberInput } from '../format'

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
