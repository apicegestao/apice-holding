// Configurações da holding: chave da IA, senha padrão e modelo usado.
import { useCallback, useEffect, useState } from 'react'
import { callFunction } from '../../core/lib/supabase'
import { Card, ErrorText, Field, Loading, PageHeader, Spinner, useToast } from '../../core/ui'

type Settings = Record<string, string | null>

const MODELS = [
  { value: 'claude-opus-5', label: 'Claude Opus 5 — leitura mais profunda' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 — mais barato e rápido' },
]

export default function SettingsPage() {
  const { notify } = useToast()
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [defaultPassword, setDefaultPassword] = useState('')
  const [model, setModel] = useState('claude-opus-5')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await callFunction<{ settings: Settings }>('admin-settings', { action: 'list' })
      setSettings(result.settings)
      setDefaultPassword(result.settings.default_password ?? '')
      setModel(result.settings.insights_model ?? 'claude-opus-5')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as configurações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (key: string, value: string) => {
    if (!value.trim()) {
      notify('Informe um valor.', 'error')
      return
    }
    setBusy(key)
    try {
      await callFunction('admin-settings', { action: 'set', key, value })
      notify('Configuração salva.')
      if (key === 'anthropic_api_key') setApiKey('')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Configurações da holding"
        subtitle="Valem para todas as empresas do grupo."
      />

      {error && <ErrorText>{error}</ErrorText>}

      <Card
        title="Inteligência artificial"
        description="Necessária para gerar os insights nos painéis."
      >
        <div className="space-y-4">
          <Field
            label="Chave da API Anthropic"
            hint={
              settings.anthropic_api_key
                ? `Chave configurada: ${settings.anthropic_api_key}. Preencha só se quiser trocar.`
                : 'Ainda não configurada — os insights ficam indisponíveis até você salvar uma chave.'
            }
          >
            <div className="flex gap-2">
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={busy === 'anthropic_api_key'}
                onClick={() => void save('anthropic_api_key', apiKey)}
              >
                {busy === 'anthropic_api_key' && <Spinner />}
                Salvar
              </button>
            </div>
          </Field>

          <Field label="Modelo usado nos insights">
            <div className="flex gap-2">
              <select
                className="input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {MODELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost shrink-0"
                disabled={busy === 'insights_model'}
                onClick={() => void save('insights_model', model)}
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
        <p className="mt-2 text-xs text-slate-500">
          O usuário é obrigado a trocar no primeiro login, então essa senha nunca fica valendo por
          muito tempo.
        </p>
      </Card>
    </div>
  )
}
