// As Edge Functions são publicadas uma a uma, então cada uma precisa carregar
// o próprio arquivo. A fonte da verdade é supabase/functions/_shared/;
// este script copia para dentro de cada função que usa.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'supabase/functions/_shared/providers.ts')
const targets = ['ai-insights', 'admin-settings']

const header = `// GERADO por scripts/sync-edge-shared.mjs — edite supabase/functions/_shared/providers.ts\n`
const content = header + readFileSync(source, 'utf-8')

for (const fn of targets) {
  const destination = resolve(root, 'supabase/functions', fn, 'providers.ts')
  writeFileSync(destination, content)
  console.log(`sincronizado → supabase/functions/${fn}/providers.ts`)
}
