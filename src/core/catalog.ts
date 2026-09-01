// Listas de apoio dos formulários. Ficam aqui, e não espalhadas pelas telas,
// para que incluir um setor ou um indicador seja mexer em um arquivo só.
import type { KpiDirection, KpiFrequency, KpiUnit } from './types'

export const SECTORS = [
  'Contabilidade',
  'Consultoria',
  'Assessoria empresarial',
  'Tecnologia / Software',
  'Marketing e publicidade',
  'Educação e treinamento',
  'Varejo',
  'Atacado e distribuição',
  'Indústria',
  'Construção civil',
  'Imobiliário',
  'Serviços financeiros',
  'Seguros',
  'Jurídico',
  'Saúde',
  'Alimentação e bebidas',
  'Logística e transporte',
  'Agronegócio',
  'Energia',
  'Turismo e eventos',
  'Franquias',
  'Holding / Participações',
  'Outro',
] as const

export type KpiTemplate = {
  name: string
  category: string
  unit: KpiUnit
  direction: KpiDirection
  frequency: KpiFrequency
  description: string
}

export const KPI_CATEGORIES = [
  'Financeiro',
  'Comercial',
  'Marketing',
  'Operacional',
  'Clientes',
  'Pessoas',
] as const

/** Indicadores comuns, para não começar de uma tela em branco. */
export const KPI_CATALOG: KpiTemplate[] = [
  // ---------------------------------------------------------- Financeiro
  { name: 'Faturamento', category: 'Financeiro', unit: 'currency', direction: 'up', frequency: 'monthly',
    description: 'Receita bruta reconhecida no período.' },
  { name: 'Receita recorrente (MRR)', category: 'Financeiro', unit: 'currency', direction: 'up', frequency: 'monthly',
    description: 'Receita previsível de contratos ativos.' },
  { name: 'Margem de contribuição', category: 'Financeiro', unit: 'percent', direction: 'up', frequency: 'monthly',
    description: 'Receita menos custos variáveis, sobre a receita.' },
  { name: 'Lucro líquido', category: 'Financeiro', unit: 'currency', direction: 'up', frequency: 'monthly',
    description: 'Resultado depois de todas as despesas e impostos.' },
  { name: 'Despesa fixa', category: 'Financeiro', unit: 'currency', direction: 'down', frequency: 'monthly',
    description: 'Custos que não variam com o volume.' },
  { name: 'Inadimplência', category: 'Financeiro', unit: 'percent', direction: 'down', frequency: 'monthly',
    description: 'Parcela do faturamento vencida e não recebida.' },
  { name: 'Prazo médio de recebimento', category: 'Financeiro', unit: 'days', direction: 'down', frequency: 'monthly',
    description: 'Dias entre a venda e a entrada do dinheiro.' },
  { name: 'Saldo de caixa', category: 'Financeiro', unit: 'currency', direction: 'up', frequency: 'monthly',
    description: 'Dinheiro disponível no fim do período.' },

  // ----------------------------------------------------------- Comercial
  { name: 'Novos clientes', category: 'Comercial', unit: 'number', direction: 'up', frequency: 'monthly',
    description: 'Contratos fechados no período.' },
  { name: 'Ticket médio', category: 'Comercial', unit: 'currency', direction: 'up', frequency: 'monthly',
    description: 'Receita dividida pelo número de vendas.' },
  { name: 'Taxa de conversão', category: 'Comercial', unit: 'percent', direction: 'up', frequency: 'monthly',
    description: 'Propostas fechadas sobre propostas enviadas.' },
  { name: 'Propostas enviadas', category: 'Comercial', unit: 'number', direction: 'up', frequency: 'monthly',
    description: 'Volume de oportunidades trabalhadas.' },
  { name: 'Ciclo de venda', category: 'Comercial', unit: 'days', direction: 'down', frequency: 'monthly',
    description: 'Dias entre o primeiro contato e o fechamento.' },

  // ----------------------------------------------------------- Marketing
  { name: 'Leads gerados', category: 'Marketing', unit: 'number', direction: 'up', frequency: 'monthly',
    description: 'Contatos qualificados que entraram no funil.' },
  { name: 'Custo por lead', category: 'Marketing', unit: 'currency', direction: 'down', frequency: 'monthly',
    description: 'Investimento dividido pelos leads gerados.' },
  { name: 'Custo de aquisição (CAC)', category: 'Marketing', unit: 'currency', direction: 'down', frequency: 'monthly',
    description: 'Quanto custa conquistar um cliente novo.' },
  { name: 'Retorno sobre investimento', category: 'Marketing', unit: 'ratio', direction: 'up', frequency: 'monthly',
    description: 'Receita gerada por real investido.' },

  // --------------------------------------------------------- Operacional
  { name: 'Entregas no prazo', category: 'Operacional', unit: 'percent', direction: 'up', frequency: 'monthly',
    description: 'Trabalhos concluídos dentro do combinado.' },
  { name: 'Retrabalho', category: 'Operacional', unit: 'percent', direction: 'down', frequency: 'monthly',
    description: 'Entregas que precisaram ser refeitas.' },
  { name: 'Produtividade por pessoa', category: 'Operacional', unit: 'number', direction: 'up', frequency: 'monthly',
    description: 'Volume de entregas dividido pela equipe.' },
  { name: 'Tempo médio de atendimento', category: 'Operacional', unit: 'days', direction: 'down', frequency: 'monthly',
    description: 'Da abertura do chamado até a solução.' },

  // ------------------------------------------------------------ Clientes
  { name: 'Clientes ativos', category: 'Clientes', unit: 'number', direction: 'up', frequency: 'monthly',
    description: 'Base em atendimento no período.' },
  { name: 'Churn', category: 'Clientes', unit: 'percent', direction: 'down', frequency: 'monthly',
    description: 'Clientes perdidos sobre a base do início do período.' },
  { name: 'NPS', category: 'Clientes', unit: 'number', direction: 'up', frequency: 'quarterly',
    description: 'Nota de recomendação, de -100 a 100.' },
  { name: 'Tempo de vida do cliente', category: 'Clientes', unit: 'number', direction: 'up', frequency: 'yearly',
    description: 'Meses médios de permanência na base.' },

  // -------------------------------------------------------------- Pessoas
  { name: 'Headcount', category: 'Pessoas', unit: 'number', direction: 'up', frequency: 'monthly',
    description: 'Pessoas na equipe no fim do período.' },
  { name: 'Turnover', category: 'Pessoas', unit: 'percent', direction: 'down', frequency: 'monthly',
    description: 'Desligamentos sobre o total da equipe.' },
  { name: 'Absenteísmo', category: 'Pessoas', unit: 'percent', direction: 'down', frequency: 'monthly',
    description: 'Faltas sobre os dias úteis.' },
  { name: 'Horas de treinamento', category: 'Pessoas', unit: 'number', direction: 'up', frequency: 'quarterly',
    description: 'Horas de capacitação por pessoa.' },
]
