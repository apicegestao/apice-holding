// Rede de segurança pro app inteiro: sem isto, qualquer erro não tratado
// durante a renderização (ex. um dado com formato inesperado vindo do banco)
// derruba a árvore do React inteira e deixa a tela em branco, sem nenhuma
// forma de sair a não ser recarregar a página na unha — exatamente o
// "trava e preciso atualizar a página" que motivou este componente. Com o
// boundary, o mesmo erro mostra uma tela de recuperação em vez de travar.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Erro não tratado na interface:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-app p-6">
          <div className="card max-w-md p-6 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <h1 className="mt-3 text-sm font-semibold text-content">Algo deu errado por aqui</h1>
            <p className="mt-1.5 text-xs text-content-soft">
              Essa tela travou de verdade e recarregar é a forma mais rápida de continuar. Se
              acontecer de novo no mesmo lugar, avise o time — isso ajuda a encontrar a causa.
            </p>
            <button
              type="button"
              className="btn-primary mt-4 w-full justify-center"
              onClick={() => window.location.reload()}
            >
              Recarregar página
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
