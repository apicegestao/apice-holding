import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. Copie .env.example para .env.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/** Chama uma Edge Function já com o token do usuário logado. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    // O corpo de erro da função traz a mensagem em português; o SDK só expõe o status.
    let message = error.message
    const response = (error as { context?: Response }).context
    if (response && typeof response.json === 'function') {
      try {
        const parsed = await response.json()
        if (parsed?.error) message = parsed.error
      } catch {
        // mantém a mensagem original
      }
    }
    throw new Error(message)
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }

  return data as T
}
