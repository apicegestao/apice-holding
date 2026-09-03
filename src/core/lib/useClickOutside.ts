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
    // Esc também fecha — sem isso, quem navega só pelo teclado (sem mouse
    // pra clicar fora) não tinha nenhuma forma de fechar o menu, diferente
    // de todo <Modal> do sistema, que já fecha com Esc.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOutside()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, ref, onOutside])
}
