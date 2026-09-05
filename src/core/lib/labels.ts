// Rótulo adaptável de sub-produto. O sistema nasceu em cima do vocabulário
// da MDD (produto → "turma") mas atende empresas bem diferentes (consultoria,
// SaaS) — uma "Turma" não faz sentido pra um "Projeto" da Vibra ou uma
// "Conta" da Darius. Em vez de fixar "turma" no código, cada produto escolhe
// o próprio rótulo (`Product.sub_item_label`); null cai no padrão genérico
// abaixo — o PADRÃO em si não pode assumir um tipo de negócio (educação),
// só um produto que pediu explicitamente "Turma" tem "Turma". Os produtos já
// existentes da MDD tiveram o rótulo gravado explicitamente numa migração de
// dados, pra manter o texto que já usavam sem depender deste padrão.
import type { Product } from '../types'

const DEFAULT_SUB_ITEM_LABEL = 'Sub produto'

// Pluralização simples PT-BR — cobre os casos comuns esperados aqui (Turma,
// Projeto, Plano, Conta, Unidade, Contrato, Cliente...): terminado em vogal
// ou consoante comum vira "+s"; em "m" vira "...ns" (Item → Itens); em
// "r"/"z"/"s" vira "+es" (Contrato → Contratos já cai no caso de vogal, mas
// "Lugar" → "Lugares"). Não é um pluralizador geral da língua — é
// deliberadamente simples, com o padrão "+s" cobrindo a esmagadora maioria
// dos nomes que alguém digitaria aqui.
function pluralize(word: string): string {
  if (/m$/i.test(word)) return `${word.slice(0, -1)}ns`
  if (/[rz]$/i.test(word)) return `${word}es`
  if (/s$/i.test(word)) return word
  return `${word}s`
}

/** Como este produto chama as próprias unidades — "Sub produto" quando o
 *  produto não personalizou (ou quando `product` é null/undefined, ex.:
 *  contexto ainda não carregado). `plural: true` pluraliza; `lower: true`
 *  deixa minúsculo (pra encaixar no meio de uma frase, ex. "3 turma(s)"). */
export function subItemLabel(
  product: Pick<Product, 'sub_item_label'> | null | undefined,
  options?: { plural?: boolean; lower?: boolean },
): string {
  const base = product?.sub_item_label?.trim() || DEFAULT_SUB_ITEM_LABEL
  const text = options?.plural ? pluralize(base) : base
  return options?.lower ? text.toLowerCase() : text
}
