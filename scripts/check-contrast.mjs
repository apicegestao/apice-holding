// Confere o contraste de cada par de cor dos dois temas contra a WCAG.
// Rodar sempre que um token de cor mudar: "npm run check:contrast".
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(import.meta.dirname, '../src/index.css'), 'utf-8')

function readTokens(selector) {
  const block = css.split(selector)[1]?.split('}')[0] ?? ''
  const tokens = {}
  for (const match of block.matchAll(/--([\w-]+):\s*([\d]+)\s+([\d]+)\s+([\d]+)\s*;/g)) {
    tokens[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])]
  }
  return tokens
}

const channel = (value) => {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')

// [frente, fundo, mínimo exigido, para que serve]
const PAIRS = [
  ['text', 'surface', 4.5, 'texto principal no cartão'],
  ['text', 'app', 4.5, 'texto principal na página'],
  ['text', 'elevated', 4.5, 'texto em menu/modal'],
  ['text-muted', 'surface', 4.5, 'texto secundário no cartão'],
  ['text-muted', 'app', 4.5, 'texto secundário na página'],
  ['text-soft', 'surface', 4.5, 'rótulos e apoio'],
  ['text-soft', 'app', 4.5, 'rótulos na página'],
  ['text-faint', 'surface', 3, 'marca d’água, placeholder'],
  ['on-brand', 'brand', 4.5, 'texto do botão principal'],
  ['brand-text', 'surface', 4.5, 'link e destaque no cartão'],
  ['line-strong', 'surface', 1.6, 'borda de campo'],
  ['line', 'surface', 1.2, 'divisória'],
]

let failures = 0
for (const [theme, selector] of [['claro', ':root {'], ['escuro', ".dark {"]]) {
  const tokens = readTokens(selector)
  console.log(`\n── tema ${theme} ──`)
  for (const [front, back, min, purpose] of PAIRS) {
    if (!tokens[front] || !tokens[back]) {
      console.log(`  ?  ${front} / ${back} — token ausente`)
      failures += 1
      continue
    }
    const ratio = contrast(tokens[front], tokens[back])
    const ok = ratio >= min
    if (!ok) failures += 1
    console.log(
      `  ${ok ? '✓' : '✗'} ${ratio.toFixed(2).padStart(5)}:1  (mín ${min})  ` +
        `${hex(tokens[front])} sobre ${hex(tokens[back])}  — ${purpose}`,
    )
  }
}

console.log(failures === 0 ? '\nTodos os pares passam.' : `\n${failures} par(es) abaixo do mínimo.`)
process.exit(failures === 0 ? 0 : 1)
