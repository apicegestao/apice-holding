// Marca da Ápice. O arquivo vive em /public/logo-apice.svg — trocar aquele
// arquivo pelo oficial atualiza login, cabeçalho e qualquer outro uso.
// A marca é escura, então vai sempre dentro de uma moldura branca: assim ela
// se destaca tanto de um fundo claro quanto de um escuro.
export function Logo({
  size = 32,
  withWordmark = false,
  subtitle,
  className = '',
  tone = 'dark',
  framed = true,
}: {
  size?: number
  withWordmark?: boolean
  subtitle?: string
  className?: string
  tone?: 'dark' | 'light'
  framed?: boolean
}) {
  const wordColor = tone === 'light' ? 'text-white' : 'text-ink-900'
  const subColor = tone === 'light' ? 'text-slate-400' : 'text-slate-500'
  const padding = Math.max(4, Math.round(size * 0.16))

  const mark = (
    <img
      src="/logo-apice.svg"
      alt="Ápice"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="block object-contain"
    />
  )

  return (
    <span className={`flex items-center gap-3 ${className}`}>
      {framed ? (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm"
          style={{ padding }}
        >
          {mark}
        </span>
      ) : (
        <span className="shrink-0">{mark}</span>
      )}
      {withWordmark && (
        <span className="leading-tight">
          <span className={`block text-sm font-semibold ${wordColor}`}>Ápice Holding</span>
          {subtitle && <span className={`block text-[11px] ${subColor}`}>{subtitle}</span>}
        </span>
      )}
    </span>
  )
}
