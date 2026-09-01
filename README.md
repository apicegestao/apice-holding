# Ápice Holding

Sistema central de gestão do grupo. Uma aba por empresa, cada uma com painel,
KPIs, metas, tarefas e mapa mental próprios — e um painel consolidado da holding
por cima de tudo.

Projeto **isolado** do `time-de-especialistas`: repositório, projeto Supabase,
site Netlify e variáveis de ambiente próprios. Nada é compartilhado entre os dois.

## Stack

| Camada | Escolha |
| --- | --- |
| Front-end | React 18 + TypeScript + Vite + Tailwind + Recharts |
| Banco | Supabase PostgreSQL com RLS por empresa |
| Auth | Supabase Auth (e-mail + senha, senha padrão trocada no 1º acesso) |
| Back-end | Supabase Edge Functions (Deno) |
| Agendamento | pg_cron + pg_net no próprio banco |
| IA | Gemini (Google) por padrão, Claude (Anthropic) como alternativa |
| Hospedagem | Netlify (SPA estática) |

Projeto Supabase: `apice-holding` (`hhlxazpqonkfcgrcmzpp`, região `sa-east-1`).

## O isolamento entre empresas

Esta é a regra que sustenta o resto: **um usuário da empresa X não vê nem altera
nada da empresa Y**. Ela não depende do front-end.

- Toda tabela de módulo carrega `company_id` e tem RLS ligada.
- As policies chamam funções `SECURITY DEFINER` no schema `app`
  (`is_member`, `can_write`, `is_company_admin`, `is_super_admin`), então não há
  recursão de RLS ao consultar vínculos.
- A view `kpi_latest_values` é `security_invoker`, e a RPC `company_snapshots()`
  é `SECURITY INVOKER` — o consolidado da holding só devolve as empresas que
  aquele usuário já poderia ver uma a uma.
- `profiles` tem `GRANT UPDATE` **por coluna**: o usuário edita nome, telefone e
  cargo, mas `is_super_admin`, `is_active` e `email` só mudam pelo service_role.
  Um trigger repete a checagem.
- Credenciais de integração vivem em `integration_secrets`, que **não tem policy
  de SELECT**: nem o admin lê de volta pelo navegador; só a Edge Function.

Os testes de isolamento estão descritos em [`docs/verificacao.md`](docs/verificacao.md).

## Quem enxerga cada tarefa

Tarefa não é automaticamente da empresa. Ao criar, escolhe-se uma das três:

| Modo | Quem vê |
| --- | --- |
| **Só minha** (padrão) | O criador e o responsável. Nem o admin da holding enxerga. |
| **Da empresa** | Todos que têm acesso àquela empresa. |
| **Compartilhada** | Só quem for escolhido: uma ou várias empresas, e/ou pessoas específicas. |

Isso é garantido pela RLS, não pela tela. Um usuário só compartilha com empresas
das quais ele participa e com pessoas com quem já divide alguma empresa. O quadro
de uma empresa mostra as tarefas dela **e** as que outras empresas compartilharam
com ela; o painel da holding reúne todas as tarefas do usuário, em todas as
empresas, inclusive as privadas dele.

## Papéis

| Papel | O que faz |
| --- | --- |
| **Admin da holding** (`profiles.is_super_admin`) | Enxerga e administra todas as empresas, cria empresas, gerencia usuários e configurações |
| **Admin** (por empresa) | Configura a empresa, gerencia acessos, integrações e insights |
| **Colaborador** | Lança KPIs, cria metas e tarefas, edita o mapa mental |
| **Usuário** | Só visualiza — e conclui as tarefas atribuídas a ele |

## Primeiro acesso

1. O admin cadastra o e-mail da pessoa em **Usuários → Novo acesso**.
2. O sistema cria o login com a **senha padrão** (configurável em
   Holding → Configurações) e a mostra uma única vez para o admin repassar.
3. No primeiro login o sistema bloqueia tudo até a troca da senha.
4. Esqueceu a senha? O admin usa **Resetar senha** — volta para a padrão e a
   troca é exigida de novo. O admin da holding também inativa ou exclui cadastros.

## Módulos

```
src/
  app/                 casca: rotas, layout com as abas de empresa, login, troca de senha
  core/
    auth/              sessão, perfil e vínculos com empresas
    company/           escopo da empresa ativa (tudo sob /empresa/:companyId)
    lib/               cliente Supabase, formatação, períodos
    ui/                kit compartilhado (Card, Modal, Toast, ConfirmDialog…)
    types.ts           tipos do domínio — fonte única de verdade
  modules/
    companies/         cadastro das empresas e os dados de cada uma
    dashboard/         painel da empresa e painel consolidado da holding
    kpis/              KPIs, lançamento por período e histórico. O "Novo KPI"
                       abre em sugestões prontas (várias de uma vez) e mantém
                       a aba de criar um indicador próprio
    goals/             metas, com ligação opcional a um KPI
    tasks/             tarefas: quem, o quê, prazo e lembrete
    mindmap/           mapa mental arrastável; nó vira tarefa
    integrations/      conectores REST e mapeamento campo → KPI
    insights/          insights gerados por IA
    users/             acessos por empresa e do grupo
    settings/          configurações da holding
    audit/             trilha de auditoria
```

Cada módulo é uma pasta fechada: mexer em Tarefas não obriga a abrir KPIs.

## Edge Functions

| Função | JWT | O que faz |
| --- | --- | --- |
| `admin-users` | sim | cria acesso com senha padrão, reseta senha, muda papel, inativa e exclui cadastro |
| `admin-settings` | sim | lê e grava as configurações da holding (chave da IA mascarada na leitura) |
| `ai-insights` | sim | monta o retrato de KPIs/metas/tarefas e pede insights ao provedor configurado |
| `integrations-sync` | não | sincroniza integrações; autentica por JWT (manual) ou header assinado (cron) |

`integrations-sync` roda sem `verify_jwt` porque o pg_cron não tem JWT — a
autorização é feita dentro da função, comparando `x-sync-secret` com um segredo
gerado no banco.

## Agendamentos (pg_cron)

| Job | Frequência | O que faz |
| --- | --- | --- |
| `apice_task_reminders` | a cada 5 min | transforma lembretes vencidos em notificação para o responsável |
| `apice_integrations_sync` | a cada 5 min | chama `integrations-sync` para as integrações que já venceram o intervalo |

## Inteligência artificial

O provedor é escolhido em Holding → Configurações; o padrão é o **Gemini**.

Nenhum identificador de modelo fica fixo no código. A tela busca a lista de
modelos na API do próprio provedor, e quando nenhum está escolhido a Edge
Function pergunta a lista e grava a escolha na primeira geração. Assim nada
quebra quando um modelo é lançado ou aposentado.

O código dos provedores mora em `supabase/functions/_shared/providers.ts`.
Cada Edge Function é publicada sozinha, então rode `npm run sync:functions`
depois de editar esse arquivo — ele copia para dentro de cada função.

## A marca

Todo o sistema aponta para `public/logo-apice.svg` — trocar esse arquivo,
mantendo o nome, atualiza login, cabeçalho e favicon de uma vez.

A marca é escura, então o componente `Logo` a envolve numa moldura branca com
borda fina: assim ela se destaca tanto do cabeçalho claro quanto de um fundo
escuro. O cabeçalho e o painel do login são claros pelo mesmo motivo.

## Integrações com outros sistemas

Cadastre a URL que devolve JSON, o método, a autenticação (Bearer, chave em
cabeçalho ou Basic) e a frequência. Depois mapeie cada campo:

```
dados.faturamento_mes  →  KPI "Faturamento"  ·  mês atual  ·  ×1
```

O caminho aceita ponto e colchete (`dados.totais[0].receita`). O valor vira um
lançamento do KPI no período escolhido, e o histórico de execuções fica visível
na própria tela.

## Celular

O sistema é usado no celular tanto quanto no computador. Todas as rotas são
auditadas a 390 px de largura: nenhuma pode gerar rolagem horizontal da página.
Tabelas largas rolam dentro do próprio cartão (`overflow-x-auto` + `min-w`),
o quadro de tarefas empilha as colunas e esconde as vazias, e o canvas do mapa
mental encurta. O roteiro de verificação está em `docs/verificacao.md`.

## Rodando localmente

```bash
cp .env.example .env     # preencha a URL e a publishable key do projeto
npm install
npm run dev
```

Scripts: `npm run build` (typecheck + build), `npm run typecheck`, `npm run test`.

## Banco de dados

As migrations em `supabase/migrations/` são a ordem de instalação. Num projeto
novo, aplique-as em sequência e depois rode `supabase/seed/bootstrap.sql`, que
cria o primeiro admin da holding e a empresa controladora.

## Deploy (Netlify)

Site **novo e separado** do `time-de-especialistas`:
[`apice-holding`](https://app.netlify.com/projects/apice-holding) →
https://apice-holding.netlify.app

Já configurado: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas variáveis de
ambiente, e o acesso ao site liberado (a autenticação do próprio sistema é a
porta, não o login de time do Netlify). O build e o publish saem do
`netlify.toml`.

Falta apenas ligar o site a este repositório, o que dá o deploy contínuo a cada
push: **Project configuration → Build & deploy → Link repository → GitHub →
`apicegestao/apice-holding`**, branch `main`.

## Pendências conhecidas

- **Proteção contra senha vazada** (HaveIBeenPwned) está desligada no Supabase
  Auth. Ligue em Authentication → Policies do projeto `apice-holding`.
- **Lembrete por e-mail**: hoje o lembrete vira notificação dentro do sistema.
  Enviar e-mail exige um provedor (Resend/SES) e uma Edge Function extra.
- **Chave da Anthropic**: os insights só funcionam depois de salvá-la em
  Holding → Configurações.
- **Deploy contínuo**: o site do Netlify existe e está configurado, mas ainda
  não está ligado a este repositório (ver a seção de Deploy).
