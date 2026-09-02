// Marca da Ápice. O arquivo vive em /public/logo-apice.svg — trocar aquele
// arquivo pelo oficial atualiza login, cabeçalho e qualquer outro uso.
// A marca é transparente e usada sobre fundo claro. Em fundo escuro, passe
// framed para envolvê-la numa moldura branca.
export function Logo({
  size = 32,
  withWordmark = false,
  subtitle,
  className = '',
  tone = 'dark',
  framed = false,
}: {
  size?: number
  withWordmark?: boolean
  subtitle?: string
  className?: string
  tone?: 'dark' | 'light'
  framed?: boolean
}) {
  const wordColor = tone === 'light' ? 'text-white' : 'text-content'
  const subColor = tone === 'light' ? 'text-content-faint' : 'text-content-soft'
  const padding = Math.max(4, Math.round(size * 0.16))

  const mark = (
    <img
      src="/logo-apice.svg"
      alt="Ápice"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="block object-contain dark:[filter:brightness(1.45)_saturate(1.05)]"
    />
  )

  return (
    <span className={`flex items-center gap-3 ${className}`}>
      {framed ? (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-line bg-surface shadow-sm"
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
