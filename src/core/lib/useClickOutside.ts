// Fecha qualquer menu/dropdown ao clicar fora dele — mesmo padrão usado em
// todos os menus suspensos do sistema (notificações, perfil, seletor de
// empresa), para que o comportamento seja sempre o mesmo em qualquer lugar.
import { useEffect, type RefObject } from 'react'

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!active) return
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
    }
    // mousedown (não click) para fechar antes do próximo clique disparar,
    // evitando reabrir o menu ao tocar de novo no próprio botão.
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [active, ref, onOutside])
}
