// GERADO por scripts/sync-edge-shared.mjs — edite supabase/functions/_shared/providers.ts
// Camada fina sobre os dois provedores de IA. Nenhum ID de modelo fica
// fixo no código: a lista vem da própria API do provedor, então nada quebra
// quando eles lançam ou aposentam um modelo.

export type Provider = 'gemini' | 'anthropic'

export type ModelOption = { id: string; label: string }

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'

/** Modelos que servem para gerar texto — fora embeddings, imagem, áudio etc. */
function usableGeminiModel(model: {
  name: string
  supportedGenerationMethods?: string[]
}): boolean {
  if (!model.supportedGenerationMethods?.includes('generateContent')) return false
  const id = model.name.replace('models/', '')
  return !/embedding|aqa|imagen|image|veo|tts|audio|live|vision/i.test(id)
}

export async function listModels(provider: Provider, apiKey: string): Promise<ModelOption[]> {
  if (provider === 'gemini') {
    const response = await fetch(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
    })
    if (!response.ok) {
      throw new Error(`Não consegui listar os modelos do Gemini (HTTP ${response.status}).`)
    }
    const body = await response.json()
    return (body.models ?? [])
      .filter(usableGeminiModel)
      .map((model: { name: string; displayName?: string }) => ({
        id: model.name.replace('models/', ''),
        label: model.displayName || model.name.replace('models/', ''),
      }))
  }

  const response = await fetch(`${ANTHROPIC_BASE}/models?limit=100`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  })
  if (!response.ok) {
    throw new Error(`Não consegui listar os modelos da Anthropic (HTTP ${response.status}).`)
  }
  const body = await response.json()
  return (body.data ?? []).map((model: { id: string; display_name?: string }) => ({
    id: model.id,
    label: model.display_name || model.id,
  }))
}

/** Versão embutida no id, para escolher o mais novo sem depender de memória. */
function versionOf(id: string): number {
  const match = id.match(/(\d+(?:[.-]\d+)?)/)
  if (!match) return 0
  return Number(match[1].replace('-', '.')) || 0
}

export function pickDefaultModel(provider: Provider, models: ModelOption[]): string | null {
  if (!models.length) return null

  if (provider === 'anthropic') {
    const opus = models.find((model) => model.id === 'claude-opus-5')
    if (opus) return opus.id
  }

  const stable = models.filter((model) => !/preview|exp|beta|latest|lite/i.test(model.id))
  const pool = stable.length ? stable : models

  // Entre os estáveis, o "flash" mais novo equilibra custo e qualidade;
  // se não houver flash, cai no mais novo da lista.
  const scored = pool
    .map((model) => ({
      model,
      version: versionOf(model.id),
      flash: /flash|haiku/i.test(model.id) ? 1 : 0,
    }))
    .sort((a, b) => b.version - a.version || b.flash - a.flash)

  return scored[0]?.model.id ?? null
}

export async function generateText(
  provider: Provider,
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (provider === 'gemini') {
    const response = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Gemini respondeu ${response.status}: ${detail.slice(0, 300)}`)
    }

    const body = await response.json()
    const candidate = body.candidates?.[0]
    const text = (candidate?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? '')
      .join('')
    if (!text) {
      throw new Error(
        candidate?.finishReason
          ? `O Gemini encerrou sem texto (${candidate.finishReason}).`
          : 'O Gemini não devolveu conteúdo.',
      )
    }
    return text
  }

  const response = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Anthropic respondeu ${response.status}: ${detail.slice(0, 300)}`)
  }

  const body = await response.json()
  const text = (body.content ?? [])
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('\n')
  if (!text) throw new Error('A Anthropic não devolveu conteúdo.')
  return text
}
