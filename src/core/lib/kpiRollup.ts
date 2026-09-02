// Soma de metas em cadeia (turma → produto → empresa): um KPI com filhos
// nunca lança valor direto — o valor dele é sempre a soma dos filhos,
// recursiva (um filho pode, ele mesmo, ser soma de outros filhos ainda).
// Um lugar só pra essa conta — CompanyDashboard e ProductsPage calculam do
// mesmo jeito, cada um com os dados que já carregou pra tela dele.

export type RollupRow = {
  kpi_id: string
  value: number | null
  parent_kpi_id: string | null
}

export function buildChildrenByParent<T extends RollupRow>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    if (!row.parent_kpi_id) continue
    const list = map.get(row.parent_kpi_id) ?? []
    list.push(row)
    map.set(row.parent_kpi_id, list)
  }
  return map
}

/**
 * Valor de verdade de um KPI: soma dos filhos (recursivo) quando ele tem
 * filhos; senão, o próprio valor. `seen` é só proteção contra ciclo — o
 * banco (app.assert_kpi_parent) já impede formar um, mas o cliente não
 * precisa confiar cegamente nisso.
 */
export function effectiveKpiValue<T extends RollupRow>(
  kpiId: string,
  childrenByParent: Map<string, T[]>,
  rowById: Map<string, T>,
  seen: Set<string> = new Set(),
): number | null {
  if (seen.has(kpiId)) return null
  seen.add(kpiId)
  const children = childrenByParent.get(kpiId)
  if (children?.length) {
    let total = 0
    let any = false
    for (const child of children) {
      const value = effectiveKpiValue(child.kpi_id, childrenByParent, rowById, seen)
      if (value !== null) {
        total += value
        any = true
      }
    }
    return any ? total : null
  }
  return rowById.get(kpiId)?.value ?? null
}
