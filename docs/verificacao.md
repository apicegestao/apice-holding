# Verificação executada

Registro do que foi testado neste projeto, e como reproduzir.

## 1. Isolamento entre empresas (RLS)

Feito direto no banco, impersonando usuários reais dentro de uma transação com
`set local role authenticated` + `set local request.jwt.claims`, e com `rollback`
no fim. Cenário: empresas **A** e **B**, um `viewer` vinculado só à A e um
`admin` da A.

| Cenário | Resultado |
| --- | --- |
| viewer lista empresas | só a Empresa A |
| viewer lista KPIs | só o KPI da Empresa A |
| viewer lê KPI da Empresa B por id | vazio |
| viewer chama `company_snapshots()` | só a Empresa A |
| viewer lista `integration_secrets` | vazio |
| viewer lista perfis | só o próprio |
| viewer insere KPI (na própria empresa) | bloqueado `42501` |
| viewer insere KPI na Empresa B | bloqueado `42501` |
| viewer cria tarefa | bloqueado `42501` |
| viewer tenta virar super admin | bloqueado `42501` |
| viewer tenta se vincular à Empresa B | bloqueado `42501` |
| viewer tenta se promover a admin da própria empresa | sem efeito |
| viewer tenta excluir a própria empresa | sem efeito |
| viewer edita o próprio nome | permitido |
| viewer conclui a troca de senha | permitido |
| viewer edita o perfil de outra pessoa | sem efeito |
| viewer conclui tarefa atribuída a ele | permitido |
| viewer lê `app.system_settings` | bloqueado `42501` |
| viewer chama `get_system_setting` | bloqueado `42501` |
| admin da A cria KPI na A | permitido |
| admin da A cria KPI na B | bloqueado `42501` |
| admin da A renomeia a Empresa B | sem efeito |
| admin da A cria uma empresa nova | bloqueado `42501` |
| admin da A promove um membro da A | permitido |

**Uma falha real foi encontrada e corrigida no meio do caminho:** a policy
`profiles_update_self` liberava a linha inteira e RLS não distingue coluna, então
o usuário conseguia rodar `update profiles set is_super_admin = true` no próprio
registro. A correção está em `0010_lock_profile_privilege_columns.sql`
(`GRANT UPDATE` por coluna + trigger de guarda) e o teste passou a bloquear.

## 2. Interface

`npm run build` limpo (typecheck + bundle) e navegação completa do app
autenticado no Chromium, com as respostas do Supabase interceptadas — o egress
do ambiente de desenvolvimento bloqueia `supabase.co`, então a rede foi simulada.

Todas as 15 rotas renderizaram **sem nenhum erro de console ou exceção**:
painel da holding, empresas, usuários, insights, auditoria, configurações,
painel da empresa, KPIs, metas, tarefas, mapa mental, equipe, integrações,
insights da empresa e perfil.

## 3. O que ainda não foi exercitado de ponta a ponta

Estes caminhos dependem de rede para `supabase.co`, bloqueada no ambiente onde
o sistema foi construído. O código está no lugar, mas rodou contra respostas
simuladas — vale conferir no primeiro uso real:

- login de verdade e o fluxo de troca de senha no primeiro acesso;
- criação de usuário, reset de senha e exclusão pela `admin-users`;
- geração de insights pela `ai-insights` (também depende da chave da Anthropic);
- sincronização de uma integração real e o disparo pelo pg_cron;
- entrega dos lembretes de tarefa pelo job do banco.

---

## 4. Visibilidade das tarefas (segunda rodada)

Mesmo método: usuários reais impersonados numa transação com `rollback`.
Cenário: Ana e Bruno na Empresa A; Bruno também é admin da Empresa B.

| Cenário | Resultado |
| --- | --- |
| Ana cria tarefa privada, da empresa e compartilhada | OK |
| Ana compartilha com a Empresa B, onde ela não entra | bloqueado `42501` |
| Ana compartilha com o Bruno, colega da mesma empresa | permitido |
| Bruno lista as tarefas | vê "Da empresa" e "Compartilhada" — **não** vê a privada da Ana |
| Bruno tenta editar a tarefa privada da Ana | sem efeito |
| Quadro da Empresa A para o Bruno (`tasks_for_company`) | as duas visíveis, a privada fora |

## 5. Interface (segunda rodada)

Build limpo e as **16 rotas** do app autenticado percorridas no Chromium com o
Supabase interceptado — nenhum erro de console ou exceção.

**Um problema de acessibilidade foi encontrado e corrigido no caminho:** os
grupos de botões (visibilidade da tarefa, paletas de cor, escolha do provedor)
estavam dentro de `<label>`, o que gruda o texto do rótulo no nome acessível de
cada botão — o leitor de tela anunciava "Quem enxerga esta tarefa Só minha".
O componente `Field` ganhou o modo `asGroup`, que usa `role="group"` +
`aria-label` no lugar do `<label>`.

---

## 6. Responsividade no celular

Todas as rotas do app autenticado percorridas a **390 × 844** (iPhone, com
`isMobile` e toque), medindo `documentElement.scrollWidth` contra a largura da
viewport — qualquer valor maior significa que a página rola de lado, que é o
sintoma clássico de layout quebrado no celular.

**16 rotas + 2 modais (novo KPI e nova tarefa): nenhuma rolagem horizontal e
nenhum erro de console.**

Uma quebra real foi encontrada e corrigida: a tabela de execuções das
Integrações tinha 5 colunas e empurrava a página para 421 px. As tabelas largas
passaram a rolar dentro do próprio cartão. Também encurtei o canvas do mapa
mental e escondi as colunas vazias do quadro de tarefas em tela pequena, que
gastavam meia tela sem informação.

---

## 7. Campos numéricos

O `<input type="number">` do navegador só aceita ponto decimal: digitar
`1.000.000,00` resultava em **1**. Todos os campos numéricos passaram a usar o
componente `NumberInput`.

**Testes unitários** (`npm run test`, 9 casos) cobrem o interpretador:
formato brasileiro com milhar e decimal, número solto, símbolos de moeda e
porcentagem, formato americano, negativos, entradas vazias ou inválidas, e a
ida-e-volta valor → texto formatado → valor.

**Teste no navegador**, interceptando o que sai para o banco:

| Digitado | Campo mostra | Enviado ao banco |
| --- | --- | --- |
| `1.000.000,00` (meta do KPI) | `1.000.000,00` | `1000000` |
| `2.750.480,35` (lançamento) | `2.750.480,35` | `2750480.35` |
| `500000` (alvo da meta) | `500.000,00` | `500000` |
| `123.456,78` (realizado) | `123.456,78` | `123456.78` |

As 16 rotas e os 2 modais foram percorridos de novo, no computador e a 390 px,
sem erro de console e sem rolagem lateral.

---

## 8. Temas claro, escuro e automático

**Contraste conferido por script**, não a olho: `npm run check:contrast` lê os
tokens dos dois temas em `src/index.css` e calcula a razão de contraste WCAG de
cada par que importa — texto principal, secundário, rótulos, placeholder, texto
do botão, link e bordas, sobre cartão, página e menu.

Os 24 pares (12 por tema) passam. Uma reprovação real apareceu no caminho: a
borda de campo do tema claro ficou em 1,60:1 contra o mínimo de 1,60 — o tom foi
escurecido para 1,76:1.

**Navegação nos três modos**, com o mock do Supabase: 17 rotas em cada um,
conferindo que a classe `dark` foi realmente aplicada e qual cor de fundo o
`body` assumiu.

| Modo | Resultado |
| --- | --- |
| Claro | 17/17, fundo `rgb(246, 247, 249)`, sem erro de console |
| Escuro | 17/17, fundo `rgb(13, 14, 19)`, sem erro de console |
| Automático com sistema escuro | 17/17, escuro aplicado sozinho |

**Celular no tema escuro**: as 17 rotas e os 2 modais a 390 px, sem rolagem
horizontal e sem erro.


---

## 9. A marca oficial

Duas rodadas anteriores tentaram reproduzir a marca a partir da imagem
anexada no chat — o anexo nunca chega como arquivo a este ambiente, só como
visualização, então cada tentativa era um desenho novo, sempre um pouco
diferente do original (a primeira cortava a perna do "A").

O arquivo oficial chegou pelo GitHub, mas com um detalhe: o nome trazia acento
(`Secundária - paleta 2.svg`) e por isso não substituiu `logo-apice.svg` como
o esperado — os dois arquivos ficaram lado a lado no repositório. Encontrado
pelo histórico de commits, o conteúdo foi copiado para `logo-apice.svg` e
`favicon.svg`, e o arquivo de nome estranho foi removido.

Verificado: build limpo, as 16 rotas e o favicon no navegador nos dois temas,
e as mesmas 16 rotas e os 2 modais a 390 px — sem erro de console e sem
rolagem lateral.

---

## 10. KPI sem lançamento, rolagem lateral, menu de empresa e gráficos comparativos

Seis pedidos numa mensagem só. Registro do que era cada um e como foi
verificado.

**1) KPI cadastrado sumindo do painel.** O bug não era do celular — era do
dado: o painel (empresa e holding) e a função `company_snapshots()` só
contavam um KPI depois que ele tinha pelo menos um valor lançado. Um KPI
recém-criado, sem lançamento nenhum, ficava invisível nos dois. A correção
juntou a lista de KPIs ativos com a de últimos valores (migração
`0015_fix_kpi_totals_include_unfilled.sql` para a contagem da holding, e
`CompanyDashboard.tsx` juntando as duas fontes para o painel da empresa), e o
indicador sem valor aparece com "—" e o selo "sem lançamento" em vez de
desaparecer. Conferido direto no banco: a MDD tinha `kpis_total: 0` antes da
correção e `kpis_total: 1` depois, com o "Faturamento" de fato aparecendo.

**2) Rolagem lateral no celular.** Isolado por bisseção no DOM (medindo o
`scrollWidth` de cada nível da árvore, do `<body>` para dentro) até achar o
elemento que de fato crescia: o grid de 3 colunas do painel da empresa
(`grid gap-6 lg:grid-cols-3`) e o de 2 colunas dos novos gráficos
(`lg:grid-cols-2`) não tinham nenhuma coluna definida abaixo do `lg`, e um
grid sem `grid-template-columns` deixa a célula esticar pelo conteúdo em vez
de caber na tela — exatamente o "grid" equivalente ao clássico problema de
`min-width: auto` do flexbox. A varredura achou o mesmo padrão faltando (um
`grid-cols-N` com prefixo de breakpoint mas sem base) em **14 arquivos** do
projeto inteiro, não só no painel — todos ganharam `grid-cols-1` explícito.

**3) Menu de empresa suspenso no celular.** Extraído para `CompanySwitcher.tsx`,
componente único usado por `AppLayout.tsx`: abas de sempre a partir do `md`,
menu suspenso abaixo disso — mesma fonte de dados, sem lógica duplicada.

**4 e 5) Gráficos comparativos.** No painel da empresa: "KPIs: realizado x
meta" (atingimento de cada indicador, com a linha de 100%) e "Tarefas por
situação" (quadro por coluna). No painel da holding: "KPIs na meta por
empresa", barra empilhada com na-meta / fora / sem lançamento por empresa. No
caminho, um KPI de direção "menor é melhor" (ex. churn) usava a mesma conta de
atingimento de um "maior é melhor" e dava um número sem sentido — corrigido
para inverter a razão (`meta / valor`) nesse caso.

**Verificação:** `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. Auditoria de rolagem lateral nas 18
rotas + 2 modais + menu suspenso, em três larguras (360/375/390) — zero
estouro depois da correção do grid (antes dela, o painel da empresa estourava
para 520 px nas três larguras).

## 11. Suíte automatizada (desktop + celular), para não depender de pedir

Para não ter que reconferir manualmente cada ajuste novo nas duas versões,
entrou uma suíte do Playwright (`e2e/`) com a **mesma bateria de testes**
rodando em dois formatos (`playwright.config.ts`, projetos "Desktop" e
"Mobile 390"): as 18 rotas sem rolagem lateral, o KPI sem lançamento
aparecendo, os três gráficos comparativos, e o seletor de empresa certo em
cada formato (abas vs. menu suspenso). Tudo contra o Supabase simulado — sem
rede de verdade. `npm run test:e2e` roda local; `.github/workflows/ci.yml`
roda a mesma suíte (mais build, testes unitários e contraste) em todo push e
pull request, então uma quebra em qualquer um dos dois formatos aparece
sozinha, sem precisar ser pedida. 44/44 testes passando (22 por formato).

---

## 12. IA com o sistema inteiro, KPIs e metas unificados, mapa mental como organograma

**1) A IA passa a ler o sistema inteiro.** A função `ai-insights` só via KPIs,
metas e tarefas abertas — nada de mapa mental ou integrações, então não
cruzava "essa integração parou de sincronizar" com "esse KPI está sem
lançamento" ou "essa ideia no mapa está parada há semanas". Reestruturado em
torno de um registro só (`MODULE_READERS`, em
`supabase/functions/ai-insights/index.ts`): cada módulo lê os próprios dados
e devolve seu pedaço do retrato, tudo enviado numa chamada só à IA. Hoje lê
KPIs/metas (com parcelas semanais e responsável), tarefas (com tags e
visibilidade), mapas mentais (títulos e ideias) e integrações (status e
último erro); um módulo novo no futuro entra como mais um leitor nessa
mesma lista — um lugar só para lembrar, em vez de espalhado pelo código.

**2) Botão "+" no lugar do link "nova tarefa".** No card "Minhas tarefas" do
painel da holding, o link de texto virou um botão no padrão do sistema
(`btn-primary`, ícone `+`), igual ao "+ Nova tarefa" do topo — mesmo
componente, mesmo resultado em desktop e celular.

**3) KPIs e Metas viraram uma coisa só.** A tabela `goals` tinha 0 linhas em
produção (conferido antes de mexer) — sem dado pra migrar. `kpis` ganhou
`due_date`, `owner_id` e `status` (migração
`0016_merge_kpis_goals.sql`); um KPI com prazo já É a meta, com responsável
notificado automaticamente (trigger `app.notify_kpi_ownership`, mesmo padrão
da notificação de tarefa) e andamento. O "valor atual" digitado à mão da
meta antiga saiu de cena — o andamento agora sempre vem do último
lançamento em `kpi_values`, que já existia e não fica defasado. A tela de
Metas foi removida; `/empresa/:id/metas` redireciona para `/kpis` (link
antigo não quebra). `company_snapshots()` e o painel da holding leem a
mesma contagem de antes, só que a partir de `kpis.due_date` em vez da
tabela removida.

Dentro da meta, uma opção nova: **repartir o alvo por semana**
(`kpi_checkpoints`, gerenciado na tela de Histórico do KPI) — divide o alvo
final numa meta acumulada por semana, editável linha a linha, com um selo
"em dia"/"a caminho" comparando o último valor lançado contra o alvo daquela
semana.

De quebra, um bug de conta: um KPI "quanto menor, melhor" (ex. churn) usava
a mesma fórmula de atingimento de um "quanto maior, melhor" e dava um
número sem sentido — corrigido pra inverter a razão (meta ÷ valor) nesse
caso, tanto no painel da empresa quanto no da holding.

**4) Mapa mental: organograma, ligação automática, ramificar e editar no
próprio nó.** Um botão "organograma" (visível com 2+ nós) recalcula a
posição de todo mundo — raiz em cima, filhos embaixo, irmãos lado a lado sem
sobrepor — e salva; continua tudo arrastável depois. As ligações trocaram de
curva livre para cotovelo reto (base do pai → topo do filho), que se ajusta
sozinho a qualquer posição nova sem cruzar por cima de nó nenhum. Cada nó
ganhou dois botões próprios: um lápis (edita o texto ali mesmo, sem abrir o
painel lateral — funciona a duplo clique também) e um "+" (ramifica direto
daquele nó). O painel lateral ("Ramificar", cor, anotações) continua do jeito
que estava.

**Verificação:** `npm run build`, `npm run test` (9/9),
`npm run check:contrast` (24/24) e `npm run test:e2e` (44/44, incluindo o
redirecionamento de `/metas`) limpos. `ai-insights` reimplantada
(`mcp__Supabase__deploy_edge_function`, versão 4) e as três migrações
(`0015`, `0016`) aplicadas no banco de produção — conferido por SQL direto
que a MDD mantém `kpis_total: 1` depois da reestruturação. Organograma,
edição inline e "ramificar a partir do nó" testados num mapa de 3 nós via
Playwright: os três funcionam e o layout final foi conferido visualmente
por screenshot.

---

## 13. Insights por data, capitalização e subtarefas/notas nas tarefas

**1) Insights organizados por data.** A lista completa de insights
(`InsightsPage.tsx`) era um bloco só, ordenado por data mas sem nenhuma
marcação visual entre um dia e outro. Passou a agrupar por dia-calendário —
"Hoje", "Ontem" ou a data por extenso — com um cabeçalho, uma régua e a
contagem do grupo; o card de cada insight mostra só a hora agora, já que a
data está no cabeçalho do grupo.

**2) Capitalização.** "Insights da holding" tinha o "h" minúsculo enquanto o
item de menu da mesma página, ao lado, já dizia "Painel da Holding" — uma
inconsistência visível na mesma tela. Corrigido nos três lugares que tinham
o mesmo padrão (título de página "[Algo] da holding"): painel da holding,
insights da holding e configurações da holding. Os "ver todos"/"ver X" que
eram link de texto solto (`text-xs text-brand-text hover:underline`) viraram
botão de verdade no padrão do sistema (`btn-ghost`), com o texto em Title
Case como pedido — Ver Todos, Ver Tarefas, Ver KPIs — em cinco lugares
(painel da empresa ×3, insights da empresa, insights da holding). Deixados
de fora de propósito: os selos de situação ("na meta", "sem lançamento", "em
risco"...) e legendas descritivas de estatística ("metas ativas", "no
grupo") — minúsculos em todo o sistema por estilo consistente, não por
descuido; mudar só esses quebraria o padrão em vez de corrigi-lo.

**3) Subtarefas e notas.** `task_comments` já existia no banco desde o
módulo de tarefas mas nunca tinha ganhado tela — virou a seção "Notas" no
formulário de editar tarefa (lista com autor e hora, adicionar, remover a
própria). Subtarefas são banco novo (`task_checklist_items`, migração
`0017`, RLS pela mesma regra de quem já enxerga a tarefa) — checklist com
caixinha, adicionar por Enter, remover.
Os dois só aparecem editando uma tarefa que já existe (uma tarefa nova ainda
não tem `id` para pendurar subtarefa ou nota nela). O card da tarefa no
quadro ganhou um selo com o progresso ("2/5") quando ela tem subtarefas.

**Verificação:** `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. `npm run test:e2e` subiu de 44 para
**50 testes** (6 novos: agrupamento por data, título e botão do card de
insights da holding, e um teste com mock de estado próprio — não só
leitura fixa — simulando inserir uma subtarefa e uma nota de verdade e
conferir que aparecem). Migração `0017` aplicada em produção. Capturas de
tela conferidas visualmente: agrupamento por data, e o formulário de tarefa
com subtarefas marcadas/desmarcadas e uma nota.

---

## 14. Editar subtarefas e notas, lembretes padrão, mapa em qualquer direção, quadro de tarefas da holding

**1) Editar subtarefas e notas.** A rodada anterior só deixava adicionar e
remover — corrigir um erro de digitação exigia apagar e recriar (perdendo a
hora original da nota). Subtarefa: clicar no texto vira um campo editável
ali mesmo (Enter salva, Escape cancela). Nota: um lápis ao lado da lixeira
(só na própria) abre a nota como texto editável, com "salvar" ao lado da
data. `task_comments` ganhou a policy de `update` que faltava (migração
`0018`) — só o autor edita a própria nota.

**2) Lembretes padrão de tarefa.** O campo de lembrete era uma data e hora
livres — fácil de esquecer, chato de digitar por extenso. Virou dois campos
só quando a tarefa tem prazo: um menu suspenso "quantos dias antes" (1 a 15)
e um campo de horário — `remind_at` deixa de ser digitado e passa a ser
**calculado pelo banco** (trigger `app.sync_task_reminder`, migração `0019`)
a partir de prazo + dias antes + horário. Todo prazo com responsável já
dispara dois avisos automáticos: N dias antes (padrão 1, migração `0020`
para quem cria tarefa por um caminho que não passa pelo formulário, como o
atalho do mapa mental) e no próprio dia — cada um com seu controle de "já
enviado" (`reminder_sent_at` e `due_reminder_sent_at`), reaberto sozinho
quando o prazo muda. O aviso na criação/atribuição já existia (0003) e
continua igual. Testado dentro de uma transação com rollback: mudar o prazo
recalculou `remind_at` e reabriu os dois "já enviado" corretamente.

**3) Mapa mental em qualquer direção, ligação sempre reta.** Achado e
corrigido um bug real da rodada anterior: os botões "organograma" mostravam
o toast de sucesso mas nunca moviam nenhum nó — o código misturava as
chaves `x`/`y` da função de layout com os campos de verdade do banco,
`position_x`/`position_y`, então o espalhamento nunca era aplicado. Corrigido,
e junto: cada nó ganhou 4 setas (▲▼◀▶) em vez de um "+" só, ramificando pra
qualquer lado; a ligação entre pai e filho decide sozinha, pela posição real
dos dois (não por quem pediu o quê), se sai pela face de cima/baixo ou de
lado — nunca mais uma linha torta ou saindo do lugar errado do nó, em
qualquer direção, inclusive depois de arrastado à mão. Segundo botão de
organização, "lógica" (raiz na esquerda, fluxo horizontal), ao lado do
"organograma" (raiz em cima) — mesmo algoritmo de árvore por camadas, só
troca qual eixo é profundidade e qual é irmãos. Testado visualmente: 5 nós
em direções diferentes, organograma e lógica alternados duas vezes cada,
layout correto nos dois sentidos.

**4) Página de tarefas da holding.** Não existia um quadro que juntasse as
tarefas de todas as empresas — só a lista "Minhas tarefas" (só as próprias)
no painel. Nova tela em `/holding/tarefas`, com atalho no menu lateral da
holding: mesmo quadro kanban de sempre, mas a barra lateral colorida do
card mostra a empresa dona de cada tarefa (não a visibilidade), com uma
legenda com o nome dela — porque aqui um cartão pode ser de qualquer
empresa do grupo. Sem filtro de "editável": quem chega nesta tela já passou
pelo `HoldingOnly`, então é admin da holding e mexe em qualquer tarefa.

**Verificação:** `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. `npm run test:e2e` subiu de 50 para
**58 testes** (atalho da sidebar, quadro com tarefas de duas empresas
diferentes no mesmo lugar, menu suspenso de dias-antes do lembrete). As
migrações `0018`, `0019` e `0020` foram aplicadas em produção.

---

## 15. Usabilidade mobile, exclusão sempre com confirmação, lembrete diário e módulo de orçamentos

Rodada motivada por dois prints reais: o dropdown de notificações
desalinhado no celular (cobrindo a própria opção de marcar como lida) e um
exemplo de mapa mental em linha do tempo.

**1) Fechar dropdowns ao clicar fora.** Sino e menu de perfil só fechavam
clicando de novo no próprio botão. Novo hook compartilhado
`useClickOutside` (`core/lib/useClickOutside.ts`) — o mesmo padrão que já
existia isolado dentro do `CompanySwitcher` virou reutilizável, e o
`CompanySwitcher` passou a usá-lo também (uma implementação só, não duas
copiadas). Aplicado ao sino e ao menu de perfil em `AppLayout`.

**2) Layout do dropdown de notificações no celular.** O painel usava
`absolute` ancorado no próprio botão com `w-[min(20rem,calc(100vw-1.5rem))]`
— no celular, isso ainda dependia da largura real do cabeçalho e podia ficar
espremido/sobreposto à barra de troca de empresa, exatamente como no print.
Trocado por `fixed inset-x-3 top-16` no celular (barra própria, sempre
inteira na tela, `z-50` acima de tudo, cabeçalho "Marcar como lidas" sempre
visível) voltando a ser o menu suspenso ancorado no sino a partir de `sm:`.
Mesmo tratamento no menu de perfil.

**3) Rolagem lateral ao editar tarefa no celular — causa raiz encontrada.**
Um `<button>` de subtarefa usava `flex-1 truncate` sem `min-w-0`: um título
sem espaço nenhum (não quebra linha) força o item a crescer além do
contêiner, e como é um item flex, `flex-1` sozinho não encolhe abaixo do
conteúdo — só com `min-w-0` junto. Grep em todo o `src/` confirmou que era o
**único** lugar com esse padrão faltando (os outros já tinham `min-w-0`
certo). Corrigido, e como rede de segurança contra a próxima vez que
alguém esquecer: `Modal` ganhou `overflow-x-hidden` no cartão — na pior das
hipóteses corta o texto, nunca mais deixa a tela rolar de lado. Regressão
nova em `e2e`: subtarefa com título de 74 caracteres sem espaço, checando
`scrollWidth <= clientWidth` depois.

**4) Fechar modal automaticamente ao salvar — auditoria geral.** Passado
`grep` em todo formulário/modal do sistema: só um ficava aberto depois de
salvar com sucesso — "Lançar valor" de KPI (`ValueEntryModal`), que dava
`notify` e nunca chamava `onClose()`. Corrigido. Todos os outros (tarefa,
KPI, integração, usuário, mapa mental, empresa) já fechavam certo.

**5) Confirmação antes de excluir — auditoria geral.** Novo hook
`useConfirmDelete` em `core/ui` (junto do `ConfirmDialog` que já existia)
padroniza "clica, confirma, só então exclui": guarda o alvo pendente, cuida
do estado de carregando, e só chama a exclusão de verdade depois do
`ConfirmDialog`. Grep em `.delete()` no `src/` inteiro achou 5 exclusões
diretas sem confirmação (a maioria já usava o padrão certo): subtarefa e
nota de tarefa, campo mapeado de integração, lançamento de KPI, divisão
semanal de meta, e nó do mapa mental (que citava faltar apagar também toda
a ramificação — mensagem avisa quando o nó tem filhos).

**6) Lembrete diário às 7:30.** Nova função `app.send_daily_task_digest()` e
job `apice_daily_task_digest` (migração `0021`) — todo dia, uma notificação
por pessoa e por empresa com as tarefas do dia (título, contagem, até 4
nomes e "e mais N"). Roda em UTC (confirmado via `now()`) e Brasília é
UTC-3 o ano inteiro desde 2019 (sem horário de verão): agendado para
10:30 UTC = 7:30 em Brasília. Guarda contra rodar duas vezes no mesmo dia
(fuso de Brasília) sem precisar de outra tabela de controle. É um resumo
diário à parte do aviso "prazo é hoje" que cada tarefa já dispara sozinha no
próprio horário de lembrete (migração 0019) — continuam os dois.

**7) Mapa mental: painel de edição virou botão + modal.** A barra lateral
fixa (`<aside>`) ocupava 18rem de largura o tempo todo, mesmo sem nenhum nó
selecionado — no celular, empurrava o canvas pra baixo. Agora só aparece um
botão "Editar nó" (quando algo está selecionado) que abre as mesmas
opções (Ideia, Anotações, Cor, Ramificar, Virar tarefa, Excluir nó) num
modal — o canvas fica com 100% do espaço, no celular e no computador.

**8) Mapa mental: toolbar simplificada e sem esconder botão no mobile.**
Barra de ferramentas ganhou `overflow-x-auto` (rolagem lateral própria,
nunca mais um botão inacessível no celular). "Organograma" e "lógica" —
mais a nova "linha do tempo" — viraram um menu único "Organizar" (mesmo
padrão de dropdown do item 1) em vez de um botão por layout. O botão
"+ nó solto" só aparece quando o mapa está vazio (só serve pra criar o
primeiro nó — depois disso, todo nó novo já nasce ramificando de outro, com
as 4 setas ao redor do nó selecionado).

**9) Mapa mental: layout de linha do tempo.** Terceiro modo de organização
automática, inspirado no exemplo em anexo (XMind): a raiz vira a ponta
esquerda, os filhos diretos dela viram etapas em sequência da esquerda pra
direita, e a ramificação de detalhes de cada etapa se espalha acima ou
abaixo da linha, alternando por etapa (par embaixo, ímpar em cima) pra não
colidir com a vizinha. Reaproveita o `layoutTree` já existente por baixo —
calcula o galho de cada etapa isoladamente e desloca pra a posição dela na
linha, sem duplicar a lógica de árvore.

**10) Módulo de orçamentos — empresa e holding.** Pedido: orçamento por
evento/projeto (cotações, despesas, projeção de caixa). Nova tabela
`budgets` (um por evento/projeto) e `budget_items` (linhas de receita ou
despesa, cada uma com status previsto → cotado → aprovado → pago/recebido,
valor previsto e valor realizado lado a lado) — migração `0022`, RLS
idêntica a todo módulo por empresa (`app.is_member`/`app.can_write`). Nova
tela `/empresa/:id/orcamentos` e `/holding/orcamentos` (mesmo padrão do
mapa mental: a holding é só mais uma empresa na mesma tabela). Dentro de
cada orçamento: totais (receita/despesa prevista e realizada, saldo dos
dois) e uma projeção de caixa por mês (soma por `due_date`, saldo
acumulado previsto e realizado) — tudo calculado no próprio frontend a
partir das linhas, nunca guardado pronto, evitando desatualização; somas em
centavos arredondadas só no fim (`round2`) para não acumular erro de ponto
flutuante. `NumberInput` (já usado em KPIs) cuida da entrada de valor em
real. IA de insights ganhou o módulo `orcamentos` como mais um leitor
(`MODULE_READERS`, e o equivalente agregado por empresa no contexto da
holding) — edge function `ai-insights` redeployada (v5).

**Verificação:** `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. `npm run test:e2e` subiu de 58 para
**72 testes**: dropdown fecha ao clicar fora, orçamento com totais
calculados (receita/despesa prevista e realizada, saldo dos dois) conferidos
número a número, exclusão de orçamento passando pela confirmação, menu
Organizar com as três opções, "Editar nó" abrindo o modal, e a regressão de
rolagem lateral com subtarefa de título longo sem espaço — desktop e mobile
(390px), todas passando. Migrações `0021` e `0022` aplicadas em produção;
`get_advisors` conferido sem novo alerta.

---

## 16. Tela inicial abrindo com zoom no celular após o login

**Causa raiz.** Todo campo de formulário (`.input`, componente compartilhado
por tudo que é `<input>`/`<select>`/`<textarea>` no sistema) usava
`text-sm` (14px). Abaixo de 16px, o Safari do iOS dá zoom sozinho ao focar
um campo de texto — e como o login e a tela seguinte são a mesma página (o
React Router troca de rota sem recarregar), o zoom aplicado ao focar
e-mail/senha no login fica "grudado" na tela seguinte, exatamente o
sintoma relatado.

**Correção.** `.input` passou a ser `text-base` (16px) até o breakpoint
`sm`, só encolhendo para `text-sm` (14px) a partir do desktop — como é a
única classe usada por todo campo do sistema, a correção vale para
qualquer formulário, atual ou futuro, sem precisar lembrar de repetir em
cada tela. Auditoria em todo o `src/` achou mais 6 lugares que já
sobrescreviam o tamanho da fonte por cima do `.input` (iriam continuar
pequenos mesmo com a correção da classe base) e 3 campos que nem usavam
`.input` — todos ganharam `text-base sm:text-xs`/`sm:text-sm` (16px no
celular, tamanho compacto original a partir do desktop): seletor de
situação do item de orçamento, dois campos JSON de integração e o caminho
de mapeamento, seletor de papel de usuário, o campo de renomear nó do mapa
mental, e os dois seletores de situação da tarefa no quadro kanban (empresa
e holding).

Deliberadamente **não** usado `maximum-scale`/`user-scalable=no` no
`<meta name="viewport">` — bloquear o zoom manual quebraria a acessibilidade
para quem precisa ampliar a tela (WCAG 1.4.4). A correção certa é nunca
disparar o zoom automático, não impedir o zoom de verdade.

**Verificação:** novo helper `checkNoTinyFormFields` em `e2e/` mede o
`font-size` computado de todo `input`/`select`/`textarea` visível (menos
tipos que abrem controle nativo, como checkbox) e falha se algum ficar
abaixo de 16px. Rodado em duas frentes: uma varredura em **todas as rotas**
do sistema (só no projeto "Mobile 390" — no desktop o tamanho compacto é
esperado) e três telas que só existem depois de interagir (tela de login,
formulário de tarefa, item de orçamento dentro do modal de detalhe) — onde
o bug relatado de fato mora, já que login e vários campos afetados ficam
dentro de modais. `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. `npm run test:e2e` subiu de 72 para
**120 testes** (a varredura roda uma vez por rota), todos passando nos dois
formatos.

---

## 17. Varredura de segurança

Auditoria pedida pelo usuário: acesso indevido, "vírus" (injeção/malware) e
brechas abertas — banco (RLS, funções, grants), as 4 Edge Functions, o
front-end (XSS, segredos) e as dependências. Achado real e mais sério
primeiro; o resto na ordem em que foi conferido.

**1) `company_members`: um admin de UMA empresa conseguia anexar QUALQUER
conta do sistema à própria empresa — achado mais sério da varredura.** A
policy de escrita (`company_members_write`, migração 0001) conferia só o
`company_id` da linha (`is_company_admin(company_id)`) e nunca o `user_id` —
ou seja, um admin da empresa A podia inserir `{company_id: A, user_id:
<qualquer UUID>, role: 'admin'}` direto pela API REST do Supabase (fora do
sistema, com só o próprio token), anexando à empresa A uma conta de outra
empresa ou até de um super admin, com o papel que quisesse. Conferido que
**nenhuma tela do sistema escreve nesta tabela pelo cliente** — toda escrita
de verdade sempre passou pela Edge Function `admin-users` (que roda com
`service_role`, e `service_role` sempre ignora RLS) — então fechar a escrita
pra `authenticated` não tira nenhuma função do sistema. Migração `0023`
remove a policy. **Reproduzido e confirmado bloqueado**: rodei o INSERT
exato do ataque (impersonando o único usuário real de produção, contra a
própria empresa dele) direto no banco — antes da correção teria funcionado
(a policy nunca olhou o `user_id`), depois: `ERROR: new row violates row-level
security policy`. Contagem de linhas conferida antes/depois (1, sem mudança).

**2) A mesma classe de bug, um passo antes: a Edge Function `admin-users`
tinha a versão "amigável" do mesmo problema.** Em `create_user`, quando o
e-mail informado já pertencia a uma conta existente, o código vinculava essa
conta à empresa do admin que estava chamando **sem checar se ele tinha
qualquer relação com essa conta** — só sabendo o e-mail de alguém (nem
precisa ser UUID, e e-mail costuma seguir um padrão previsível,
nome.sobrenome@empresa), um admin de uma empresa conseguia anexar a conta de
outra pessoa (de outra empresa, ou até o super admin) ao próprio time, e de
quebra sobrescrever nome/cargo/telefone dessa conta e reativá-la se estivesse
inativa. Corrigido: vincular uma conta **que já existe** a uma empresa agora
é ação só da holding (`caller.is_super_admin`) — criar uma conta nova
continua liberado pra qualquer admin de empresa, como sempre foi. Edge
Function redeployada (v2).

**3) SSRF na integração externa.** Quem configura uma integração (admin de
uma empresa) escolhe livremente a URL que o servidor vai chamar
(`base_url`). Sem checagem nenhuma, dava pra apontar essa URL pra um
endereço interno (`localhost`, `169.254.169.254` — o endereço clássico de
metadados de nuvem, uma rede `10.x`/`172.16-31.x`/`192.168.x`) e usar o
próprio Ápice como ponte pra sondar essas redes a partir do servidor, não do
navegador de quem configurou. Adicionada `assertPublicUrl()` em
`integrations-sync`: recusa IP privado/loopback/link-local escrito direto na
URL, e também tenta resolver o DNS do domínio pra pegar o caso de um domínio
público de propósito apontado pra dentro (com fallback silencioso se
`Deno.resolveDns` não estiver disponível no runtime — a checagem por
IP/hostname literal continua valendo do mesmo jeito). Edge Function
redeployada (v2).

**4) `app.system_settings` sem RLS (alerta "crítico" do advisor do
Supabase) — investigado e confirmado sem exposição real, mas fechado mesmo
assim.** Conferido nos grants reais da tabela: `anon` e `authenticated` não
têm privilégio nenhum nela desde a migração 0007 (só `service_role`), e o
schema `app` nem é exposto pela API REST (só `public` é, por padrão) — ou
seja, ninguém de fora conseguia ler ou gravar aqui mesmo sem RLS. Ainda
assim, RLS é o tipo de proteção que devia estar ligada por padrão em toda
tabela, não por duas outras camadas coincidirem. `service_role` sempre
ignora RLS (`rolbypassrls`, conferido em `pg_roles`) — ligar RLS não muda
nada pra Edge Function que já usa esta tabela. Migração `0023`. Confirmado
depois: `select * from app.system_settings` como `authenticated` continua
dando `permission denied` — igual a antes, agora com mais uma camada.

**5) Função sem `search_path` fixo.** `app.sync_task_reminder` (migração
0019, criada depois da rodada que fixou `search_path` em todo o resto —
migração 0011) ficou de fora. Não é `security definer` (roda com o
privilégio de quem edita a própria tarefa, não elevado), então o risco
prático era baixo, mas todo o resto do sistema já segue esse padrão.
Alinhado na mesma migração `0023`.

**6) `Content-Security-Policy` novo — e de propósito fora do `netlify.toml`.**
O sistema não tinha CSP nenhuma. Adicionada via `<meta>` em `index.html` (não
como cabeçalho do Netlify) exatamente para não criar mais uma dependência do
host — a política viaja junto com os arquivos estáticos pra qualquer lugar
que os sirva. `script-src`, `connect-src` (só a própria origem e o projeto
Supabase), `object-src`, `base-uri` e `form-action` travados em `'self'`/
`'none'`; `style-src` precisa de `'unsafe-inline'` porque cor dinâmica
(empresa, KPI, nó do mapa mental) é feita por atributo `style`, não por
classe — nunca por script. Auditoria confirmou: nenhum `dangerouslySetInnerHTML`,
`eval` ou `innerHTML` em todo o `src/`; nenhuma fonte/imagem externa; nenhum
`fetch()` cru fora do cliente Supabase — então a política pôde ficar
restritiva sem gambiarra. **Verificação real, não só leitura da política**:
nova suíte `e2e/security.spec.ts` visita toda rota do sistema (mais as
telas com cor dinâmica de verdade — mapa mental, tarefas) escutando o
console por violação de CSP; zero violações nos dois formatos.

**7) Auditoria geral de RLS além do achado do item 1** — conferidas as
tabelas onde uma policy mal desenhada teria mais consequência (identidade e
permissão, não dado operacional): `profiles` (colunas de privilégio já
protegidas por GRANT por coluna + trigger de guarda, migração 0010 — nada a
fazer), `integration_secrets` (write-only confirmado: sem nenhuma policy de
SELECT pra `authenticated`, só a Edge Function com `service_role` lê pra
autenticar a chamada externa), `task_shares` (compartilhar com uma pessoa
exige que ela já divida uma empresa com quem compartilha — `app.shares_company`
— então não dá pra compartilhar com um estranho de fora), `companies`
(criar/editar exige `is_super_admin()`, igual à regra da tela).

**8) Dependências.** `npm audit`: duas CVEs moderadas em `react-router-dom`
(redirecionamento aberto, injeção via hidratação SSR) — conferido que
nenhuma se aplica de verdade aqui (o sistema nunca navega pra uma URL vinda
de fora — `grep` em todo `useNavigate`/`<Navigate>` confirmou; e não há SSR,
é SPA puro) — correção completa exige a v7 (mudança de API), registrada como
pendência para uma rodada dedicada; atualizado dentro da v6 mesmo assim
(6.26.2 → 6.30.6, sem mudança de comportamento) por higiene. As outras CVEs
apontadas (`vite`, `vitest`, `esbuild` — uma delas crítica) são todas do
**ambiente de desenvolvimento/teste**, exigem o servidor de dev ou a UI do
Vitest rodando e alcançável — nenhuma delas chega no Netlify, que só serve o
HTML/CSS/JS já compilado; a atualização (major nos dois) fica registrada
como pendência, não feita agora para não arriscar quebrar o build às cegas
numa varredura de segurança. Nenhum segredo commitado (`.env` fora do git,
conferido `git log` completo por nome de arquivo).

**Relatório de arquitetura entregue ao usuário** (e também no `README.md`,
seção "Hospedagem e portabilidade"): todo o backend, banco e autenticação
vivem no Supabase; o Netlify só serve os arquivos estáticos do build — sem
Netlify Functions, Identity ou Forms — então trocar de hospedagem estática
(Vercel, Cloudflare Pages, S3+CloudFront, etc.) não toca em nenhuma regra de
negócio nem exige reescrever nada, só replicar build + variáveis de ambiente
+ 4 cabeçalhos HTTP + reescrita de rota pra SPA (checklist completo no
README).

**Verificação:** `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. `npm run test:e2e` subiu de 120 para
**140 testes** (nova suíte de CSP, 44 testes nos dois formatos — 22 rotas +
1 tela com cor dinâmica, vezes 2). Migração `0023` aplicada em produção;
`get_advisors` reconferido depois — o alerta crítico de RLS sumiu, sobrou só
o aviso informativo esperado ("RLS ligada, sem policy" — proposital, é
`service_role` que usa esta tabela) e o de senha vazada (ajuste de
configuração no painel do Supabase, fora do alcance de uma migração SQL).
Edge Functions `admin-users` e `integrations-sync` redeployadas (v2 cada).

---

## 18. Busca no seletor de empresa (celular)

Pedido direto: opção de pesquisar empresa dentro do menu suspenso de troca de
empresa (a versão de celular do `CompanySwitcher`, abaixo do breakpoint `md`
— no computador continua sendo a barra de abas de sempre, que não precisa
disso porque já mostra tudo lado a lado).

Campo de busca aparece só quando **compensa**: com mais de 5 empresas na
lista. Pra 2 ou 3, procurar é mais lento que só olhar — e o campo sumir
sozinho quando sobra pouca empresa evita uma tela mais cheia à toa. Busca
ignora acento e caixa (`Ápice Holding` também aparece por "apice"), filtra só
as empresas de verdade — "Holding" e "+ Empresa" continuam fixos, são atalho
de navegação, não item de lista — e mostra "Nenhuma empresa encontrada"
quando não bate com nada. Campo de busca reaproveita a classe `.input`
padrão do sistema (mesma proteção contra zoom automático no iOS da rodada
16) e fica fixo no topo do menu (`sticky`) enquanto a lista rola por baixo.

**Verificação:** `npm run build`, `npm run test` (9/9) e
`npm run check:contrast` (24/24) limpos. Duas rotinas novas em `e2e/`, só no
projeto "Mobile 390" (é onde esse seletor existe): uma com 7 empresas
simuladas confere que buscar "vib" acha só a Vibra, que "orbita" (sem
acento) acha "Órbita Consultoria", e que uma busca sem resultado mostra o
aviso; outra confere que o campo nem aparece com as 2 empresas padrão da
suíte. `npm run test:e2e` subiu de 140 para **142 testes**.

---

## 19. Carrossel de cartões no celular, barra de progresso da meta e fim da data dupla em "Lançar valor"

Três pedidos direto do usuário.

**Carrossel no painel da holding (celular).** Os cinco cartões de resumo do
topo do painel da holding — Empresas, KPIs na meta, Metas em risco, Minhas
tarefas vencidas e (novo) Minhas tarefas — ganharam uma versão horizontal
para telas pequenas: um carrossel com `scroll-snap` nativo (arrasta com o
dedo, sem JavaScript no gesto em si) que também avança sozinho a cada 4,5s,
parando de vez assim que a pessoa toca ou arrasta (não some, só desliga o
automático — quem estava navegando não quer que o carrossel puxe o cartão de
volta). Bolinhas embaixo marcam a posição e também são clicáveis. O
componente (`CardCarousel`, em `core/ui`) é genérico — recebe uma lista de
cartões prontos — pra poder ser reaproveitado em outra tela sem duplicar
lógica. No computador (`sm:` pra cima) continua a grade de sempre, sem
carrossel: os cartões cabem lado a lado e ele só atrapalharia. Seguindo o
mesmo padrão já usado no seletor de empresa (`CompanySwitcher`), as duas
versões (carrossel e grade) ficam as duas no DOM o tempo todo, alternando por
classe CSS (`sm:hidden` / `hidden sm:grid`) — não é troca condicional em
JavaScript, então não há salto de layout na hora de trocar de tamanho de
tela. Cartão novo "Minhas tarefas" (total em aberto, todas as empresas)
entrou pra completar a lista que o usuário pediu — antes só existia
implicitamente dentro do quadro de tarefas.

Ficou de fora desta rodada o conjunto de indicadores do painel **da
empresa** (`CompanyDashboard`), que é uma fileira de 4 cartões numéricos
diferente e não foi mencionada pelo usuário — mesmo tratamento pode ser
estendido lá se for esse o pedido.

**Barra de progresso meta × realizado.** Nova função `attainmentRatio` (em
`core/lib/format.ts`) centraliza a conta de "quanto já foi entregue da
meta", ciente da direção do KPI: `valor / meta` quando maior é melhor, e
`meta / valor` quando menor é melhor (ex. churn) — mesma fórmula que os
gráficos de atingimento já usavam, só que agora num único lugar. Em cima
dela, um componente `ProgressBar` (também em `core/ui`) — verde a partir de
100% do caminho, vermelho abaixo, mesma convenção de cor dos gráficos
existentes. Barra nova aparece em quatro pontos, como pedido ("em metas e
KPIs e no painel"): no painel da holding (dentro do cartão por empresa, sob
cada KPI da lista), no painel da empresa (nos indicadores e nas metas), na
página de KPIs (KPI comum e o card de meta com prazo) e dentro do modal
"Lançar valor" (atualiza ao vivo enquanto a pessoa digita, antes de salvar).

Auditando os lugares que já desenhavam uma barra à mão pra fazer essa troca,
apareceram **dois lugares com a mesma conta errada**: tanto o cartão de
"Metas" do painel da empresa quanto o card de meta com prazo em
`KpisPage.tsx` calculavam sempre `valor / meta`, ignorando a direção — um
KPI de "menor é melhor" (ex. reduzir o churn de 10% para 5%) mostrava a
barra andando pra trás em vez de mostrar progresso. Corrigido nos dois
lugares ao trocar pela função centralizada.

**Fim dos dois campos de data em "Lançar valor".** O usuário notou a
redundância e está certo: a frequência do KPI (diária, semanal, mensal...)
já define o tamanho do período, então pedir início **e** fim toda vez que
alguém lança um valor duplicava informação que já foi decidida lá no
cadastro do KPI — e ainda abria brecha pra alguém digitar um intervalo que
não bate com a frequência (ex. 10 dias num KPI mensal). Modal agora pede só
**uma** data de referência (qualquer dia dentro do período que quer lançar,
hoje por padrão) — pra KPI mensal, um seletor de mês (`<input type="month">`,
mais simples que forçar escolher um dia específico que não importa). A
partir dela, `periodBounds` (função já existente, mesma que calcula o
período de vencimento em outros lugares do sistema) calcula o início e fim
de verdade sozinho, e um texto de apoio mostra o período resultante ("Período:
1 a 31 de março") pra confirmar visualmente antes de salvar. Se já existe
lançamento nesse período, o formulário automaticamente vira edição dele em
vez de criar duplicado — comportamento que já existia, preservado. Barra de
progresso (acima) também entrou nesse modal, como pedido.

**Verificação:** `npx tsc --noEmit` limpo, `npm run build` limpo. Testes
unitários novos para `attainmentRatio` (direção "up", direção "down", valor
zero, e os três casos de nulo — sem valor, sem meta, meta zero) —
`npm run test` subiu de 9 para **13 testes**. `npm run check:contrast`
(24/24) segue limpo — `ProgressBar` reaproveita as mesmas cores
(`bg-emerald-500`/`bg-rose-500`) já auditadas nos gráficos. `npm run
test:e2e` sem regressão: **142 testes passando** nos dois projetos
(Desktop e Mobile 390) — nenhum teste dependia dos rótulos "Início do
período"/"Fim do período" removidos, nem foi afetado pela duplicação de DOM
do carrossel (a suíte não testa esse painel visualmente, só funcionalmente).

---

## 20. Acesso rápido aos indicadores e tarefas, gráfico em linha, prazo da meta

Sete pedidos do usuário, todos em cima do painel e do quadro de tarefas.

**1) Acesso rápido ao indicador + data completa.** No card "Indicadores" do
painel da empresa, cada cartão de KPI virou link direto pra
`/empresa/:id/kpis?kpi=<id>` — a página de KPIs lê esse parâmetro, rola até
o cartão certo e destaca por 2,5s (`ring-2 ring-brand-500`), em vez de abrir
sempre a lista inteira em "Ver Todos". Mesmo tratamento entrou nos cartões
de meta ("Metas") do painel da empresa e na mini-lista de KPIs por empresa
no painel da holding — a mesma ideia de "abrir direto o indicador" se aplica
aos três lugares. Pra isso o `Card` do kit compartilhado ganhou uma prop
`id` opcional (só passa pro `<section>`).

A data "incompleta" era o rótulo curto de período (`labelPeriod`, ex.
"set/26" — só mês e ano, sem dia, porque foi pensado pra KPI recorrente, não
pra prazo de meta). Corrigido: quando o KPI tem `due_date` (é uma meta),
mostra a data completa do prazo (`formatDate`, "30/09/2026") em vez do
rótulo de período — no card de Indicadores, no card de Metas (que já tinha
`relativeDays` mas ganhou a data absoluta ao lado) e na mini-lista da
holding.

**2) Gráfico de linha em vez de barra.** Os dois gráficos de "meta x
realizado" — "Metas x realizado" no painel da holding e "KPIs: realizado x
meta" no painel da empresa — trocaram `BarChart`/`Bar` por `LineChart`/
`Line`. O eixo X continua categórico (uma empresa ou um KPI por ponto, não
uma linha do tempo), mas os pontos ligados por uma linha deixam mais fácil
comparar a tendência de conjunto do que barras isoladas — e foi o formato
pedido. A cor de cada ponto (verde/vermelho por status, ou a cor da empresa
no gráfico da holding) segue vindo de um `dot` customizado (um `<circle>`
colorido por ponto), já que `Line` não tem o equivalente do `<Cell>` do
`Bar`. Só esses dois gráficos mudaram — o de "KPIs na meta por empresa"
(contagem empilhada) e o de "Tarefas por situação" continuam de barra, que é
o formato certo pra contagem categórica, não pedido pelo usuário.

**3) Prazo e valor-alvo nos cartões de empresa da holding.** A mini-lista de
KPIs dentro de cada cartão de empresa (painel da holding) ganhou a data do
prazo ao lado do nome, quando o KPI é uma meta, e a barra de progresso
ganhou uma prop nova, `caption` (`ProgressBar`, em `core/ui`) — um texto
pequeno embaixo da barra tipo "R$ 50.000,00 de R$ 100.000,00", pra mostrar o
alvo, não só o valor lançado. Mesma legenda entrou também no card "Metas" do
painel da empresa, pela mesma razão.

**4) "Minhas tarefas" na 2ª posição.** O card grande com a lista de tarefas
(não o cartãozinho de resumo, que já estava na fileira do topo) mudou de
lugar: antes vinha depois dos dois gráficos de comparação, agora é a
primeira coisa depois da fileira de cartões-resumo — a lista de tarefas fica
visível sem rolar a página, como pedido.

**5) Setas no quadro de tarefas.** Cada cartão do kanban (`TasksPage` e
`HoldingTasksPage`) ganhou duas setas (◀ ▶) ao lado do seletor de status já
existente, pra mudar de coluna com um clique em vez de abrir o menu e
escolher — mesmo destino (`changeStatus`), só que direto pro vizinho
(anterior/seguinte na ordem do quadro: A fazer → Fazendo → Bloqueado →
Concluído). A seta correspondente some (fica desabilitada) na primeira e na
última coluna. Optou-se por setas em vez de arrastar-e-soltar: mais simples
de implementar de forma confiável no touch do celular (onde o board já é
usado bastante) e não exige biblioteca nova.

**6) Concluir tarefa direto do painel.** Nas listas de tarefas dos dois
painéis — "Minhas tarefas" na holding e "Próximos prazos" na empresa — um
botão de caixa (☐) ao lado de cada item marca a tarefa como concluída
(`status: 'done'`) sem precisar abrir o quadro nem o modal de edição.

**7) Mais acesso rápido.** Dois módulos ficavam fora de qualquer link nos
painéis — Mapa mental e Orçamentos só eram alcançáveis pela barra lateral.
Adicionado um atalho pra cada um no cabeçalho dos dois painéis (empresa e
holding), ao lado das ações já existentes — fecha a lacuna, já que os outros
módulos (KPIs, Tarefas, Insights) já tinham link direto de algum card.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test` (13/13, sem novo caso — nada de lógica pura nova, só JSX/roteamento) e
`npm run check:contrast` (24/24) limpos. `npm run test:e2e` sem regressão —
suíte cobre a navegação, mas nenhum teste fixava a estrutura interna do
gráfico (barra vs. linha) nem a ordem exata dos cards no painel da holding,
então a reordenação e a troca de gráfico não quebraram nada; a mudança de
`<div>` pra `<Link>` nos cartões de KPI manteve o mesmo texto visível, então
os testes que liam conteúdo continuam passando.

---

## 21. Saúde geral por empresa, linha de meta sempre visível, execução de orçamento

Pedido aberto do usuário — "mapeie e me ajude" a medir e acompanhar tudo,
deixar os painéis o mais úteis possível pro controle de múltiplas empresas
— mais um pedido direto sobre a linha de meta nos gráficos.

**1) Linha de meta sempre visível.** A `ReferenceLine` de meta/alvo, em
todo gráfico que tem uma (dois no `KpisPage` — a tendência dentro do
cartão do KPI e o histórico completo —, mais as duas de "meta x
realizado" no painel da empresa e da holding), tinha um problema sutil: por
padrão o Recharts **descarta** a linha quando o valor dela cai fora do
intervalo calculado a partir dos dados (`ifOverflow` padrão é `"discard"`).
Na prática, um KPI bem abaixo ou bem acima da meta fazia a linha de
referência sumir silenciosamente — exatamente quando mais precisava ser
vista. Todas as quatro ganharam `ifOverflow="extendDomain"`, que força o
eixo a se esticar até incluir a meta — ela aparece sempre, constante, não
importa onde o valor realizado esteja.

**2) Saúde geral — um número por empresa, e um pro grupo inteiro.** Nova
métrica agregada: a média do `attainmentRatio` (a mesma conta usada em
toda barra de progresso do sistema) de **todo KPI com meta definida**, não
só os que têm prazo — cobre também KPI recorrente sem data-limite, tipo
faturamento mensal. Aparece em três lugares novos:
- Painel da holding, logo abaixo do cabeçalho: "Saúde geral do grupo",
  média entre toda empresa operacional.
- Painel da empresa, no mesmo lugar: "Saúde geral dos indicadores" daquela
  empresa.
- Painel da holding, dentro de cada cartão de empresa: a mesma conta, só
  que restrita aos KPIs daquela empresa — o número que resume o cartão
  antes mesmo de abrir a lista de indicadores dele.

**3) Bolinha de status + ordenação por urgência.** Cada cartão de empresa
no painel da holding ganhou uma bolinha colorida ao lado do nome —
vermelha (tarefa vencida ou meta em risco), âmbar (algum KPI fora da meta,
mas nada vencido/em risco) ou verde (tudo em dia). E o mais importante pra
quem cuida de várias empresas: **a ordem dos cartões deixou de ser a
ordem de cadastro** e passou a ser por urgência — pontuação
`vencidas × 3 + metas em risco × 2 + KPIs fora da meta`, decrescente. A
empresa com problema aparece primeiro, sem precisar rolar a tela toda pra
notar.

**4) Execução de orçamento.** Cada card de orçamento na lista (`/orcamentos`)
ganhou uma barra "Despesa executada" — quanto da despesa prevista já foi
gasto — com a legenda em reais dos dois lados. Só que aqui inverte a lógica
de cor da barra de meta: gastar mais não é "bater a meta" (que ficaria
verde), é estourar o orçamento (que devia ficar vermelho). Por isso o
`ProgressBar` ganhou uma prop `variant`: `'goal'` (padrão, sem mudança em
nenhum uso existente) continua verde≥100%/vermelho<100%; o novo
`'spend'` é neutro (azul da marca) até 100% e só fica vermelho depois de
estourar. Os totais por orçamento vêm de uma consulta leve e separada
(`budget_id, kind, planned_amount, actual_amount, status` de todo item da
empresa), recarregada depois de qualquer lançamento — assim a barra na
lista fica atualizada sem precisar abrir cada orçamento um por um pra ver
como anda.

**Decisões deixadas de fora desta rodada** (mapeadas, não esquecidas): uma
barra de progresso no cartão de tarefa do kanban pro checklist (X/Y) foi
descartada — o card já é compacto, e o badge de fração já comunica isso
sem precisar de mais uma barra; a listagem administrativa de empresas
(`/holding/empresas`, cadastro, não painel) ficou de fora porque o pedido
foi especificamente sobre os cards do *painel*.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test` (13/13) e `npm run check:contrast` (24/24) limpos — a nova cor
`bg-brand-500` da variante `'spend'` já é usada em outros lugares do
sistema (indicador do carrossel), então não abriu combinação nova pra
auditar. `npm run test:e2e` sem regressão: nenhum teste fixava a ordem dos
cards de empresa no painel da holding, então reordenar por urgência não
quebrou nada.

---

## 22. Produtos e edições, consistência de dados, e mais inteligência no sistema

Três pedidos abertos do usuário.

### 1) Múltiplas frentes de produto/serviço dentro de uma empresa

Caso real que motivou o pedido: a MDD (Mesa dos Donos) controla ao mesmo
tempo "Entre Donos", "Imersão", "Mentoria" e "Club" — as duas primeiras com
várias edições por ano (turmas, encontros), as outras rodando contínuo.
Faltava um jeito de abrir e acompanhar cada frente separadamente dentro da
mesma empresa.

**Modelo escolhido — dois níveis:**
- `products` — a frente em si, permanente (ex. "Entre Donos"). Cadastrada
  uma vez, fica.
- `product_editions` — uma rodada dela, com data (ex. "Turma 12"). Opcional:
  frente contínua (Mentoria, Club) não precisa de nenhuma.

KPI, tarefa e orçamento ganharam uma coluna opcional `product_id` (KPI e
orçamento também `product_edition_id`) — **nullable**, então nada que já
existia mudou de comportamento; quem nunca usar produto continua com um
indicador "da empresa toda", exatamente como sempre foi.

**O que foi construído:**
- Migração `0024_products.sql`: as duas tabelas novas, guardas de
  integridade (uma edição não pode apontar pra produto de outra empresa; um
  KPI/orçamento com edição precisa que a edição seja do mesmo produto
  escolhido — os mesmos `assert_*_company()` que já protegiam
  `kpi_values`/`kpi_checkpoints`), RLS no padrão de todo módulo do sistema
  (`app.is_member` pra ler, `app.can_write` pra escrever). Aplicada
  diretamente no projeto de produção via Supabase MCP; `get_advisors`
  conferido depois — nenhum alerta novo.
- Nova página `/empresa/:id/produtos`: lista de produtos com uma barra de
  "saúde da frente" (mesma conta de `attainmentRatio`, restrita aos KPIs
  daquele produto) e a contagem de tarefas abertas; clicar num cartão abre
  edição do produto e a lista de edições dele (adicionar, mudar situação,
  excluir) — mesmo padrão de "orçamento → itens" que `BudgetsPage` já usava.
- `KpisPage`: formulário de KPI ganha "Produto" e, se o produto tiver
  edições, "Edição" (os dois opcionais, só aparecem se a empresa já tem
  produto cadastrado). Cartão do KPI mostra a etiqueta do produto/edição.
  Filtro por produto no topo da página — importante pra empresa com muitos
  indicadores espalhados entre frentes diferentes.
- `TaskFormModal`: mesmo campo opcional de produto.
- Painel da empresa: novo card "Produtos", cada um com sua barra de saúde e
  link pra gerenciar.
- Painel da holding: `company_snapshots()` ganhou `products_active` (uma
  função só, reaproveitada por toda tela que já a chama); cada cartão de
  empresa mostra "N produto(s)" com link direto — é o "refletir na holding
  pra controle" pedido.
- `kpi_latest_values` (a view usada em quase toda tela) ganhou as colunas
  `product_id`/`product_edition_id`, pra qualquer painel poder filtrar ou
  agrupar por produto sem outra consulta.

**Deixado de fora por ora** (a própria orientação do usuário foi "vamos
adaptando o que achar necessário com o uso" — não travar tudo de uma vez):
`budgets.product_id`/`product_edition_id` existem no banco, mas a tela de
Orçamentos ainda não tem o seletor — um orçamento hoje já nomeia o evento
livremente ("Imersão 2027.1"), e a ligação formal fica pra quando o uso
real pedir. A holding não ganhou aba de Produtos própria — o conceito é de
empresa operacional, do mesmo jeito que KPIs também não existem no nível da
holding (conferido: o menu da holding nunca teve link de KPIs).

### 2) Consistência: mudar um dado em um lugar reflete em todo o sistema

Pergunta direta do usuário — "se mudo o título de uma meta, isso deve
refletir em todos os pontos que esse título aparece". Resposta depois de
auditar o banco inteiro (toda tabela, toda view): **já reflete, e por
design.** O nome de um KPI mora numa única coluna (`kpis.name`); todo outro
lugar do sistema — o painel da empresa, o painel da holding, a lista de
KPIs, o histórico — lê esse nome através de uma referência (`kpi_id`) e uma
`view`/`select` que busca o valor **na hora**, nunca uma cópia gravada à
parte. O mesmo vale pra nome de empresa, título de tarefa, nome de produto:
nenhuma tabela do sistema duplica o texto de outra só pra exibir mais
rápido. Renomear um KPI e salvar já muda o texto em toda tela que o mostra,
na próxima vez que ela carregar os dados (o padrão do sistema inteiro é
recarregar a lista logo depois de qualquer salvamento, confirmado em cada
módulo nesta sessão e nas anteriores).

A única coisa que **não** muda com um rename — e é assim de propósito, não
um bug — é o texto já registrado em notificações e auditoria: se uma
notificação disse "Você é responsável por Faturamento" e o KPI depois vira
"Receita Recorrente", a notificação antiga continua com o nome de quando
foi criada, do mesmo jeito que um e-mail não se reescreve sozinho. É
histórico, não um rótulo ao vivo.

O que essa auditoria **não** cobre — e não é o que foi pedido — é
sincronização em tempo real entre duas abas abertas ao mesmo tempo (o
sistema não tem WebSocket/realtime; cada tela busca os dados quando é
aberta). Se isso vier a ser necessário, é uma frente própria, maior, pra
uma rodada dedicada.

### 3) Mais inteligência — o que já foi resolvido nas duas frentes acima

O pedido genérico de "melhorias que achar boas" ficou concentrado no
módulo de produtos em si (a resposta mais concreta e útil pro caso real
descrito) e no reforço de que a arquitetura de dados já é sólida —
preferido a espalhar pequenos ajustes soltos por todo canto nesta rodada.

**Verificação:** migração aplicada em produção via Supabase MCP;
`get_advisors` (security) conferido antes e depois — mesmos dois avisos
pré-existentes (RLS sem policy em `app.system_settings`, proposital; senha
vazada, configuração do painel do Supabase), nenhum novo. `npx tsc
--noEmit` e `npm run build` limpos. `npm run test` (13/13) e `npm run
check:contrast` (24/24) limpos. Rota `/produtos` adicionada à lista de
rotas cobertas pela suíte e2e (`ROUTES`, em `e2e/fixtures.ts`) — ganha de
graça a checagem de "sem rolagem lateral" e "sem zoom automático no
celular" nos dois formatos. `npm run test:e2e` subiu de 142 para
**147 testes**, todos passando, sem regressão.

### Bug encontrado de brinde: modal escondido atrás de outro modal

Construindo a tela de edições (produto aberto → clicar "Editar produto"
abre um segundo modal por cima), reparei que os dois modais renderizam com
o mesmo `z-index` (`Modal`, em `core/ui`, é sempre `z-50`) — então, com dois
abertos ao mesmo tempo, quem decide quem fica visível por cima não é a
ordem em que foram abertos, é a ordem em que aparecem no JSX (empate de
z-index resolve por ordem no DOM; confirmado com um teste isolado via
Playwright). `ProductsPage` nasceu com essa ordem errada, copiada de
`BudgetsPage` — e aí percebi que `BudgetsPage` tinha o mesmo problema desde
que o módulo existe: abrir um orçamento (modal de detalhe) e clicar
"Editar" nunca mostrava o formulário de edição — ele abria, sim, só que
atrás do modal de detalhe, que continuava cobrindo a tela inteira.
Corrigido nos dois arquivos: o modal "de fora" (detalhe/edições) agora é
declarado antes do modal "de dentro" (form de editar) — comentário deixado
em cada um explicando a ordem, pra ninguém inverter de novo sem querer.
Nenhuma lógica mudou, só a posição dos blocos no JSX.

## 24. Meta de produto e sub-produto visível e cadastrável, cadeia de 3 níveis, e "Contribui para" explicado

Três problemas relatados depois de usar a rodada anterior — e um pedido
geral de simplificar, tratado junto porque os três eram, no fundo, a mesma
causa: a meta existia no banco, mas não tinha nenhum caminho visível a
partir de Produtos pra cadastrá-la ou vê-la.

### 1) Dava pra cadastrar produto e edição, mas não meta nenhuma

`ProductsPage` só cuidava da estrutura (produto, edições) — pra ligar uma
meta a um deles era preciso ir em KPIs, lembrar de escolher o produto certo
lá, sem nenhum aviso de que era assim que funcionava. Agora a própria tela
de Produtos:
- Mostra a meta de cada produto direto no cartão da lista (nome do
  indicador, valor atual e alvo, barra de progresso) — não só a barra de
  "saúde da frente" genérica de antes.
- Ao abrir um produto, lista "Metas deste produto" (pode ter mais de um
  indicador) e a meta de cada edição, cada uma como um link que leva pro
  KPI na tela de KPIs (`?kpi=<id>`, o mesmo atalho que o painel já usava).
- Tem um botão **"+ Nova meta"** no produto e **"+ Meta desta turma"** em
  cada edição sem meta ainda — os dois levam pro formulário de criar KPI
  já com produto (e edição, quando for o caso) preenchidos.

Pra isso, `KpisPage` passou a aceitar `?novo=1&product_id=X[&product_edition_id=Y]`
na URL: abre o formulário de criação sozinho, com os campos já certos, e
limpa os parâmetros da URL assim que consumidos (um F5 depois não abre o
formulário de novo). Só um pequeno atalho de navegação — o cadastro do KPI
continua sendo feito num único lugar (`KpisPage`), sem duplicar o
formulário complexo numa segunda tela.

### 2) Card de Produtos no painel da empresa sem informação de meta

O card "Produtos" do painel da empresa (`CompanyDashboard`) mostrava só uma
barra de progresso sem dizer de qual indicador, nem o valor, nem o alvo.
Agora mostra o nome do indicador principal do produto e o texto "R$ X de
R$ Y" (mesmo formato que o painel já usa pras metas com prazo), com a barra
embaixo só quando dá pra calcular um percentual.

### 3) "Contribui para" aparecia vazio, sem explicação — e só ia até 2 níveis

O pedido original era uma cadeia de três elos: sub-produto → produto →
empresa (ex.: a turma de setembro soma no "Entre Donos", que por sua vez
pode somar num indicador geral da empresa, tipo "Faturamento total"). A
rodada anterior parou nos dois primeiros — o KPI pai não podia, ele mesmo,
ter um pai. Duas mudanças:

- **Banco:** a trigger `app.assert_kpi_parent()` trocou a regra "só dois
  níveis" por uma checagem de ciclo de verdade — sobe a cadeia a partir do
  pai proposto e recusa só se o próprio KPI aparecer nela (o que fecharia
  um ciclo). Profundidade em si não tem mais limite de negócio. Testado
  direto no banco: uma cadeia de 3 níveis (empresa ← produto ← turma) foi
  criada e leu corretamente; uma tentativa de fechar ciclo (o avô apontando
  pro próprio neto como pai) foi rejeitada com a mensagem certa.
- **"Contribui para" no formulário do KPI:** agora existe em dois
  contextos — um KPI de turma mira num indicador do mesmo produto sem
  edição (como já era); um indicador de produto (sem edição) passa a poder
  mirar num indicador sem produto nenhum (da empresa toda), fechando o
  terceiro elo. Quando não existe nenhum candidato ainda, o campo explica
  o motivo em vez de ficar mudo ("ainda não existe um indicador deste
  produto sem edição — crie um primeiro"), em vez do dropdown vazio e sem
  explicação que gerou a dúvida original.

O cálculo da soma (`rollupFor`/`effectiveValue`, em `KpisPage`) já era
recursivo em espírito mas só testado a dois níveis; agora garante
explicitamente que um nó do meio da cadeia (o "produto") usa a **própria
soma dos filhos**, nunca um lançamento direto que porventura exista nele,
ao repassar o valor pro avô — coberto por teste unitário novo (ver abaixo).

### Refatoração: uma função só para a soma em cadeia

A mesma conta (formação da lista de filhos por `parent_kpi_id`, soma
recursiva) existia dentro de `KpisPage` e precisava se repetir em
`CompanyDashboard` e `ProductsPage` pra mostrar a meta nos cartões — em vez
de copiar e colar pela terceira vez, virou uma função compartilhada em
`core/lib/kpiRollup.ts` (`buildChildrenByParent` + `effectiveKpiValue`),
com teste unitário próprio: soma sem filhos, soma com filhos, soma em
cadeia de 3 níveis (confere que o nó do meio usa o próprio rollup, não um
valor direto), filho sem lançamento é ignorado (não vira zero), nenhum
filho com lançamento ainda é nulo (não zero), e não trava num ciclo
contrived. `CompanyDashboard` foi migrado pra usar a função compartilhada
no lugar da cópia local; `KpisPage` manteve a própria versão porque o dado
de origem lá é outro formato (série de valores por KPI, não uma lista já
resolvida) — juntar os dois exigiria mais indireção do que o ganho
justificaria agora.

**Verificação:** migração `kpi_parent_chain` aplicada em produção via
Supabase MCP; `get_advisors` (security) conferido depois — mesmos dois
avisos pré-existentes, nenhum novo. `npx tsc --noEmit` e `npm run build`
limpos. `npm run test` subiu de 19 pra **26 testes** (7 novos em
`kpiRollup.test.ts`). Fixtures de e2e (`e2e/fixtures.ts`) ganharam produto,
duas edições e dois KPIs novos — um de produto sem lançamento direto (só
soma da turma) e um de turma com lançamento — pra exercitar a cadeia de
verdade em teste automatizado, não só manualmente. `npm run test:e2e`
subiu de 147 pra **159 testes**, todos passando (12 novos, cobrindo: a
soma aparecendo no cartão mesmo sem lançamento direto no produto, a lista
de metas do produto e de cada edição — incluindo o estado vazio de quem
ainda não tem —, os dois atalhos "+ Nova meta"/"+ Meta desta turma" abrindo
o formulário certo já preenchido, e o clique numa meta levando pro KPI
certo). Um teste já existente (`KPI sem lançamento aparece no painel`)
precisou ser reescrito pra apontar por nome exato — o mock de REST usado
nos testes não filtra por `company_id` (devolve a tabela inteira pra
qualquer consulta), então o novo KPI de teste sem lançamento direto passou
a colidir, na mesma página, com o texto do KPI antigo que o teste já
verificava; não é um bug de produção (lá o filtro é de verdade, via RLS +
`.eq()`), só um ponto cego do próprio mock que o teste precisou contornar.
`npm run check:contrast` (24/24) limpo — nenhuma cor nova.

**Fora do escopo desta rodada, por decisão consciente:** o painel da
holding (`HoldingDashboard`) continua lendo só `kpi_latest_values`, que não
traz um KPI sem nenhum lançamento direto — um indicador de empresa que só
existe pra receber soma de produtos (o topo da cadeia de 3 níveis) não
apareceria lá. O pedido desta rodada foi especificamente sobre Produtos e
o card da empresa; se a holding também precisar mostrar esse tipo de
indicador, é um ajuste pequeno e localizado (mesmo padrão de
`CompanyDashboard`: buscar `kpis` além de `kpi_latest_values` e mesclar) —
fica pra quando for pedido.

## 23. Insight diário automático, arquivamento de KPI, lançamento em cadência mais fina e hierarquia de produto pai/sub-produto

Cinco pedidos do usuário, o último deles explícito: "o sistema está
confuso, preciso que seja simples e fácil de enxergar o que é necessário" —
tratado não como item à parte, mas como critério pra construir os outros
quatro (aba separada em vez de mais um filtro, campo condicional em vez de
sempre visível, agrupamento visual em vez de lista solta).

### 1) Insight automático todo dia às 7h + notificação

Mesma Edge Function `ai-insights` do botão "Gerar Insights" — sem duplicar
tabela nem lógica de geração — ganhou um segundo caminho de entrada. Um novo
job `apice_daily_insights` (pg_cron, 10:00 UTC = 7:00 em Brasília) chama a
função uma vez para a holding e uma vez por empresa ativa, assinando com o
mesmo segredo interno (`x-sync-secret`) que `integrations-sync` já usa —
não tem usuário logado às 7h da manhã, então a função aceita ou um Bearer
token (chamada manual, como sempre) ou o segredo (chamada agendada). Isso
exigiu religar `verify_jwt` da função para `false`: com `true`, o gateway do
Supabase rejeita a chamada sem token antes mesmo do código da função rodar
— o mesmo motivo pelo qual `integrations-sync` já roda assim.

Na chamada diária, o prompt pede explicitamente que ao menos um insight
liste as prioridades de hoje (tarefa vencendo ou vencida, meta em risco),
além dos insights de sempre. Depois de gerar, uma notificação no sistema
avisa os administradores (da holding ou da empresa) — sem isso, ninguém
saberia que chegou insight novo até abrir a tela por acaso.

**Bug encontrado testando ponta a ponta:** `parseInsights` pegava o
primeiro `[` e o **último** `]` do texto que a IA devolve. Funciona quando a
resposta é só o array — mas para duas empresas com pouquíssimo dado (uma
sem membro nenhum, outra sem tarefa nem orçamento), a IA respondeu com um
array vazio seguido de uma frase explicando por que não tinha o que dizer,
e essa frase continha outro colchete mais adiante. O corte de "primeiro até
o último colchete" incluía a frase inteira, e `JSON.parse` quebrava com
`Unexpected non-whitespace character after JSON at position 2` — a chamada
pra essas duas empresas retornava 502 em vez de silenciosamente não gerar
nada. Corrigido com um casador de colchetes de verdade (conta profundidade,
ignora colchete dentro de string) em vez do `indexOf`/`lastIndexOf`
ingênuo. Confirmado ao vivo: as mesmas duas empresas passaram a responder
"a IA não gerou insights desta vez" (esperado — pouco dado mesmo) em vez de
quebrar.

**Verificação:** `app.trigger_daily_insights()` chamado manualmente duas
vezes direto no banco (antes e depois do conserto) — a primeira vez expôs o
bug acima em 2 das 4 chamadas (as 2 de holding/empresa-com-dado
funcionaram, geraram insight com o prompt de "prioridades de hoje" e
notificação pro admin certo); a segunda vez, já com `ai-insights` versão 7
implantada, as 4 chamadas resolveram sem erro de parsing. Cron conferido em
`cron.job` (`apice_daily_insights`, `0 10 * * *`, ativo).

### 2) Arquivar KPI depois do prazo (+ manual) — ambiente separado

`kpis.archived_at` (nulo = ativo). Um novo job diário,
`apice_archive_overdue_kpis` (06:00 UTC = 3h em Brasília), arquiva sozinho
todo KPI **com prazo** (é meta) cujo prazo já passou — um KPI recorrente
sem prazo (faturamento mensal, por exemplo) nunca arquiva sozinho, porque
não existe "depois do prazo" pra ele. Arquivar não apaga nada: o histórico
inteiro continua ali, só sai da tela principal.

Na `KpisPage`, cada cartão ganhou um botão de arquivar/desarquivar — e a
lista principal só mostra KPI ativo por padrão. Uma aba "Arquivados",
com a contagem ao lado, **só aparece quando existe pelo menos um** KPI
arquivado — do contrário não acrescenta nada na tela de quem nunca
arquivou (o critério de simplicidade do item 5 aplicado direto aqui).
`kpi_latest_values` ganhou a coluna `archived_at`; toda tela que já lia
essa view (painel da empresa, painel da holding, produtos) passou a
filtrar `archived_at is null`, pra um KPI arquivado não voltar a poluir
contas de saúde geral nem médias.

### 3) Cadência de lançamento mais fina que a frequência do KPI, e quinzenal como opção nova

O pedido: "faturamento é medido por ano, mas eu quero lançar mês a mês".
Resolvido sem tocar no contrato de `kpi_values` (que qualquer tela do
sistema já lê como "uma linha por período") — criada uma tabela separada,
`kpi_value_entries`, pros lançamentos finos, e um gatilho no banco
(`app.rollup_kpi_value_entry`) que soma os lançamentos dentro do período
"grosso" (a frequência de verdade do KPI) e escreve o total em
`kpi_values` sozinho, toda vez que um lançamento fino muda. Nenhum painel,
gráfico ou consulta precisou mudar pra saber somar — continuam lendo
`kpi_values` exatamente como sempre leram.

No formulário do KPI, um campo novo "Lançar em cadência mais fina" só
aparece quando a frequência escolhida tem alguma cadência mais fina que
faça sentido (não dá pra "lançar por ano" uma meta mensal). No "Lançar
valor", quando essa cadência está configurada, o formulário pede a data
dentro do período fino, grava em `kpi_value_entries`, e mostra o total já
acumulado no período grosso antes mesmo de salvar (pra não digitar "no
escuro"). O histórico do KPI ganhou uma lista dos lançamentos finos, cada
um com opção de excluir — excluir também refaz a soma sozinho (o mesmo
gatilho cobre insert, update e delete).

**Quinzenal era pedido explícito** ("diário, semanal, quinzenal, mensal,
anual") e não existia como frequência. Adicionado ao enum `kpi_frequency`
numa migração própria (`0025_biweekly_frequency.sql`) — um valor novo de
enum não pode ser usado na mesma transação em que foi criado, daí o
arquivo à parte. A conta de "que quinzena é essa data" usa uma âncora fixa
(2024-01-01, uma segunda-feira) tanto no banco (`app.coarse_period_bounds`)
quanto no frontend (`periodBounds`, em `core/lib/format.ts`) — as duas
implementações foram comparadas número a número (9 datas, incluindo virada
de ano e datas antes da âncora) via consulta direta no banco de produção, e
bateram em todas. Testes automatizados novos em
`format.test.ts` cobrem os mesmos casos.

### 4) Produto pai e sub-produtos — uma meta que soma outras metas

O exemplo do usuário: "Entre Donos" é o produto (a frente); "Turma de
setembro 2026" é um sub-produto (uma edição específica) com sua própria
meta, que contribui pra meta do produto como um todo. Modelado com
`kpis.parent_kpi_id` — um KPI de sub-produto (tem `product_edition_id`)
pode apontar pra um KPI do produto (sem edição, mesmo `product_id`) como
seu pai. Uma trigger (`app.assert_kpi_parent`) garante só dois níveis (quem
já é filho não pode virar pai de outro) e que pai e filho são da mesma
empresa.

O valor do pai **não é lançado** — é a soma do último valor de cada filho,
calculada no cliente (todo painel que consome KPI já carrega a lista
inteira da empresa na memória, então somar ali é mais simples que criar
outro gatilho no banco pra isso). Na `KpisPage`, o formulário de um KPI de
sub-produto ganha um campo "Contribui para" listando os KPIs elegíveis do
mesmo produto; o cartão do pai mostra a soma, quantos dos N sub-produtos já
lançaram, e a lista deles com o valor de cada um; o cartão do filho mostra
uma etiqueta "contribui p/ {produto}". Na lista, o pai aparece
imediatamente seguido dos próprios filhos, em vez de espalhados pela ordem
alfabética — visual de "produto e suas turmas juntos" sem precisar de
outra tela.

### 5) Simplicidade — critério aplicado, não item à parte

Três decisões de UI vieram direto do "confuso, preciso que seja simples":
a aba de arquivados só existe quando há algo arquivado; a cadência mais
fina e o "contribui para" só aparecem quando fazem sentido pro que já foi
escolhido (frequência, produto, edição) — nunca um campo vazio pedindo
atenção à toa; e os três campos de produto/edição/contribui-para, que antes
ficavam soltos no formulário, foram agrupados numa caixa só (mesmo padrão
visual que a caixa de "vira meta com prazo" já usava), deixando claro que
um é consequência do outro.

**Verificação:** migrações aplicadas em produção via Supabase MCP
(`biweekly_frequency`, `kpi_lifecycle`, `daily_insights_cron`, e um ajuste
de `search_path` em `coarse_period_bounds` depois que `get_advisors`
apontou o mutable path); rollup de `kpi_value_entries` testado direto no
banco (soma de dois lançamentos mensais, recomputação após excluir um,
remoção da linha depois de excluir o último — sem sobrar linha zerada
fantasma); `app.archive_overdue_kpis()` chamado manualmente (retornou 0 —
nenhum prazo vencido nos dados reais no momento do teste).
`get_advisors` (security) conferido depois de cada migração — os mesmos
dois avisos pré-existentes, nenhum novo. `npx tsc --noEmit` e `npm run
build` limpos. `npm run test` subiu de 13 para **19 testes** — os 6 novos
cobrem `periodBounds`/`labelPeriod` de quinzena, que nunca tinham teste
antes desta rodada (os valores foram conferidos um a um contra a mesma
conta rodada de verdade no banco, não só entre si). `npm run
check:contrast` (24/24) limpo — nenhuma cor nova introduzida. `npm run
test:e2e`: **147 testes**, mesmo total de antes desta rodada, todos
passando (o mock de REST em `e2e/fixtures.ts` devolve `[]` pra qualquer
tabela não simulada, então `kpi_value_entries` não precisou de fixture
nova; os campos novos de `Kpi` — `archived_at`, `parent_kpi_id`,
`entry_frequency` — foram checados com `Boolean(...)`/falsy em vez de
`=== null` exatamente por isso, pra dado de teste sem esses campos não ser
lido como "arquivado" por engano).
