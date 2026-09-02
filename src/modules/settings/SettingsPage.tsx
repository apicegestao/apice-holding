// Configurações da holding: provedor de IA, chaves, modelo e a senha padrão.
// A lista de modelos vem da API do provedor, não de uma lista fixa aqui.
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { callFunction } from '../../core/lib/supabase'
import { Card, ErrorText, Field, Loading, PageHeader, Spinner, useToast } from '../../core/ui'

type Settings = Record<string, string | null>
type ModelOption = { id: string; label: string }
type Provider = 'gemini' | 'anthropic'

const PROVIDERS: { value: Provider; label: string; hint: string; keyName: string; placeholder: string }[] = [
  {
    value: 'gemini',
    label: 'Gemini (Google)',
    hint: 'Padrão do sistema. Chave gerada no Google AI Studio.',
    keyName: 'gemini_api_key',
    placeholder: 'AIza…',
  },
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    hint: 'Alternativa. Chave gerada no console da Anthropic.',
    keyName: 'anthropic_api_key',
    placeholder: 'sk-ant-…',
  },
]

export default function SettingsPage() {
  const { notify } = useToast()
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<ModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [defaultPassword, setDefaultPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const active = PROVIDERS.find((item) => item.value === provider)!

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await callFunction<{ settings: Settings }>('admin-settings', { action: 'list' })
      setSettings(result.settings)
      setProvider(result.settings.ai_provider === 'anthropic' ? 'anthropic' : 'gemini')
      setModel(result.settings.insights_model ?? '')
      setDefaultPassword(result.settings.default_password ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as configurações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (key: string, value: string, successMessage = 'Configuração salva.') => {
    if (!value.trim()) {
      notify('Informe um valor.', 'error')
      return false
    }
    setBusy(key)
    try {
      await callFunction('admin-settings', { action: 'set', key, value })
      notify(successMessage)
      if (key === active.keyName) setApiKey('')
      await load()
      return true
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
      return false
    } finally {
      setBusy(null)
    }
  }

  const fetchModels = async () => {
    setLoadingModels(true)
    setModels([])
    try {
      const result = await callFunction<{ models: ModelOption[] }>('admin-settings', {
        action: 'list_models',
        provider,
      })
      setModels(result.models)
      if (!result.models.length) notify('O provedor não devolveu modelos.', 'error')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setLoadingModels(false)
    }
  }

  if (loading) return <Loading />

  const keyConfigured = settings[active.keyName]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Configurações da holding"
        subtitle="Valem para todas as empresas do grupo."
      />

      {error && <ErrorText>{error}</ErrorText>}

      <Card
        title="Inteligência artificial"
        description="Usada para gerar os insights nos painéis."
      >
        <div className="space-y-4">
          <Field asGroup label="Provedor">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROVIDERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  disabled={busy === 'ai_provider'}
                  onClick={async () => {
                    if (item.value === provider) return
                    const ok = await save('ai_provider', item.value, `Provedor alterado para ${item.label}.`)
                    if (ok) {
                      setProvider(item.value)
                      setModels([])
                      setModel('')
                    }
                  }}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    provider === item.value
                      ? 'border-brand-500 bg-brand/10'
                      : 'border-line-strong hover:bg-hover'
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium text-content">
                    {provider === item.value && <Sparkles className="h-3.5 w-3.5 text-brand-text" />}
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-content-soft">{item.hint}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field
            label={`Chave da API — ${active.label}`}
            hint={
              keyConfigured
                ? `Chave configurada: ${keyConfigured}. Preencha só para trocar.`
                : 'Ainda não configurada — os insights ficam indisponíveis até você salvar uma chave.'
            }
          >
            <div className="flex gap-2">
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder={active.placeholder}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={busy === active.keyName}
                onClick={() => void save(active.keyName, apiKey)}
              >
                {busy === active.keyName && <Spinner />}
                Salvar
              </button>
            </div>
          </Field>

          <Field
            label="Modelo"
            hint={
              model
                ? 'Trocar aqui muda o modelo usado nos insights.'
                : 'Em branco, o sistema pergunta ao provedor qual usar na primeira geração.'
            }
          >
            <div className="flex gap-2">
              {models.length > 0 ? (
                <select
                  className="input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  <option value="">Escolher automaticamente</option>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} ({item.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={model}
                  placeholder="automático"
                  onChange={(event) => setModel(event.target.value)}
                />
              )}
              <button
                type="button"
                className="btn-ghost shrink-0"
                disabled={loadingModels || !keyConfigured}
                onClick={() => void fetchModels()}
                title={keyConfigured ? 'Buscar os modelos disponíveis' : 'Salve a chave primeiro'}
              >
                {loadingModels ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
                Buscar
              </button>
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={busy === 'insights_model'}
                onClick={() => void save('insights_model', model || ' ', 'Modelo atualizado.')}
              >
                {busy === 'insights_model' && <Spinner />}
                Salvar
              </button>
            </div>
          </Field>
        </div>
      </Card>

      <Card
        title="Senha padrão do primeiro acesso"
        description="É a senha entregue a cada novo usuário — e a que volta num reset."
      >
        <div className="flex gap-2">
          <input
            className="input"
            value={defaultPassword}
            onChange={(event) => setDefaultPassword(event.target.value)}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={busy === 'default_password'}
            onClick={() => void save('default_password', defaultPassword)}
          >
            {busy === 'default_password' && <Spinner />}
            Salvar
          </button>
        </div>
        <p className="mt-2 text-xs text-content-soft">
          O usuário é obrigado a trocar no primeiro login, então essa senha nunca fica valendo por
          muito tempo.
        </p>
      </Card>
    </div>
  )
}
