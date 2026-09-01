// Marca da Ápice. O arquivo vive em /public/logo-apice.svg — trocar aquele
// arquivo pelo oficial atualiza login, cabeçalho e qualquer outro uso.
export function Logo({
  size = 32,
  withWordmark = false,
  subtitle,
  className = '',
  tone = 'dark',
}: {
  size?: number
  withWordmark?: boolean
  subtitle?: string
  className?: string
  tone?: 'dark' | 'light'
}) {
  const wordColor = tone === 'light' ? 'text-white' : 'text-ink-900'
  const subColor = tone === 'light' ? 'text-slate-400' : 'text-slate-500'

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <img
        src="/logo-apice.svg"
        alt="Ápice"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 object-contain"
      />
      {withWordmark && (
        <span className="leading-tight">
          <span className={`block text-sm font-semibold ${wordColor}`}>Ápice Holding</span>
          {subtitle && <span className={`block text-[11px] ${subColor}`}>{subtitle}</span>}
        </span>
      )}
    </span>
  )
}
