// Integrações: conecta uma API externa e joga o resultado direto nos KPIs.
// O segredo de autenticação é gravado numa tabela sem policy de SELECT —
// nem o admin lê de volta pelo navegador.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Cable, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { supabase, callFunction } from '../../core/lib/supabase'
import { formatDateTime } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useToast,
} from '../../core/ui'
import type { Integration, IntegrationMapping, IntegrationRun, Kpi } from '../../core/types'

const PERIOD_LABEL: Record<string, string> = {
  current_day: 'Dia atual',
  current_week: 'Semana atual',
  current_month: 'Mês atual',
  current_quarter: 'Trimestre atual',
  current_year: 'Ano atual',
}

const INTERVALS = [
  { value: 0, label: 'Só manual' },
  { value: 60, label: 'A cada hora' },
  { value: 360, label: 'A cada 6 horas' },
  { value: 720, label: 'A cada 12 horas' },
  { value: 1440, label: 'Uma vez por dia' },
]

const emptyForm = {
  name: '',
  base_url: '',
  http_method: 'GET' as 'GET' | 'POST',
  auth_type: 'none' as Integration['auth_type'],
  auth_header: 'Authorization',
  auth_value: '',
  headers: '{}',
  request_body: '',
  sync_interval_minutes: 0,
  is_active: true,
}

function statusTone(status: Integration['last_status']) {
  if (status === 'success') return 'green'
  if (status === 'error') return 'red'
  if (status === 'running') return 'blue'
  return 'slate'
}

export default function IntegrationsPage() {
  const { company, isAdmin } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()

  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [mappings, setMappings] = useState<IntegrationMapping[]>([])
  const [runs, setRuns] = useState<IntegrationRun[]>([])
  const [kpis, setKpis] = useState<Kpi[]>([])
  const [loading, setLoading] = useState(true)

  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Integration | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Integration | null>(null)
  const [mappingFor, setMappingFor] = useState<Integration | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [integrationResult, mappingResult, runResult, kpiResult] = await Promise.all([
      supabase.from('integrations').select('*').eq('company_id', company.id).order('name'),
      supabase.from('integration_mappings').select('*').eq('company_id', company.id),
      supabase
        .from('integration_runs')
        .select('*')
        .eq('company_id', company.id)
        .order('started_at', { ascending: false })
        .limit(20),
      supabase.from('kpis').select('*').eq('company_id', company.id).eq('is_active', true),
    ])

    setIntegrations((integrationResult.data as Integration[]) ?? [])
    setMappings((mappingResult.data as IntegrationMapping[]) ?? [])
    setRuns((runResult.data as IntegrationRun[]) ?? [])
    setKpis((kpiResult.data as Kpi[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setForm(emptyForm)
    setError('')
    setCreating(true)
  }

  const openEdit = (integration: Integration) => {
    setForm({
      name: integration.name,
      base_url: integration.base_url,
      http_method: integration.http_method,
      auth_type: integration.auth_type,
      auth_header: integration.auth_header,
      auth_value: '',
      headers: JSON.stringify(integration.headers ?? {}, null, 2),
      request_body: integration.request_body ? JSON.stringify(integration.request_body, null, 2) : '',
      sync_interval_minutes: integration.sync_interval_minutes,
      is_active: integration.is_active,
    })
    setError('')
    setEditing(integration)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    let headers: Record<string, string> = {}
    let requestBody: unknown = null
    try {
      headers = form.headers.trim() ? JSON.parse(form.headers) : {}
    } catch {
      setError('Os cabeçalhos precisam ser um JSON válido.')
      return
    }
    if (form.http_method === 'POST' && form.request_body.trim()) {
      try {
        requestBody = JSON.parse(form.request_body)
      } catch {
        setError('O corpo da requisição precisa ser um JSON válido.')
        return
      }
    }

    const payload = {
      company_id: company.id,
      name: form.name.trim(),
      base_url: form.base_url.trim(),
      http_method: form.http_method,
      auth_type: form.auth_type,
      auth_header: form.auth_header.trim() || 'Authorization',
      headers,
      request_body: requestBody,
      sync_interval_minutes: Number(form.sync_interval_minutes) || 0,
      is_active: form.is_active,
      ...(editing ? {} : { created_by: profile?.id ?? null }),
    }

    if (!payload.name || !payload.base_url) {
      setError('Nome e URL são obrigatórios.')
      return
    }

    setBusy(true)
    const result = editing
      ? await supabase.from('integrations').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('integrations').insert(payload).select().single()

    if (result.error || !result.data) {
      setBusy(false)
      setError(
        result.error?.code === '23505'
          ? 'Já existe uma integração com esse nome nesta empresa.'
          : (result.error?.message ?? 'Falhou.'),
      )
      return
    }

    // A credencial só é gravada quando o admin digita uma nova.
    if (form.auth_type !== 'none' && form.auth_value.trim()) {
      const { error: secretError } = await supabase.from('integration_secrets').upsert(
        {
          integration_id: result.data.id,
          company_id: company.id,
          auth_value: form.auth_value.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'integration_id' },
      )
      if (secretError) {
        setBusy(false)
        setError(`Integração salva, mas a credencial não: ${secretError.message}`)
        return
      }
    }

    setBusy(false)
    notify(editing ? 'Integração atualizada.' : 'Integração criada.')
    setCreating(false)
    setEditing(null)
    await load()
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('integrations').delete().eq('id', removing.id)
    setBusy(false)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Integração excluída.')
    setRemoving(null)
    await load()
  }

  const syncNow = async (integration: Integration) => {
    setSyncing(integration.id)
    try {
      const result = await callFunction<{ status: string; records: number; error: string | null }>(
        'integrations-sync',
        { integration_id: integration.id },
      )
      if (result.status === 'success') {
        notify(`${result.records} valor(es) atualizado(s).`)
      } else {
        notify(result.error ?? 'A sincronização falhou.', 'error')
      }
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setSyncing(null)
    }
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Área restrita"
        description="Só administradores desta empresa configuram integrações."
      />
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`Integrações · ${company.name}`}
        subtitle="Puxe números de outros sistemas por API e alimente os KPIs automaticamente."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nova integração
          </button>
        }
      />

      {loading ? (
        <Loading />
      ) : integrations.length === 0 ? (
        <EmptyState
          title="Nenhuma integração configurada"
          description="Aponte uma URL que devolva JSON, escolha qual campo alimenta qual KPI e o sistema cuida do resto."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nova integração
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {integrations.map((integration) => {
            const links = mappings.filter((item) => item.integration_id === integration.id)
            return (
              <Card key={integration.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Cable className="h-4 w-4 text-slate-400" />
                      <h3 className="text-sm font-semibold text-ink-900">{integration.name}</h3>
                      <Badge tone={statusTone(integration.last_status)}>
                        {integration.last_status === 'idle' ? 'nunca rodou' : integration.last_status}
                      </Badge>
                      {!integration.is_active && <Badge tone="amber">pausada</Badge>}
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">
                      {integration.http_method} {integration.base_url}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {integration.sync_interval_minutes
                        ? `Sincroniza a cada ${integration.sync_interval_minutes} min`
                        : 'Sincronização manual'}
                      {integration.last_run_at && <> · última: {formatDateTime(integration.last_run_at)}</>}
                    </p>
                    {integration.last_error && (
                      <p className="mt-1 text-xs text-rose-600">{integration.last_error}</p>
                    )}
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn-ghost py-1.5"
                      disabled={syncing === integration.id}
                      onClick={() => void syncNow(integration)}
                    >
                      {syncing === integration.id ? (
                        <Spinner />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Sincronizar
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => openEdit(integration)}
                      aria-label="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => setRemoving(integration)}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Campos ligados a KPIs
                    </p>
                    <button
                      type="button"
                      className="text-xs text-brand-600 hover:underline"
                      onClick={() => setMappingFor(integration)}
                    >
                      configurar
                    </button>
                  </div>
                  {links.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Nenhum campo mapeado — a integração ainda não alimenta nada.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {links.map((mapping) => (
                        <li key={mapping.id} className="text-xs text-slate-600">
                          <code className="rounded bg-slate-100 px-1">{mapping.json_path}</code>
                          {' → '}
                          {kpis.find((kpi) => kpi.id === mapping.kpi_id)?.name ?? 'KPI removido'}
                          {' · '}
                          {PERIOD_LABEL[mapping.period_mode]}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {runs.length > 0 && (
        <Card title="Execuções recentes">
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2">Quando</th>
                <th className="py-2">Integração</th>
                <th className="py-2">Origem</th>
                <th className="py-2">Situação</th>
                <th className="py-2">Registros</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-slate-50">
                  <td className="py-2 text-xs">{formatDateTime(run.started_at)}</td>
                  <td className="py-2 text-xs">
                    {integrations.find((item) => item.id === run.integration_id)?.name ?? '—'}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {run.trigger_source === 'cron' ? 'agendada' : 'manual'}
                  </td>
                  <td className="py-2">
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </td>
                  <td className="py-2 text-xs">{run.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------- formulário */}
      <Modal
        open={creating || Boolean(editing)}
        title={editing ? `Editar ${editing.name}` : 'Nova integração'}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCreating(false)
                setEditing(null)
              }}
            >
              Cancelar
            </button>
            <button type="submit" form="integration-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {editing ? 'Salvar' : 'Criar'}
            </button>
          </>
        }
      >
        <form id="integration-form" onSubmit={submit} className="space-y-4">
          <Field label="Nome">
            <input
              className="input"
              required
              placeholder="ERP — faturamento"
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>
          <Field label="URL da API" hint="Precisa devolver JSON.">
            <input
              className="input"
              required
              type="url"
              placeholder="https://api.seusistema.com/v1/faturamento"
              value={form.base_url}
              onChange={(event) => setForm((c) => ({ ...c, base_url: event.target.value }))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Método">
              <select
                className="input"
                value={form.http_method}
                onChange={(event) =>
                  setForm((c) => ({ ...c, http_method: event.target.value as 'GET' | 'POST' }))
                }
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </Field>
            <Field label="Frequência">
              <select
                className="input"
                value={form.sync_interval_minutes}
                onChange={(event) =>
                  setForm((c) => ({ ...c, sync_interval_minutes: Number(event.target.value) }))
                }
              >
                {INTERVALS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Autenticação">
              <select
                className="input"
                value={form.auth_type}
                onChange={(event) =>
                  setForm((c) => ({ ...c, auth_type: event.target.value as Integration['auth_type'] }))
                }
              >
                <option value="none">Nenhuma</option>
                <option value="bearer">Bearer token</option>
                <option value="api_key">Chave em cabeçalho</option>
                <option value="basic">Basic (usuário:senha)</option>
              </select>
            </Field>
            {form.auth_type === 'api_key' && (
              <Field label="Nome do cabeçalho">
                <input
                  className="input"
                  value={form.auth_header}
                  onChange={(event) => setForm((c) => ({ ...c, auth_header: event.target.value }))}
                  placeholder="X-Api-Key"
                />
              </Field>
            )}
          </div>

          {form.auth_type !== 'none' && (
            <Field
              label="Credencial"
              hint={
                editing
                  ? 'Em branco mantém a credencial atual. Ela nunca é exibida de volta.'
                  : 'Guardada com acesso restrito ao servidor.'
              }
            >
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={form.auth_value}
                onChange={(event) => setForm((c) => ({ ...c, auth_value: event.target.value }))}
              />
            </Field>
          )}

          <Field label="Cabeçalhos extras (JSON)">
            <textarea
              className="input min-h-16 font-mono text-xs"
              value={form.headers}
              onChange={(event) => setForm((c) => ({ ...c, headers: event.target.value }))}
            />
          </Field>

          {form.http_method === 'POST' && (
            <Field label="Corpo da requisição (JSON)">
              <textarea
                className="input min-h-20 font-mono text-xs"
                value={form.request_body}
                onChange={(event) => setForm((c) => ({ ...c, request_body: event.target.value }))}
              />
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm((c) => ({ ...c, is_active: event.target.checked }))}
            />
            Integração ativa
          </label>

          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Modal>

      {mappingFor && (
        <MappingModal
          integration={mappingFor}
          kpis={kpis}
          mappings={mappings.filter((item) => item.integration_id === mappingFor.id)}
          onClose={() => setMappingFor(null)}
          onChanged={load}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Excluir integração"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{removing?.name}</strong> remove os mapeamentos e o histórico de
            execuções. Os valores já gravados nos KPIs permanecem.
          </>
        }
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

// -------------------------------------------------------------- mapeamentos
function MappingModal({
  integration,
  kpis,
  mappings,
  onClose,
  onChanged,
}: {
  integration: Integration
  kpis: Kpi[]
  mappings: IntegrationMapping[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { notify } = useToast()
  const [kpiId, setKpiId] = useState(kpis[0]?.id ?? '')
  const [jsonPath, setJsonPath] = useState('')
  const [multiplier, setMultiplier] = useState('1')
  const [periodMode, setPeriodMode] = useState('current_month')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!kpiId || !jsonPath.trim()) {
      notify('Escolha o KPI e informe o caminho do campo.', 'error')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('integration_mappings').insert({
      integration_id: integration.id,
      company_id: integration.company_id,
      kpi_id: kpiId,
      json_path: jsonPath.trim(),
      multiplier: Number(multiplier) || 1,
      period_mode: periodMode,
    })
    setBusy(false)

    if (error) {
      notify(error.message, 'error')
      return
    }
    setJsonPath('')
    await onChanged()
    notify('Campo mapeado.')
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('integration_mappings').delete().eq('id', id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    await onChanged()
  }

  return (
    <Modal
      open
      title={`Campos · ${integration.name}`}
      description="Diga qual pedaço da resposta JSON vira valor de qual KPI."
      onClose={onClose}
      footer={
        <button type="button" className="btn-ghost" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <div className="space-y-4">
        {mappings.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {mappings.map((mapping) => (
              <li key={mapping.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 text-xs">
                  <code className="rounded bg-slate-100 px-1">{mapping.json_path}</code> →{' '}
                  {kpis.find((kpi) => kpi.id === mapping.kpi_id)?.name ?? 'KPI removido'}
                  <span className="block text-slate-400">
                    {PERIOD_LABEL[mapping.period_mode]}
                    {Number(mapping.multiplier) !== 1 && ` · ×${mapping.multiplier}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => void remove(mapping.id)}
                  aria-label="Remover"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {kpis.length === 0 ? (
          <p className="text-sm text-slate-500">
            Cadastre pelo menos um KPI nesta empresa para poder mapear campos.
          </p>
        ) : (
          <div className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
            <Field label="KPI que recebe o valor">
              <select className="input" value={kpiId} onChange={(event) => setKpiId(event.target.value)}>
                {kpis.map((kpi) => (
                  <option key={kpi.id} value={kpi.id}>
                    {kpi.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Caminho no JSON"
              hint='Use ponto e colchete, como em "dados.totais[0].receita".'
            >
              <input
                className="input font-mono text-xs"
                value={jsonPath}
                onChange={(event) => setJsonPath(event.target.value)}
                placeholder="dados.faturamento_mes"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Multiplicador" hint="Ex.: 0.01 para converter centavos.">
                <input
                  className="input"
                  type="number"
                  step="any"
                  value={multiplier}
                  onChange={(event) => setMultiplier(event.target.value)}
                />
              </Field>
              <Field label="Período do lançamento">
                <select
                  className="input"
                  value={periodMode}
                  onChange={(event) => setPeriodMode(event.target.value)}
                >
                  {Object.entries(PERIOD_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void add()}>
              {busy && <Spinner />}
              Adicionar mapeamento
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
