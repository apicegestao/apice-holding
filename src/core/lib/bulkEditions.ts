// Gera várias turmas (product_editions) de uma vez — pedido explícito:
// planejar um ano inteiro de turmas mensais (ex. 12 turmas de 2027 pro
// produto "Entre Donos") uma por uma, pelo formulário de vincular turma,
// era repetitivo demais. Isso gera só os dados (nome + datas); quem chama
// decide como inserir (product_editions em lote, depois um kpi vinculado
// por edição criada).
export const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export type BulkEditionOptions = {
  /** Vai antes do mês/ano no nome gerado — ex. "Imersão" vira "Imersão Março 2027". */
  prefix: string
  /** Quantas turmas gerar. */
  count: number
  /** Mês/ano da primeira turma, formato do input type="month" ("2027-01"). */
  startMonth: string
  /** De quantos em quantos meses uma turma nova começa (1 = toda mês, 3 = trimestral...). */
  intervalMonths: number
  /** 'month' = a turma dura o mês inteiro; 'custom' = usa startDay + durationDays. */
  durationMode: 'month' | 'custom'
  /** Só usado com durationMode 'custom': dia do mês em que cada turma começa. */
  startDay: number
  /** Só usado com durationMode 'custom': quantos dias a turma dura (inclusivo). */
  durationDays: number
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildBulkEditions(opts: BulkEditionOptions): { name: string; start_date: string; end_date: string }[] {
  const [y0, m0] = opts.startMonth.split('-').map(Number)
  const prefix = opts.prefix.trim()
  const rows: { name: string; start_date: string; end_date: string }[] = []
  for (let i = 0; i < opts.count; i++) {
    const totalMonths = (m0 - 1) + i * opts.intervalMonths
    const year = y0 + Math.floor(totalMonths / 12)
    const month = ((totalMonths % 12) + 12) % 12
    const monthLabel = MONTH_NAMES_PT[month]
    const name = prefix ? `${prefix} ${monthLabel} ${year}` : `${monthLabel} ${year}`

    let start: Date
    let end: Date
    if (opts.durationMode === 'custom') {
      start = new Date(year, month, opts.startDay)
      end = new Date(year, month, opts.startDay + opts.durationDays - 1)
    } else {
      start = new Date(year, month, 1)
      end = new Date(year, month + 1, 0) // dia 0 do mês seguinte = último dia deste mês
    }
    rows.push({ name, start_date: iso(start), end_date: iso(end) })
  }
  return rows
}
