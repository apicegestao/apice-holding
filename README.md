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
    ui/                kit compartilhado (Card, Modal, Toast, ConfirmDialog,
                       ProgressBar, CardCarousel…)
    types.ts           tipos do domínio — fonte única de verdade
  modules/
    companies/         cadastro das empresas e os dados de cada uma
    dashboard/         painel da empresa e painel consolidado da holding —
                       "saúde geral" (atingimento médio dos KPIs com meta) em
                       destaque nos dois; no da holding, cada cartão de
                       empresa tem sua própria saúde geral, uma bolinha de
                       status (verde/âmbar/vermelho) e a ordem é por
                       urgência — quem tem tarefa vencida ou meta em risco
                       aparece primeiro, não em ordem de cadastro
    kpis/              KPIs e metas — a mesma coisa. O "Novo KPI" abre em
                       sugestões prontas (várias de uma vez) e mantém a aba de
                       criar um indicador próprio; com prazo, o próprio KPI
                       vira a meta (responsável notificado, andamento,
                       repartição do alvo por semana); barra de progresso
                       meta × realizado em todo cartão de KPI e no
                       "Lançar valor", que pede só uma data de referência —
                       a frequência do KPI já define o período; pode ligar o
                       KPI a um produto (e a uma edição dele), com filtro por
                       produto na lista
    tasks/             tarefas: quem, o quê, prazo e lembrete padrão (dias
                       antes + horário) — com subtarefas e notas editáveis
                       dentro da própria tarefa; quadro por empresa e um
                       consolidado de todo o grupo em /holding/tarefas; setas
                       de avançar/voltar em cada cartão do quadro, e marcar
                       como concluída direto dos painéis (sem abrir a tarefa);
                       pode ligar a tarefa a um produto
    products/          as frentes de produto/serviço de uma empresa (ex.:
                       "Entre Donos", "Imersão", "Mentoria", "Club" — caso
                       real que motivou o módulo). Frente recorrente cadastra
                       uma edição por turma/encontro; frente contínua roda
                       sem edição nenhuma. Cada produto mostra sua própria
                       saúde (atingimento dos KPIs daquela frente) e conta de
                       tarefas abertas — reflete no painel da empresa e, com
                       a contagem de produtos ativos, no painel da holding
    mindmap/           mapa mental arrastável, organograma, fluxo lógico ou
                       linha do tempo automático, ramifica pra qualquer
                       lado; nó vira tarefa e edita o texto nele mesmo;
                       editar um nó abre um botão/modal, não uma barra
                       lateral fixa — o canvas fica com o espaço todo
    budgets/           orçamento por evento/projeto: linhas de receita e
                       despesa (cotação → aprovado → pago/recebido, previsto
                       e realizado lado a lado), barra de execução da
                       despesa em cada cartão da lista, e projeção de caixa
                       por mês, por empresa e consolidado na holding
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
| `ai-insights` | sim | monta o retrato de KPIs/metas, tarefas, mapa mental, orçamentos e integrações, e pede insights ao provedor configurado |
| `integrations-sync` | não | sincroniza integrações; autentica por JWT (manual) ou header assinado (cron) |

`integrations-sync` roda sem `verify_jwt` porque o pg_cron não tem JWT — a
autorização é feita dentro da função, comparando `x-sync-secret` com um segredo
gerado no banco.

## Agendamentos (pg_cron)

| Job | Frequência | O que faz |
| --- | --- | --- |
| `apice_task_reminders` | a cada 5 min | dois lembretes automáticos por tarefa com prazo: N dias antes (menu suspenso, 1-15) e no próprio dia — ambos calculados pelo banco a partir de prazo + horário, nunca digitados |
| `apice_daily_task_digest` | diário, 7:30 (Brasília) | uma notificação por pessoa e por empresa com o resumo das tarefas que vencem naquele dia |
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

**O retrato que a IA recebe é o sistema inteiro, não só KPIs.** Em
`supabase/functions/ai-insights/index.ts`, `MODULE_READERS` é a lista de
leitores — um por módulo (KPIs/metas, tarefas, mapa mental, orçamentos,
integrações) —
que juntos montam o contexto de uma empresa numa chamada só, para a IA poder
cruzar sinais entre módulos (uma integração parada, o KPI que ela alimenta
sem lançamento, a tarefa atrasada que resolveria isso). Um módulo novo no
sistema ganha um leitor novo nessa lista — é o único lugar que precisa mudar.

## Temas

Claro, escuro e **automático** (segue o sistema operacional em tempo real). A
escolha fica no navegador de cada pessoa, no menu do usuário.

As cores não são classes soltas: cada tema define um conjunto de tokens em
`src/index.css` (`--surface`, `--text`, `--line`…) e o resto do sistema escreve
`bg-surface`, `text-content`, `border-line`. Trocar de tema é trocar os valores
das variáveis, não caçar `dark:` espalhado pelo código.

Contraste é verificado por script, não no olho: `npm run check:contrast` mede
cada par de cor dos dois temas contra a WCAG e falha se algum ficar abaixo do
mínimo. Rode sempre que mexer num token.

Os gráficos recebem cor por valor, não por classe — `useChartTheme()` entrega a
paleta certa para o tema atual.

## A marca

Todo o sistema aponta para `public/logo-apice.svg` — trocar esse arquivo,
mantendo o nome, atualiza login, cabeçalho e favicon de uma vez.

A marca é o arquivo oficial da Ápice: o "A" em azul (`#2e2cb2`) e a seta em
laranja (`#dd4f1d`). No tema escuro ela recebe um leve ganho de brilho por CSS,
para o azul não sumir no fundo quase preto — assim continua sendo um arquivo
só. O componente `Logo` também aceita `framed`, que a envolve numa moldura
branca quando precisar ir sobre uma superfície colorida.

## Integrações com outros sistemas

Cadastre a URL que devolve JSON, o método, a autenticação (Bearer, chave em
cabeçalho ou Basic) e a frequência. Depois mapeie cada campo:

```
dados.faturamento_mes  →  KPI "Faturamento"  ·  mês atual  ·  ×1
```

O caminho aceita ponto e colchete (`dados.totais[0].receita`). O valor vira um
lançamento do KPI no período escolhido, e o histórico de execuções fica visível
na própria tela.

## Números digitados por gente

`<input type="number">` não serve para o Brasil: o navegador só entende ponto
decimal, então "1.000.000,00" vira 1. Todo campo numérico usa o componente
`NumberInput`, apoiado em `parseNumberInput`, que lê "1.000.000,00", "1000000",
"R$ 1.234,56", "12,5%" e até o formato americano "1,234.56", e reescreve o valor
formatado quando o campo perde o foco. As regras estão fixadas em testes
(`npm run test`).

## Celular

O sistema é usado no celular tanto quanto no computador. O painel do usuário
funciona nos dois formatos a partir dos mesmos componentes — a seleção de
empresa vira menu suspenso abaixo do `md` (`CompanySwitcher.tsx`, com busca —
ignora acento e caixa — quando a lista passa de 5 empresas), os cartões de
resumo do painel da holding viram carrossel horizontal (`CardCarousel`,
arrasta ou avança sozinho a cada 4,5s, parando de vez ao primeiro toque) —
e todas as rotas são auditadas a 390 px de largura: nenhuma pode gerar
rolagem horizontal da página. Cada grid com colunas responsivas define uma coluna explícita
também no celular (`grid-cols-1`), tabelas largas rolam dentro do próprio
cartão (`overflow-x-auto` + `min-w`), o quadro de tarefas empilha as colunas e
esconde as vazias, e o canvas do mapa mental usa o espaço todo (editar um nó
abre um modal, não uma barra lateral fixa). `Modal` tem `overflow-x-hidden`
como rede de segurança contra qualquer flex item que esqueça o `min-w-0`.
Dropdowns (notificações, perfil, seletor de empresa) fecham ao clicar fora
— hook `useClickOutside` compartilhado — e, no celular, o painel de
notificações usa posição fixa própria em vez de ficar ancorado ao botão, pra
nunca ficar espremido contra a barra de troca de empresa.

Todo campo de formulário (`.input`) tem pelo menos 16px no celular — abaixo
disso o Safari do iOS dá zoom sozinho ao focar o campo, e como as trocas de
tela são navegação de SPA (sem recarregar a página), o zoom fica grudado na
tela seguinte. É por isso que o tamanho normal de campo no sistema é 16px
no celular e só encolhe (`sm:text-sm`) a partir do desktop — nunca o
contrário. O roteiro de verificação está em `docs/verificacao.md`.

## Testes automatizados (desktop + celular)

`e2e/` tem uma suíte do Playwright (147 testes) que roda a mesma bateria em
dois formatos (`playwright.config.ts`, projetos "Desktop" e "Mobile 390")
contra o Supabase simulado — sem rede de verdade. Ela cobre rolagem lateral
em todas as rotas, o KPI sem lançamento continuar visível, os gráficos
comparativos, o seletor de empresa certo em cada formato (busca incluída),
dropdowns fechando ao clicar fora, os totais de orçamento calculados
corretamente, nenhuma violação da Content-Security-Policy em nenhuma rota, e
— em todas as rotas, mais a tela de login — nenhum campo de formulário
abrindo com zoom no celular. `.github/workflows/ci.yml` roda essa
suíte (mais build, testes unitários e contraste) em todo push e pull request,
para que um recurso novo chegue nos dois formatos sem precisar ser pedido de
novo.

```bash
npm run test:e2e          # local — sobe o build e roda os dois formatos
```

## Rodando localmente

```bash
cp .env.example .env     # preencha a URL e a publishable key do projeto
npm install
npm run dev
```

Scripts: `npm run build` (typecheck + build), `npm run typecheck`,
`npm run test` (unitários), `npm run test:e2e` (Playwright, desktop + celular),
`npm run check:contrast` (WCAG).

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

## Hospedagem e portabilidade — o que é Supabase, o que é Netlify

**Toda a lógica e todo o dado do sistema moram no Supabase.** Banco (Postgres
com RLS), autenticação, as 4 Edge Functions (`admin-users`, `admin-settings`,
`ai-insights`, `integrations-sync`) e os agendamentos (pg_cron) — nada disso
tem qualquer dependência do Netlify. **O Netlify só serve os arquivos
estáticos** que o `npm run build` gera (`dist/`: HTML, CSS, JS) — o
equivalente a um CDN na frente de uma pasta de arquivos. Nenhuma parte do
sistema roda "dentro" do Netlify.

Isso foi deliberado desde o início: `netlify.toml` usa só os três recursos
mais genéricos que existem em hospedagem estática —

```toml
[build]                  # comando de build + pasta a publicar
[[headers]]               # cabeçalhos HTTP fixos por caminho
[[redirects]] from="/*"   # toda rota cai em index.html (o roteador é o React)
```

— e nada de específico do Netlify: sem Netlify Functions, sem Netlify
Identity/auth, sem Netlify Forms, sem Edge Middleware. **Qualquer hospedagem
de site estático com essas três capacidades (build a partir do Git, cabeçalho
por caminho, reescrita de rota pra SPA) serve** — Vercel, Cloudflare Pages,
GitHub Pages (com um pouco mais de configuração pro rewrite), S3+CloudFront,
ou um Nginx próprio. A troca é só de onde os arquivos ficam hospedados; banco,
login e toda a regra de negócio continuam exatamente onde estão, no Supabase.

Uma camada de segurança inteira também não depende do host: o
`Content-Security-Policy` vive como `<meta>` dentro do próprio `index.html`
(não no `netlify.toml`) — viaja junto com os arquivos pra qualquer lugar que
os sirva. Só três cabeçalhos (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`) e o `Cache-Control` de cada tipo de arquivo dependem de
config do host, porque esses só existem como cabeçalho HTTP de verdade — não
tem equivalente em `<meta>`. Ao trocar de host, replique este bloco (os
valores exatos já estão em `netlify.toml`, é copiar):

```toml
[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-store, no-cache, must-revalidate"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

**Checklist pra migrar de host** (o que precisa acontecer no host novo — nada
disso toca no Supabase):
1. Rodar `npm run build`, publicar a pasta `dist/`.
2. Configurar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` como variáveis de
   ambiente do build (os mesmos valores de hoje — são públicos por natureza,
   protegidos pelo RLS do banco, não é segredo trocar de lugar).
3. Reescrever toda rota (`/*`) pra `index.html` — sem isso, atualizar a
   página em qualquer tela que não seja a inicial dá 404 (o roteador é
   client-side).
4. Replicar o bloco de cabeçalhos HTTP acima.
5. Apontar o domínio (`apice-holding.netlify.app` ou um domínio próprio) pro
   host novo.

## Pendências conhecidas

- **Proteção contra senha vazada** (HaveIBeenPwned) está desligada no Supabase
  Auth. Ligue em Authentication → Policies do projeto `apice-holding`.
- **Lembrete por e-mail**: hoje o lembrete vira notificação dentro do sistema.
  Enviar e-mail exige um provedor (Resend/SES) e uma Edge Function extra.
- **Chave da Anthropic**: os insights só funcionam depois de salvá-la em
  Holding → Configurações.
- **Deploy contínuo**: o site do Netlify existe e está configurado, mas ainda
  não está ligado a este repositório (ver a seção de Deploy).
- **react-router-dom em v6**: duas CVEs moderadas (redirecionamento aberto via
  barra invertida, injeção via `deserializeErrors` em hidratação SSR) só têm
  correção na v7 — uma major com mudanças de API. Conferido que nenhuma delas
  se aplica aqui de verdade (o sistema nunca navega pra uma URL vinda de fora,
  e não usa SSR), mas a migração pra v7 fica pra quando alguém puder testar
  com calma, não numa varredura de segurança.
- **vite/vitest em versões antigas**: `npm audit` acusa CVEs (uma crítica) nas
  ferramentas de build e teste — todas exigem o **servidor de desenvolvimento**
  ou a **UI do Vitest** estarem rodando e acessíveis, o que nunca acontece em
  produção (o Netlify só serve o HTML/JS/CSS já compilado). Sem risco pro
  sistema publicado; a atualização (major em ambos) fica pra uma rodada
  dedicada só a isso.
