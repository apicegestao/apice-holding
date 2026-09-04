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

## 25. Mapa mental virou bloco de notas — privado por usuário

Pedido do usuário: "Transforme o mapa mental em um bloco de notas, será mais
útil. As notas devem ser privadas por usuário." O mapa mental (organograma
arrastável, linha do tempo, "nó vira tarefa") saiu do sistema por inteiro —
conferido antes de mexer que os dados existentes eram só exemplo (1 mapa, 2
nós, nenhuma tarefa vinculada), então não havia nada real pra migrar.

**A diferença que importa não é a interface, é a privacidade.** Todo outro
módulo do sistema usa `app.is_member(company_id)` pra leitura: qualquer
membro da empresa enxerga o dado de qualquer outro membro. Notas quebram
esse padrão de propósito — a policy de select usa só `user_id = auth.uid()`,
então nem um admin da mesma empresa vê a nota de outra pessoa. Escrever
ainda exige `app.is_member(company_id)` (além do dono), só pra não sobrar
nota "órfã" numa empresa de que a pessoa nem faz mais parte — isso não
amplia quem enxerga, só quem pode criar.

Migração `0029_notes_replace_mindmap.sql`: derruba `mind_maps` e
`mind_map_nodes`, remove `tasks.mind_map_node_id`, cria `notes` (title,
body, company_id, user_id) com as duas policies acima.

**Verificação de RLS direto no banco (não dá pra testar isso na e2e, que
roda sempre como um único usuário mockado):** inserida uma nota real
pertencente ao perfil verdadeiro do dono (Rafael); impersonando um UUID
estranho, arbitrário, sem nenhum vínculo com o sistema (`set local
request.jwt.claims`), `select count(*)` na tabela devolveu **0** e um
`update ... returning id, title` devolveu **conjunto vazio** (RLS bloqueou a
escrita, não só escondeu a leitura) — mesmo essa pessoa não tendo perfil
nenhum cadastrado, o que por si só já prova que a regra não depende de
sequer existir uma relação de "mesma empresa" com o estranho. Impersonando
de volta o dono de verdade, o mesmo `select` e o mesmo `update` funcionaram
normalmente. Nota de teste removida depois. `get_advisors` (security):
mesmos dois avisos pré-existentes, nenhum novo.

`supabase/functions/ai-insights/index.ts` tinha um leitor `mapaMental` que
lia as duas tabelas derrubadas — teria quebrado com "relation does not
exist" na primeira geração de insight depois da migração (manual ou no cron
diário das 7h). Removido da lista `MODULE_READERS`, e o `SYSTEM_PROMPT`
deixou de citar "mapas mentais" como fonte de dado. Notas ficam de fora do
retrato da IA de propósito — são privadas até de quem administra a empresa,
então nem a IA que gera insight pro admin lê a nota de outra pessoa; isso
está documentado como comentário no próprio código, pra não ser
"recolocado" por engano num módulo novo no futuro. Função reimplantada
(`verify_jwt: false`, preservado — é a mesma chamada sem usuário logado do
cron).

Frontend: `modules/mindmap/` (1109 linhas, canvas com drag/pan/zoom,
múltiplos layouts) saiu inteiro, substituído por `modules/notes/` (lista
simples: buscar, criar, editar, excluir com confirmação — sem canvas, sem
posição de nó). Rotas antigas (`/holding/mapa-mental`,
`.../mapa-mental`) redirecionam pras novas (`/holding/notas`,
`.../notas`), mesmo padrão já usado quando `/metas` virou `/kpis`. Ícone e
label trocados na sidebar e nos atalhos dos dois painéis (holding e
empresa): `Network` → `StickyNote`, "Mapa mental" → "Notas".

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test`: 26 testes, sem mudança (nenhuma lógica pura nova que precisasse de
teste unitário). `npm run test:e2e`: suíte de mapa mental (2 testes, UI que
não existe mais) trocada por uma suíte de notas (4 testes: lista + aviso de
privacidade, criar e ver aparecer, editar abre preenchido, excluir pede
confirmação); a criação precisou de um mock com estado próprio (como o de
"subtarefas e notas") porque o mock estático de `TABLES` não persiste
`POST`. Teste de CSP com cor dinâmica perdeu a perna de mapa mental (não
tinha mais cor dinâmica nenhuma ali) e passou a cobrir o painel da empresa
no lugar. Total: 190 testes (163 passando, 27 puladas por projeto/rota que
não se aplica), mesmo saldo de antes descontada a troca de módulo. `npm run
check:contrast`: sem mudança (nenhuma cor nova). `get_advisors` (security):
mesmos dois avisos pré-existentes de sempre.

## 26. Bug real: lançar valor em dia diferente não somava o total do KPI

Relato: "6 vendas no dia 02/09 e uma venda no dia 01/09, o sistema permanece
com 6 vendas." Achado direto no banco de produção (não era um dado de
exemplo): o KPI `Vendas - Entre Donos Set.26` — meta de 22, prazo 09/09 —
tinha `frequency = 'daily'` e `entry_frequency` nulo. Os dois lançamentos
existiam mesmo (`kpi_values`: 2026-09-01 = 1, 2026-09-02 = 6), só que como
duas linhas **independentes**, uma por dia.

**Causa raiz:** o período de um KPI `daily` É um único dia
(`period_start = period_end`) — não existe cadência mais fina que "diário"
pra somar dentro dele (`FINER_FREQUENCIES.daily` sempre foi `[]`). Cada
lançamento vira uma leitura isolada daquele dia, e `kpi_latest_values`
(usado por todo o resto do sistema: os dois painéis, os gráficos, o
`kpi_latest_values` em si) sempre mostra só o período **mais recente**
(`distinct on (kpi_id) order by period_start desc`) — nunca soma períodos
diferentes. Isso está certo pra métrica de "estado atual" (ex. estoque
hoje), mas quebra qualquer meta cumulativa lançada dia a dia, que é
exatamente o que uma frequência `daily` com `target_value`/`due_date`
convida a fazer por engano — e é o único jeito de configurar um KPI onde
isso dá errado, porque `daily` não tem como ir mais fino. A ferramenta certa
pra "eu lanço todo dia e quero que some" já existia desde a rodada anterior
(`entry_frequency`, item 25 do relatório antigo — hoje item 77 da lista de
tarefas): configurar `frequency` mais larga (ex. mensal) com
`entry_frequency = 'daily'`, que soma automaticamente via gatilho. O problema
era só não existir nada impedindo alguém de escolher `daily` como frequência
PRINCIPAL, o único caso em que essa ferramenta é matematicamente impossível
de usar.

**Correção (migração `0030_kpi_no_daily_frequency.sql`):** qualquer KPI com
`frequency = 'daily'` (achado com uma consulta ampla — só existia esse um)
migra pra `frequency = 'monthly'` + `entry_frequency = 'daily'`; os
lançamentos diários existentes (já no formato exato de `kpi_value_entries`)
são movidos pra lá, e o próprio gatilho de soma recalcula o total certo do
mês assim que entram. Uma `check constraint` (`frequency <> 'daily'`) trava
a regra no banco — nenhuma tela nova, script ou chamada direta à API
reintroduz o problema. `FREQUENCIES` (frontend, `core/types.ts`) também
perdeu `'daily'` como opção de frequência principal — o seletor "Frequência
de medição" nunca mais oferece a escolha que não tem saída; `'daily'`
continua a única cadência mais fina disponível pra qualquer frequência
restante (`FINER_FREQUENCIES`), que é onde ele faz sentido de verdade.

**Um segundo bug, encontrado testando o primeiro** (migração
`0031_rollup_period_end_fix.sql`): depois de migrar, o total somou certo
(7) mas o `period_end` gravado ficou `2026-09-01` em vez de `2026-09-30` —
o mês inteiro virou "1 dia" na aparência. Causa: o gatilho
`app.rollup_kpi_value_entry()` (0026) atualiza `value`/`source`/`updated_at`
no `on conflict`, mas nunca `period_end` — inofensivo no uso normal (o
`period_end` de um mesmo `period_start` nunca muda de uma soma pra outra),
mas a linha herdada da migração 0030 já existia com um `period_end` de "um
dia só" ANTES de virar `rollup`, e ficou presa nele. Corrigido no próprio
gatilho (`set period_end = excluded.period_end` a mais no `on conflict`) e
reparado com um `update` de uma vez só pra qualquer linha `rollup` que já
tivesse ficado errada (achada com `app.coarse_period_bounds` comparando
contra o valor gravado — só existia essa uma).

**Verificação:** os dois bugs, e a correção de cada um, foram confirmados
direto no banco antes de qualquer coisa ser dada como resolvida — não só
lida no código. Antes da correção: `kpi_latest_values` do KPI mostrava
`value = 6` (a leitura de 02/09, ignorando a de 01/09). Depois: `value = 7`,
`period_start = 2026-09-01`, `period_end = 2026-09-30`. Testado também o
caminho "novo" (não só a migração de dado velho): inserido um terceiro
lançamento (`2026-09-03 = 2`) direto em `kpi_value_entries` — o total foi
pra 9 automaticamente, com o `period_end` certo mantido; removido o
lançamento de teste, o total voltou a 7 sozinho (o gatilho reflete
exclusão também, não só inserção). Testada a `check constraint`: uma
tentativa de `update kpis set frequency = 'daily'` no KPI corrigido foi
rejeitada pelo banco. `get_advisors` (security): mesmos dois avisos
pré-existentes, nenhum novo. `npx tsc --noEmit` e `npm run build` limpos.
`npm run test`: 26 → **28 testes** — os 2 novos travam exatamente a
regressão (`'daily'` fora de `FREQUENCIES`, presente em todo
`FINER_FREQUENCIES`), pra ninguém reintroduzir a opção por engano numa
tela futura. `npm run test:e2e`: 190 testes, mesmo total (nenhuma fixture
usava `frequency: 'daily'`, nenhum teste dependia da opção "Diário" no
seletor de frequência principal). `npm run check:contrast`: sem mudança.

## 27. Painel da empresa: cartões-resumo em carrossel + barras de progresso mais elegantes

Dois pedidos juntos porque os dois mexem no mesmo topo de tela.

**Cartões-resumo em carrossel:** os 4 cartões (KPIs na meta, Metas em
aberto, Tarefas abertas, Tarefas vencidas) do painel da empresa
(`CompanyDashboard`) viravam uma grade que, no celular, empilhava em 4
linhas — a mesma coisa que o painel da holding já tinha resolvido com
`CardCarousel` (item 59/rodada anterior): no celular vira carrossel (arrasta
ou passa sozinho, com os pontinhos embaixo), do tablet pra cima continua
grade normal. Mesmo padrão, letra por letra — os cartões são montados uma
vez só (agora usando `StatTile`, que já existia, em vez dos `<div>` inline
do painel da holding) e reaproveitados nos dois formatos. Resultado: no
celular, o topo da tela cai de 4 fileiras de cartão pra 1 — é o "ganhar
espaço na tela" do pedido.

**Barras de progresso mais elegantes e com meta/performance mais evidentes**
(`ProgressBar`, componente único usado em 15 lugares do sistema — painéis,
KPIs, produtos, orçamentos): trinca de mudanças, todas dentro do componente
compartilhado, então toda barra do sistema ganha de uma vez, sem tocar em
cada tela que a usa.
- **O % sempre aparece agora**, com ou sem `label`. Antes, uma barra sem
  rótulo (bastante comum — cartão de produto, indicador na grade) não
  mostrava número nenhum, só a barrinha; a informação de desempenho que a
  barra existe pra contar ficava muda bem onde mais precisava aparecer.
- **Degradê de severidade em vez de corte binário** (variante `goal`, a
  meta a bater): antes era só verde a partir de 100%, vermelho antes disso;
  agora é vermelho (< 70%), âmbar (70–99%) e verde (≥ 100%) — a régua nova é
  só visual, não mexe no `status` (`at_risk` etc.) que já existe à parte
  pra outras telas. A variante `spend` (execução de orçamento) continua
  binária de propósito: não existe "quase estourando" ali, só estourou ou
  não.
- **Mais peso visual**: barra de 1.5px pra 2px, com sombra interna sutil e
  preenchimento em degradê (mesmo tom, mais claro pro mais escuro) em vez de
  cor chapada; o % ganhou negrito e tamanho maior (`text-sm font-semibold`,
  antes `text-xs font-medium`); a legenda abaixo (`caption`, ex. "R$ 32.000
  de R$ 100.000") também cresceu de 11px pra 12px e saiu do tom mais apagado
  — em vários lugares é ali que o valor da meta aparece por extenso, e
  ficava fácil de passar batido.

Nada na API do componente mudou (`ratio`, `label`, `caption`, `variant`) —
os 15 chamadores continuam exatamente como estavam, ganhando o visual novo
de graça.

**Verificação:** conferido visualmente com screenshot real do painel
(empresa Vibra, dados de fixture) em desktop claro, desktop escuro e
celular — carrossel com os pontinhos funcionando, barras com % em negrito
bem legível nos três casos, faixa vermelha (64%, abaixo de 70%) e verdes
(109%, 115%, 119%, 123%, todas ≥ 100%) renderizando a cor certa. `npx tsc
--noEmit` e `npm run build` limpos. `npm run test`: 28 testes, sem mudança
(mudança é só visual/layout, nenhuma lógica pura nova). `npm run
check:contrast`: 24/24 — as três cores do degradê (`emerald`/`amber`/`rose`
600 no claro, 400 no escuro) já eram usadas em badge e `StatTile` nos
mesmos fundos, nenhum par novo. `npm run test:e2e`: 190 testes, mesmo total,
incluindo o teste geral de "sem rolagem lateral" no celular (que cobre o
carrossel novo) e o de CSP — nenhum teste prende no texto ou na estrutura
interna dos cartões/barra, só no conteúdo visível, que não mudou.

## 28. Sidebar renomeada pra "Metas" + múltiplas metas por produto/edição nos cartões

**Sidebar:** "KPIs e metas" virou só "Metas" — no menu da empresa e no
título da própria página (`PageHeader`). A rota continua `/kpis` (nada
migra, nenhum link quebra) — só o nome visível muda; o módulo interno
continua se chamando `kpis/` (é código, não é o que a pessoa vê).

**Múltiplas metas por produto/edição:** o pedido veio com um exemplo
concreto — "controlar uma turma da imersão" com "vendas de ingressos,
faturamento, cancelamentos, entre outros" ao mesmo tempo. Conferido antes
de mexer: o banco e o formulário de criar meta **já suportavam isso** —
`kpis.product_id`/`product_edition_id` não têm nenhuma restrição de
unicidade, e o modal de detalhe de um produto (`ProductsPage`, item já
existente) já listava TODAS as metas de cada edição, uma a uma, sem
escolher só uma. O que faltava era só nos dois lugares que fazem um
resumo rápido — o cartão do produto (no próprio Produtos, antes de abrir o
modal) e o cartão "Produtos" do painel da empresa — os dois calculavam um
único `primaryMeta` (a que tinha meta definida, senão a primeira que
existisse) e escondiam qualquer outra atrás dele; se as metas viviam só
nas edições (sem nenhuma meta no nível do próprio produto), o cartão nem
mostrava nome nenhum, só uma barra de "saúde da frente" genérica.

Trocado `primaryMeta`/`primaryValue` (um só) por `metas` (lista) nos dois
lugares — a lista junta as metas do produto em si com as de cada edição
dele, e o cartão mostra até 2 delas, com "+ N meta(s)" quando sobra mais
(a lista completa, sempre, já vivia no modal — o cartão é só o resumo).
Como o nome de uma meta de edição pode se repetir entre turmas (ex.
"Faturamento" em toda turma), a linha ganhou um sufixo com o nome da
edição (`· Imersão Setembro 2026`) só quando ela pertence a uma — sem
isso, duas metas de turmas diferentes ficariam com o mesmo texto no
cartão. `CompanyDashboard` precisou passar a buscar `product_editions`
também (só tinha produtos, sem as edições, então não tinha como nomear a
edição de uma meta).

**Efeito colateral pego pelo e2e, não por revisão manual:** um teste que
já existia (`abrir o produto mostra a meta dele e a de cada turma`) parou
de passar — o cartão atrás do modal (mesmo por trás, ele continua no DOM)
passou a repetir o nome da edição que o modal também mostra, e o teste
usava texto solto pra achar o nome da edição, que agora resolve pra dois
elementos. Corrigido escopando pro modal (`getByRole('dialog')`) em vez de
`page` inteira — mesmo motivo por que o link da própria meta já usava
`getByRole('link', ...)` em vez de texto solto, comentado no próprio
teste. Aproveitado pra dar ao `Modal` (`core/ui`) o `role="dialog"` e
`aria-modal="true"` que faltavam — nenhum dos 15 lugares do sistema que
abrem um `Modal` tinha isso, e não é só pro teste: leitor de tela também
passa a anunciar "caixa de diálogo" ao abrir qualquer uma.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test`: 28, sem mudança (mudança é de dado exibido, não de lógica pura
nova). `npm run check:contrast`: sem mudança. `npm run test:e2e`: 190,
mesmo total, incluindo o teste corrigido e o de CSP (que já reflete o
label novo, "Metas", sem precisar editar nada além do fixture). Conferido
com screenshot real (empresa Vibra): cartão de "Entre Donos" no painel e
em Produtos mostrando as duas metas (a do produto, 32%, e a da turma de
setembro, 64%) lado a lado, cada uma com sua própria barra — antes só a
primeira aparecia.

## 29. Separar Meta de Indicador (KPI) — metas como centro do sistema

Pedido do usuário: "Metas são o ponto central do sistema. Indicadores são
as ferramentas de visualização" — empresa, produto e sub-produto deveriam
poder carregar **múltiplas** metas ao mesmo tempo, com os KPIs servindo só
de instrumento de medição por trás delas. Isso já não era possível: desde
a migração `0016_merge_kpis_goals.sql` (item 32 acima), "KPI" e "meta" eram
a mesma linha — um indicador só podia ter uma meta, e quando o prazo dela
vencia o arquivamento automático apagava o indicador inteiro junto (era
essa a causa do bug corrigido mais cedo na mesma sessão: um KPI de vendas
ganhando o mês no próprio nome, "Set.26", porque alguém precisava recriar
o indicador do zero a cada mês).

**Modelo novo:** `kpis` volta a ser só o indicador (nome, unidade,
direção, frequência, produto/edição, categoria, histórico de valores) —
saíram de lá `target_value`, `due_date`, `owner_id` e `status`. Nova
tabela `metas` (`company_id`, `kpi_id`, `target_value`, `due_date`,
`owner_id`, `status`, `archived_at`) guarda cada meta separadamente,
referenciando o indicador que ela mede — um `kpi_id` pode aparecer em 0, 1
ou N linhas de `metas` ao mesmo tempo. `kpi_checkpoints` (repartição
semanal) trocou a chave de `kpi_id` para `meta_id`, já que a repartição é
sobre uma meta específica, não sobre o indicador cru. `parent_kpi_id` (a
cadeia de soma turma → produto, já com profundidade livre desde o item 78)
**não mudou** — rollup de valor é uma conta sobre indicador, ortogonal a
meta.

Duas views, cada uma no seu papel: `kpi_latest_values` (existente) ficou
enxuta — só indicador + último valor, sem nenhum campo de meta.
`meta_latest_values` (nova) — uma linha por META, juntando `metas` +
`kpis` + o último valor do indicador; o mesmo `kpi_id` aparece uma vez por
meta que ele tem. `company_snapshots()` manteve os mesmos nomes de coluna
(`kpis_on_target`/`kpis_off_target`/`goals_*` — o painel da holding lê por
nome), só trocou a origem interna de `kpis`/`kpi_latest_values` para
`meta_latest_values`: um indicador com 2 metas agora conta certo como 2,
não 1. `app.archive_overdue_kpis()` virou `app.archive_overdue_metas()`
(cron `apice_archive_overdue_metas`) — arquiva a **meta** vencida, nunca
mais o indicador; isso é o que fecha o bug de origem.

**Telas:** `KpisPage` separou o cadastro do indicador (nome, unidade,
direção, frequência, produto/edição — tela única, sem fricção) do
cadastro de meta, oferecido opcionalmente na mesma submissão ("Definir uma
meta agora?") ou depois, via "+ Meta" num indicador já existente. Cada
indicador lista suas metas (0, 1 ou N) com prazo/responsável/status/
progresso próprios; a repartição semanal (`MetaFormModal`) passou a operar
sobre uma meta (`meta_id`), não mais sobre o KPI. `CompanyDashboard`,
`HoldingDashboard` e `ProductsPage` trocaram a leitura única de
`kpi_latest_values` por duas fontes: `kpi_latest_values` pro grid puro de
indicadores, `metas`/`meta_latest_values` pra tudo que é meta (lista
"Metas", gráfico "Metas: realizado x alvo", contagem "Metas na meta",
saúde geral) — o padrão de lista "+N meta(s)" do item 28 já servia sem
mudança de estrutura, só trocando a fonte do dado. `ai-insights` (edge
function): o leitor de KPIs devolve indicador + lista de metas aninhada
(era uma linha só, "kpi com meta embutida"); `holdingContext()` passou a
ler `meta_latest_values` para os números de meta consolidados.

**Fora de escopo, documentado no plano:** uma meta acompanhada por mais de
um indicador ao mesmo tempo (ex. "crescer a turma" = ingressos +
faturamento juntos) — os casos concretos citados pelo usuário (ingressos,
faturamento, cancelamentos) já são resolvidos como metas separadas sobre
indicadores separados, sem essa necessidade.

**Verificação:** migração aplicada e conferida por SQL direto — a mesma
empresa (Vibra) usada nos testes já cadastrados. `get_advisors` (security)
antes/depois: mesmos dois avisos pré-existentes (`system_settings` sem
política e proteção de senha vazada desligada), nenhum novo. Smoke test
completo no banco: criado um indicador com 1 lançamento e 2 metas
(mensal, alvo 50.000, e anual, alvo 600.000); `meta_latest_values` mostrou
as duas linhas distintas para o mesmo `kpi_id`, cada uma com seu próprio
`target_value`/`due_date`, e `kpi_latest_values` seguiu com 1 linha só,
sem nenhum campo de meta. Antecipado o prazo da meta mensal pro passado e
rodado `app.archive_overdue_metas()` manualmente: só ela arquivou
(`archived_at` preenchido), a meta anual seguiu ativa e o indicador
manteve `archived_at` nulo — o indicador nunca mais é arquivado só porque
uma meta venceu. Registros de teste removidos ao final, sem órfão (`metas`
sem `kpi_id` válido ou `kpi_values` sem `kpi_id` válido: zero). `npx tsc
--noEmit` e `npm run build` limpos. `npm run test`: 28, sem mudança
(rollup de valor não foi tocado). `npm run check:contrast`: 24/24, sem
mudança (nenhuma cor nova). `npm run test:e2e`: 190 testes — fixture
`KPIS` perdeu os 4 campos de meta, nova fixture `METAS` (tabela crua,
lida por `CompanyDashboard`/`ProductsPage`) e `META_LATEST_VALUES` (view,
lida pela holding) cobrem os mesmos casos de antes; 2 asserções
atualizadas para os rótulos renomeados ("Metas: realizado x alvo", "Metas
na meta por empresa"). Rodada completa: 159 passaram de cara, 4 falharam
por queda transitória do servidor de preview local perto do fim de uma
suíte longa (`ERR_CONNECTION_REFUSED`, não relacionado à mudança) —
confirmado reexecutando só esses 4 isoladamente: passam (23/23 no arquivo
de segurança, incluindo os 4). `ai-insights` reimplantado na função viva
(`deploy_edge_function`).

## 30. Meta só na empresa — produto e turma viram medição pura

Realinhamento do usuário logo depois do item 29: "empresa tem meta de
faturamento, vendas... produto contribui pra meta da empresa, sub-produto
contribui pra meta do produto, que contribui pra meta da empresa" — com o
exemplo concreto de a empresa (Mesa dos Donos) ter o produto "Entre Donos"
(evento), que tem sub-produtos (as turmas). A separação recém-feita entre
indicador e meta (item 29) tinha aberto meta em **qualquer** nível — de
empresa, de produto ou de turma —, o que reintroduzia a complexidade que
essa visão queria evitar. Decisão confirmada (`AskUserQuestion`): meta só
pode existir em indicador de empresa inteira (`kpis.product_id is null`);
produto e turma viram nós de medição pura, mostrando só o valor (via a
cadeia `parent_kpi_id`/"Contribui para", que não muda nada).

**Achado antes de mexer:** já existia 1 meta de produção violando a regra
nova — um indicador "Entre Donos (09/26)" de produto (empresa MDD,
produto "Mesa Dos Donos"), criado minutos antes desta conversa, com meta
própria (alvo 22, prazo 09/09). Confirmado com o usuário (`AskUserQuestion`)
antes de tocar: excluída a meta, o indicador em si ficou intacto.

**Modelo novo:** novo trigger `metas_company_level_guard` em
`public.metas` (`app.assert_meta_kpi_company_level()`), rejeitando
qualquer insert/update de meta cujo `kpi_id` aponte pra um indicador com
`product_id` preenchido. RLS não muda — é regra de negócio, não de
tenancy. `kpis.product_id`/`product_edition_id` e a cadeia `parent_kpi_id`
seguem exatamente iguais — só quem pode *ter uma meta* muda.

**Telas:**
- `KpisPage`: a checkbox "Definir uma meta agora" e o botão "+ Meta" só
  aparecem quando o indicador não tem produto; trocar de produto no meio
  do cadastro desliga a checkbox sozinha; `submitKpi` ganhou uma segunda
  guarda antes do gatilho do banco.
- `CompanyDashboard`/`ProductsPage`: o cartão de produto e o modal de
  detalhe trocaram a lista de metas (nome + alvo + barra) por uma lista de
  indicadores puros (nome + valor, via `effectiveValue`, sem barra) — sem
  meta, não tem mais nada pra comparar naquele nível. "Metas deste
  produto" virou "Indicadores deste produto"; "+ Meta desta turma" virou
  "+ Indicador desta turma"; o mesmo atalho `?novo=1&product_id=...`
  continua levando pro formulário de KPI, só que criando um indicador
  puro em vez de uma meta.
- `ai-insights`: sem mudança — já lia metas de forma agnóstica de nível.

**Fora de escopo:** nenhuma mudança na cadeia de soma de valor
(`parent_kpi_id`, `buildChildrenByParent`/`effectiveKpiValue`) — ela já
tinha profundidade livre e já era exatamente o mecanismo "turma soma no
produto, que soma na empresa" que a visão do usuário descreve.

**Verificação:** preflight por SQL achou a 1 meta de produção citada acima
(excluída com autorização do usuário antes da migração). Migração
aplicada; smoke test — tentativa de inserir meta num kpi de produto
rejeitada pelo trigger (mensagem de erro clara), meta num kpi de empresa
inserida e removida sem deixar rastro. `get_advisors`: mesmos dois avisos
de sempre, nenhum novo. `npx tsc --noEmit` e `npm run build` limpos após
cada arquivo tocado. `npm run test`: 28, sem mudança (rollup de valor não
foi tocado). `npm run check:contrast`: 24/24, sem mudança. `npm run
test:e2e`: describe `'metas de produto e sub-produto'` virou `'indicadores
de produto e sub-produto'` (5 testes reescritos pro valor puro, sem alvo);
fixture `METAS`/`META_LATEST_VALUES` perdeu as duas entradas de
produto/turma (`META_PRODUCT`/`META_EDITION`), mantendo `KPI_PRODUCT`/
`KPI_EDITION` como indicador puro. Suíte completa: 190 testes, sem
falhas.

---

## 32. Nomenclatura única "Meta"/"Alvo" + consolidar criação via Produtos

Duas confusões apontadas pelo usuário depois da rodada anterior: (1) dois
jeitos de criar a mesma coisa — o botão "Novo KPI" na página Metas deixava
escolher produto/turma num dropdown, e os links de dentro de Produtos
levavam pro mesmo formulário pré-preenchido, com experiências diferentes
(um abre aba de sugestões, o outro pula direto pro form); o usuário prefere
claramente o caminho de Produtos. (2) três palavras — "KPI", "indicador" e
"meta" — pra uma coisa só, mesmo depois das rodadas anteriores terem
corrigido parte disso.

Confirmado com o usuário (`AskUserQuestion`, 3 perguntas): tirar o seletor
de produto do fluxo de criação da página Metas (criar pra produto/turma só
acontece de dentro de Produtos, que ganha um atalho de editar em cada
linha); padronizar o texto visível pra usar só **"Meta"** no lugar de
"KPI"/"indicador" (o `Kpi`/tabela `kpis` de sempre); e, como isso colide
com o uso atual de "meta" pro alvo/prazo/responsável, chamar essa segunda
coisa de **"Alvo"** (o `Meta`/tabela `metas` de sempre). Escopo
deliberadamente restrito a texto + fluxo de criação — nenhuma migração de
banco, nenhuma mudança de rota (`/kpis` continua), tipo ou nome de
variável/coluna.

**Consolidar criação (`KpisPage.tsx`):** novo estado
`launchedFromProduct`, setado só pelo efeito de `?novo=1` (o atalho vindo
de Produtos); a caixa "Produto e sub-produto" só aparece quando
`launchedFromProduct` é `true` ou, editando, quando a meta já tem produto
(`editingKpi.product_id`). O botão "Nova Meta" do topo e o do estado vazio
continuam chamando `openCreate()` sem esse parâmetro — nunca mostram a
caixa, sempre criam meta de empresa.

**Editar direto de Produtos:** novo parâmetro `?kpi=<id>&editar=1`, lido
por um efeito dedicado em `KpisPage.tsx` que chama `openEdit` e remove só
o `editar` da URL (mantém `kpi=` pro highlight de sempre). `ProductsPage`
ganhou um ícone de lápis (`Pencil`) ao lado do link de nome/valor em cada
linha (produto e cada turma), apontando pra essa URL — como um `<Link>`
não aninha outro, cada `<li>` virou um flex com dois links irmãos.

**Renomear texto:** troca de "KPI"/"indicador" por "Meta" (concordância
feminina) e de "meta" (alvo/prazo/responsável) por "Alvo" (concordância
masculina) em `KpisPage.tsx`, `KpiSuggestions.tsx`, `ProductsPage.tsx`,
`CompanyDashboard.tsx`, `HoldingDashboard.tsx`, `IntegrationsPage.tsx`,
`CompaniesPage.tsx`, `LoginPage.tsx`, `InsightsPage.tsx` e
`core/types.ts` (`ROLE_HINT.collaborator` + comentário de aviso da
inversão perto dos tipos `Kpi`/`Meta`). Duas colisões de nome resolvidas
com uma tabela de decisão: "Metas na meta" → "Metas no alvo"; "Metas em
aberto"/"em risco" → "Alvos em aberto"/"em risco"; card de valor puro
("Indicadores") → "Metas"; card de acompanhamento de alvo ("Metas") →
"Alvos". `supabase/functions/ai-insights/index.ts`: `SYSTEM_PROMPT`
reescrito pra ensinar a IA a chamar a coisa medida de "meta" e o
alvo/prazo/responsável de "alvo", proibindo "KPI"/"indicador" no texto
gerado; frase do resumo diário (prioridades de HOJE) também atualizada.
Redeploy feito (`ai-insights` v10, `verify_jwt: false` preservado — mesma
chamada sem usuário logado do pg_cron de sempre).

**Fora de escopo, deixado como está:** comentários internos de código
(ex. `// Indicador: o que se mede...` em `core/types.ts`) e nomes de
tipo/tabela/coluna/variável (`Kpi`, `kpis`, `kpi_id`, `kpiForm` etc.) — a
troca é só do texto que o usuário vê, como decidido com o usuário.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos após cada
arquivo tocado. `npm run test`: 28, sem mudança. `npm run check:contrast`:
24/24, sem mudança (nenhuma cor tocada). Varredura final
(`grep -rn "KPI\|Indicador\|indicador" src/`) só encontrou comentários
internos e nomes de identificador — nenhuma string visível esquecida.
`get_advisors`: mesmos dois avisos de sempre (RLS sem policy em
`app.system_settings`, proteção de senha vazada desligada), nenhum novo —
sem mudança de banco nesta rodada. `npm run test:e2e`: describe
`'indicadores de produto e sub-produto'` virou `'metas de produto e
sub-produto'` (textos atualizados + 2 testes novos: lápis de editar em
Produtos abre edição direto; `?kpi=<id>&editar=1` abre edição sem clique
extra); describe `'atalho de KPI a partir de Produtos'` virou `'atalho de
meta a partir de Produtos'` (+ 1 teste novo: botão "Nova Meta" do topo não
mostra a caixa de produto/sub-produto); `HoldingDashboard`: assinatura do
gráfico "Metas na meta por empresa" atualizada pra "Metas no alvo por
empresa"; fixture `INSIGHTS` com os dois `body` de exemplo reescritos pro
vocabulário novo. Suíte completa: 169 testes passando, 27 skipped (mesmos
de sempre, condicionais de plataforma), sem falhas.

Geração de insight de verdade pela `ai-insights` continua na mesma
situação das rodadas anteriores (item 3 no topo deste documento): depende
de rede + chave de API configurada, não exercitada de ponta a ponta neste
ambiente — o redeploy em si foi confirmado pela resposta da própria API de
deploy (`status: ACTIVE`, versão incrementada).

---

## 33. Metas em cascata — cartão único por indicador, alvo em todo nível

O usuário trouxe uma visão diferente da página de Metas: em vez de cada
nível (empresa/produto/turma) de um indicador virar um cartão separado
numa grade corrida (ligados só por uma badge "contribui p/ X"), ele quer
**um cartão só por indicador** (Faturamento, Ticket Médio...), que cresce
verticalmente — o valor da empresa no topo, os produtos que contribuem
aninhados dentro, as turmas de cada produto aninhadas mais um nível
abaixo. Isso também expôs (e resolveu) dois problemas que nem tinham sido
citados: o campo manual "Contribui para" virou desnecessário quando a
criação já acontece de dentro do cartão certo; e a página de Produtos, que
misturava cadastro com métricas, virou cadastro puro.

Confirmado com o usuário (`AskUserQuestion`, respostas recomendadas):
alvo passa a existir em **todo nível** (antes só em empresa); os
cartões-resumo do topo do painel (empresa e holding) continuam contando
só alvo de empresa inteira, sem misturar produto/turma; o atalho de
vincular vários indicadores de uma vez fica no form de editar produto
(nível produto) e num botão "Metas" em cada turma (nível turma); o
cartão compacto "Produtos" do painel da empresa continua só com valor.

**Migração `0034_metas_todo_nivel.sql`:** remove o gatilho
`metas_company_level_guard`/função `app.assert_meta_kpi_company_level()`
(única coisa no banco que impedia alvo em produto/turma) e redefine
`company_snapshots()` com `and mv.product_id is null` na subquery lateral,
mantendo os totais do painel da holding escopados a alvo de empresa.
**Achado durante a implementação:** o RPC não é a única fonte desses
resumos — `CompanyDashboard.tsx` e `HoldingDashboard.tsx` também calculam
`stats`/`overallHealth`/`kpiAttainment`/`attainment`/`kpiHealth` etc.
direto no cliente, a partir de `metas`/`meta_latest_values` sem filtro
nenhum de produto. Corrigido nos dois: `metaRows`
(`CompanyDashboard.tsx`) e o `setMetas` de carga (`HoldingDashboard.tsx`)
agora filtram `product_id === null` na origem, antes de qualquer conta —
os cartões-resumo do painel continuam com o mesmo significado de sempre.

**`KpisPage.tsx`:** rollup consolidado em `core/lib/kpiRollup.ts`
(`buildChildrenByParent`/`effectiveKpiValue`), mesma função que
`ProductsPage.tsx` já usava — a reimplementação local foi removida.
Cartão vira um componente recursivo (`renderNested`, `depth` 1 = produto,
2 = turma, sem limite real) — recolhido por padrão, expande por clique;
`Alvos` aparece em todo nível (removidos os três gates que espelhavam o
gatilho do banco: o botão "+ Alvo", a checkbox "Definir um alvo agora", e
a segunda guarda em `submitKpi`). A caixa "Produto e sub-produto"
(incluindo o "Contribui para" manual) saiu do modal principal — ele só
cria/edita meta raiz de empresa agora; editando uma meta que já tem
produto, mostra uma linha somente-leitura ("Vinculado a: X · Y") em vez de
selects. Novo `AttachProductModal` ("+ Vincular produto"/"Vincular
turma") cria o vínculo com um produto/turma já cadastrado direto de
dentro do cartão certo — sem escolha manual de pai, ele já é sabido pelo
contexto. Removidos: `launchedFromProduct`, os efeitos de `?novo=1` e
`?kpi=&editar=1` (Produtos não linka mais pra cá). O efeito de `?kpi=<id>`
(scroll+destaque) ganhou um passo extra: sobe a cadeia `parent_kpi_id` do
alvo e expande cada ancestral antes de rolar, senão o item focado fica
escondido num bloco recolhido.

**`ProductsPage.tsx`:** removida toda a UI de criar/editar meta (o link
"+ Meta", os lápis de editar, o "+ Meta desta turma") — vira uma lista só
de leitura (nome + valor, link só de navegação). Novo
`AttachIndicatorsSection` (checkbox por meta raiz já existente — sempre
recalculado, nunca fixo — + opção de criar uma nova pelo catálogo/nome
livre, reaproveitando `<KpiSuggestions>`) embutido no form de editar
produto (nível produto) e num modal aberto por um novo botão "Metas" em
cada linha de turma (nível turma). Um envio só cria (se houver) as metas
novas e depois todos os vínculos, num segundo insert em lote.

**`ai-insights`:** o leitor de `kpis` ganhou `product_id`/
`product_edition_id`/`parent_kpi_id` no select + busca de nomes de
produtos/edições, expondo `nivel`/`produto`/`edicao` em cada item do JSON
(mesmo tratamento aplicado em `holdingContext()`, que tinha a mesma
lacuna). `SYSTEM_PROMPT` ganhou um parágrafo explicando a cascata de 3
níveis e proibindo comparar/somar alvos de níveis diferentes como se
fossem o mesmo objetivo. Redeploy feito (`ai-insights` v11).

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos após cada
arquivo tocado. `npm run test`: 28, sem mudança. `npm run check:contrast`:
24/24, sem mudança. `get_advisors` (security + performance): mesmos
avisos de sempre, nenhum novo — confirmado também via
`select proname from pg_proc where proname =
'assert_meta_kpi_company_level'` retornando vazio após a migração.
`npm run test:e2e`: fixtures ganharam `META_PRODUCT`/`META_EDITION` (alvo
de produto e de turma, sobre `KPI_PRODUCT`/`KPI_EDITION`) e `KPIS` passou
a ser exportado; describe `'metas de produto e sub-produto'` reescrito
pra cadastro puro + lista de leitura + os dois atalhos de vincular (com
mock de estado próprio pro POST em `kpis`, seguindo o mesmo padrão já
usado pelo teste de notas); novo describe `'cascata de metas (KpisPage)'`
cobrindo o modal principal sem seletor nenhum, alvo em todo nível dentro
do cartão aninhado, e "+ Vincular produto". Suíte completa: 167 testes
passando, 27 skipped (mesmos de sempre, condicionais de plataforma), sem
falhas.

Geração de insight de verdade pela `ai-insights` continua na mesma
situação das rodadas anteriores (item 3 no topo deste documento) — não
exercitada de ponta a ponta neste ambiente; o redeploy em si foi
confirmado pela resposta da própria API de deploy (`status: ACTIVE`,
versão incrementada).

## 34. Três bugs relatados no uso real da cascata de metas

Logo depois do item 33 ir ao ar, o usuário relatou três problemas usando
a tela de verdade: (1) criar uma meta pelo fluxo padrão ("Usar
sugestões") não deixava definir o valor do alvo — só existia dentro da
aba "Criar o meu"; (2) o valor do alvo ficava escondido no cartão — só
aparecia dentro da legenda da barra de progresso, que nem existe sem um
valor medido lançado antes; (3) ao tentar preencher o alvo, o campo
"Andamento" atrapalhava e cancelar a janela travava a tela por completo,
exigindo recarregar a página.

**Bug 1 — alvo na criação por sugestões.** O caminho "Usar sugestões" (a
aba padrão) nunca teve a caixa "Definir um alvo agora" — só a aba "Criar
o meu" tinha. `KpisPage.tsx`: quando exatamente uma sugestão está
marcada (com várias, não haveria a qual delas aplicar o valor), a mesma
caixa passa a aparecer também ali, reaproveitando o estado
`wantsInitialMeta`/`metaDraft` já existente. `addChosen` ganhou
`.select('id')` no insert dos indicadores e, se o alvo foi pedido, insere
a `meta` logo em seguida usando o id do indicador recém-criado — mesma
validação de prazo obrigatório do fluxo "Criar o meu". Botão do rodapé
muda pra "Adicionar meta e alvo" quando aplicável.

**Bug 2 — valor do alvo escondido.** Em `renderAlvoSection`, a linha de
cada alvo mostrava só responsável e prazo — o valor buscado só existia
dentro do `caption` da `ProgressBar` (que só renderiza quando já há um
valor medido pra comparar, ou seja: nunca num alvo recém-criado). Agora o
valor do alvo é a informação principal, em destaque (`text-sm
font-semibold`) acima de responsável/prazo, sempre visível — a barra de
progresso com a legenda "X de Y" continua existindo como detalhe
adicional quando há valor medido.

**Bug 3 — campo "Andamento" atrapalhando e tela travando ao cancelar.**
Não foi possível reproduzir o travamento em si neste ambiente (só
Chromium disponível; o relato sugere um dispositivo/navegador
específico), mas duas coisas concretas saltaram aos olhos e foram
corrigidas:
- No formulário do `MetaFormModal` ("Novo alvo"/"Editar alvo"), "Alvo" e
  "Andamento" ficavam exatamente na mesma coluna de uma grade 2×2 (Alvo
  em cima, Andamento embaixo) — a formação mais propensa a um toque errado
  encostar no campo errado (ex. teclado virtual reposicionando a tela no
  celular). O formulário foi reordenado: "Alvo" agora fica sozinho, em
  destaque, logo no topo (é o campo mais importante); "Prazo" e
  "Responsável" dividem a linha seguinte; "Andamento" fica isolado por
  último, com uma dica explícita ("Não é o valor medido — isso é lançado
  à parte, no cartão da meta") pra não confundir com lançar um valor.
- **Não havia nenhum `ErrorBoundary` no app inteiro.** Sem um, qualquer
  erro não tratado durante a renderização derruba a árvore do React
  inteira e deixa a tela em branco/travada, sem forma de sair a não ser
  recarregar na unha — exatamente o sintoma relatado. Novo
  `src/core/ui/ErrorBoundary.tsx`, envolvendo `<App />` em `main.tsx`:
  qualquer erro futuro (deste fluxo ou de qualquer outro) agora cai numa
  tela de recuperação com um botão "Recarregar página", em vez de travar
  em silêncio.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test`: 28, sem mudança. `npm run check:contrast`: 24/24, sem mudança.
`npm run test:e2e`: dois testes novos no describe `'cascata de metas
(KpisPage)'` — um cobrindo o bug 1 (escolher uma única sugestão, marcar
"Definir um alvo agora", confirmar que a meta e o alvo saem criados
juntos) e outro cobrindo o bug 2 (o valor do alvo aparece no cartão de um
indicador sem nenhum valor lançado ainda). Suíte completa: 171 passando,
27 skipped, sem falhas (Desktop e Mobile 390).

## 35. Editar produto/turma de dentro do cartão + layout da linha aninhada

Dois pedidos do usuário depois de já estar usando a cascata de metas no
dia a dia: (1) não havia como editar o nome/prazo de uma turma (sub
produto) — só existia criar; (2) ao expandir uma turma dentro do cartão
de uma meta, os ícones de ação (histórico/editar/arquivar/excluir)
caíam numa segunda linha praticamente vazia, só com os ícones encostados
à direita — layout "com uma barra alta e praticamente vazia".

**Editar produto/turma.** `product_editions` (e `products`) nunca tiveram
um jeito de editar nome/datas depois de criados — só a página de Produtos
tinha "Editar produto" (nome/descrição), e turma nunca teve edição
nenhuma. Novo `EditEntityModal` em `KpisPage.tsx`: um lápis "Editar
turma"/"Editar produto" (ícone `SquarePen`, distinto do lápis "Editar" já
existente pra editar a meta em si) aparece no cabeçalho de todo nó
aninhado que tem `product_id` — abre um formulário curto (nome + início/
fim pra turma; nome + descrição pra produto) e grava direto em
`product_editions`/`products`. Fica só na tela de Metas por enquanto (não
duplicado em Produtos) — é o mesmo dado, um lugar só de editar evita
divergência.

**Layout da linha aninhada.** O cabeçalho de cada produto/turma era um
`<button>` cobrindo a linha inteira (chevron + nome + valor); os ícones
de ação, por não poderem ficar dentro de um `<button>`, iam pra um `<div>`
inteiro só deles, abaixo, quando expandido — daí a barra vazia. Reescrito
pra uma única linha `<div>` com o botão de expandir cobrindo só
chevron+nome+badge (não mais a linha inteira), e ao lado — fora do botão —
o novo lápis de editar produto/turma (sempre visível), o valor, e os
ícones de ação de sempre (histórico/editar/arquivar/excluir), estes só
quando o nó está expandido. A segunda linha vazia deixou de existir.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test`: 28, sem mudança. `npm run check:contrast`: 24/24, sem mudança.
`npm run test:e2e`: dois testes novos — um conferindo que expandir uma
turma não deixa nenhum `<div>` só de ícones vazio no meio do caminho, e
outro exercitando o lápis "Editar turma" de ponta a ponta (abre o modal,
salva um nome novo, confirma refletido no cartão). Suíte completa: 175
passando, 27 skipped, sem falhas (Desktop e Mobile 390).

## 36. Organizar a página de Metas — resumo no topo, busca e hierarquia

Usuário pediu ajuda pra deixar a página de Metas "mais organizada, de
fácil entendimento" depois de já ter validado o formato em si (cascata de
cartões). Perguntado o que priorizar agora, escolheu três frentes:

**Resumo no topo.** Novo `StatTile` (mesmo padrão visual já usado nos
painéis, com uma cópia local aqui — igual já acontece entre
CompanyDashboard/HoldingDashboard) mostra 4 números logo abaixo do
cabeçalho: "Alvos ativos" (todo alvo não arquivado, em qualquer nível),
"Atingidos", "Em risco" e "Não atingidos" (contagem pelo campo
`status` de cada alvo). Diferente dos cartões-resumo dos painéis (que
contam só alvo de empresa inteira, de propósito — ver item 34), aqui a
ideia é o oposto: refletir tudo que a própria tela mostra, em qualquer
nível, já que a tela inteira é sobre esses alvos.

**Busca por nome.** Campo de busca ao lado do filtro por produto já
existente. Acha a família (cartão raiz) se o termo bater com o nome da
própria meta OU com o nome de um produto/turma vinculado em qualquer
profundidade (`familyMatchesSearch`, mesmo padrão recursivo de
`hasProductInTree` já usado pelo filtro de produto) — não dá pra "abrir"
só uma turma que bateu, então a família inteira aparece.

**Hierarquia mais visível.** O recuo de produto/turma aninhado era só
`marginLeft: 12px` por nível, sem nenhuma ligação visual entre pai e
filho. Trocado por uma guia vertical (`border-l-2`) à esquerda da lista
de turmas dentro de um produto (a partir do 2º nível de profundidade — o
1º nível, produtos dentro do cartão raiz, já está visualmente contido
pelo próprio `Card`), deixando claro que aquele grupo pertence ao
produto acima.

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test`: 28, sem mudança. `npm run check:contrast`: 24/24, sem mudança.
`npm run test:e2e`: três testes novos (resumo mostra a contagem certa por
andamento; busca filtra pelo nome da própria meta; busca filtra pelo nome
de uma turma vinculada). Suíte completa: 181 passando, 27 skipped, sem
falhas (Desktop e Mobile 390). Conferência visual por screenshot: resumo,
busca e cartão aninhado renderizando como esperado.

## 37. Reformulação estrutural — Visão Geral (lista) + Detalhe (drill-down)

Depois de três rodadas de ajuste incremental no cartão único com accordion
aninhado, o usuário voltou: "Tá confuso demais ainda... Repense toda a
página de metas... pensando como um especialista em metas". Pediu uma
imagem da proposta antes de qualquer código — feita como um canvas de
design (duas telas, dados de exemplo), aprovada ("Gostei. Vamos aplicar")
e só então implementada.

**A mudança é estrutural, não mais um ajuste de detalhe.** O modelo antigo
— um cartão por indicador-raiz, crescendo verticalmente com accordions
aninhados pra produto→turma dentro do mesmo cartão — vira duas telas:

**Visão Geral (lista).** Uma linha por meta, agrupada por categoria — nada
aninhado aparece aqui. Cada linha mostra nome + quantos produtos ela tem
por baixo ("Empresa + 2 produtos", sem detalhar quais), valor atual, alvo
mais próximo do prazo, barra de progresso, status, prazo e responsável.
Resumo do topo virou uma barra segmentada (Atingido/Em andamento/Em
risco/Não atingido) com legenda — mantém a ideia do item 36, só troca 4
quadrados por uma barra. Busca e filtro por produto (item 36) continuam;
ganhou filtro por categoria (sempre a partir das categorias em uso de
verdade, nunca uma lista fixa).

**Detalhe (drill-down por breadcrumb).** Clicar numa linha da lista — ou
numa linha da tabela de quebra dentro do próprio Detalhe — navega pra
`/kpis/:kpiId`, não expande nada inline. O breadcrumb no topo (`Metas /
Faturamento / Entre Donos / Imersão Set-2026`) sempre mostra onde você
está, subindo a cadeia por `parent_kpi_id`. O bloco de destaque do nível
atual tem um anel de progresso (cor por atingimento: verde ≥100%, âmbar
≥70%, vermelho abaixo), o valor grande, a lista completa de alvos deste
nível (pode ter mais de um — ex. alvo mensal e anual), um mini-gráfico de
tendência e as ações (Lançar valor, Editar, Histórico, Arquivar, Excluir,
Editar produto/turma). Abaixo, "Como este número se divide" é uma tabela
de quebra dos filhos diretos (produtos, ou turmas se já estiver dentro de
um produto) — cada linha repete o mesmo padrão (valor/alvo/progresso/
status/prazo) e um clique desce mais um nível. Sem filhos, aparece só um
botão de vincular no lugar da tabela.

**Arquitetura do código:** `KpisPage.tsx` virou o container — carrega os
dados (inalterado) e guarda o estado de todos os modais compartilhados
(criar/editar meta, alvo, lançar valor, histórico, vincular produto/
turma, editar produto/turma), montando um objeto `KpisCtx` com tudo que
as duas telas precisam pra renderizar (dados + funções, sem duplicar
lógica). Decide qual tela mostrar pelo `:kpiId` da rota (nova rota opcional
`kpis/:kpiId` em `App.tsx`, ao lado da já existente `kpis`).
`MetasOverview.tsx` (lista) e `MetaDetail.tsx` (drill-down) são novos
arquivos, só apresentação. O antigo efeito de `?kpi=<id>` (scroll +
destaque + expandir ancestrais) deixou de existir — os 5 links que
apontavam pra ele (CompanyDashboard, HoldingDashboard, ProductsPage) agora
apontam direto pra `/kpis/<id>`, que já abre o Detalhe daquele nó exato,
sem precisar rolar nem expandir nada.

**Bug real encontrado durante o rodada:** `canAttachChild` (decide se
"Vincular produto/turma" aparece) comparava `kpi.product_edition_id ===
null` — falha quando o campo vem `undefined` (ausente) em vez de `null`,
caso de várias linhas de teste que nunca setaram esse campo explicitamente
(e, por extensão, de qualquer indicador de empresa antigo no banco real
sem esse campo populado). Trocado por checagem de falsidade
(`!kpi.product_edition_id`), mesmo padrão já usado em outros lugares do
arquivo pro mesmo motivo.

**Acessibilidade, achada ao escrever os testes:** a linha inteira da
lista/tabela é um `<Link>` — sem um `aria-label` próprio, o nome acessível
do link vira TODO o texto da linha concatenado (nome+valor+alvo+status+
prazo+responsável), ruim tanto pra leitor de tela quanto pra teste. Cada
linha ganhou um `aria-label` resumido (nome, valor atual, alvo e status).

**Verificação:** `npx tsc --noEmit` e `npm run build` limpos. `npm run
test`: 28, sem mudança. `npm run check:contrast`: 24/24, sem mudança.
`npm run test:e2e`: describe `'cascata de metas (KpisPage)'` inteiro
reescrito como `'Metas — Visão Geral e Detalhe'` (lista agrupada por
categoria, navegação por linha, breadcrumb + quebra por produto/turma no
Detalhe, editar turma, vincular produto sem filhos, alvo sem lançamento,
resumo em barra, busca, filtro por categoria — 11 testes), mais o teste de
clique em Produtos atualizado pra a nova URL sem query string. Suíte
completa: 183 passando, 27 skipped, sem falhas (Desktop e Mobile 390).
Conferência visual por screenshot contra o app rodando de verdade (não só
o mock de teste) confirmou o layout — achado e corrigido nessa conferência:
a coluna de nome da lista/tabela estava sendo espremida demais dentro do
`min-w` do wrapper de rolagem horizontal; corrigido com `minmax(240px,
2fr)` no lugar de `2fr` puro nas duas tabelas.

## 38. Repartir alvo por qualquer período, editar lançamento/turma, contribuição %, gráficos da holding, revisão de responsividade

Lista de 8 pedidos do usuário numa tacada só. Dividido em frentes paralelas
(3 agentes em background — Produtos, gráficos da holding, revisão de
usabilidade fora de Metas — enquanto a parte mais delicada, em `KpisPage.tsx`/
`MetaDetail.tsx`, foi feita em série):

**1. "Vincular a metas" em Produtos — era intencional, não erro.** Conferido
pelo histórico (`04adfc8`, tarefa da rodada "cascata de metas") e pela lista
de tasks do projeto: o atalho de vincular um produto/turma a várias metas de
uma vez, de dentro do form de editar produto, foi combinado numa rodada
anterior e mantido de propósito na reformulação da tela de Metas (que só
mexeu em `KpisPage.tsx`/`MetasOverview.tsx`/`MetaDetail.tsx`, nunca em
`ProductsPage.tsx`). O que estava bagunçado era a UI: um segundo
`btn-primary` competindo com o "Salvar" do form, botão "Vincular" aparecendo
mesmo sem nada pra vincular, e "+ Criar uma meta nova" com peso visual
desproporcional ao lado do botão grande. Reestruturado: botão de vincular
secundário (`btn-ghost`) na versão inline do form de produto, no `footer` do
`Modal` (mesmo padrão do `AttachProductModal` de Metas) na versão em modal
próprio de turma, oculto quando não há nada pra vincular.

**2. Editar sub-produto (turma).** `product_editions` só tinha criar,
mudar status e excluir — sem como corrigir nome/data depois. Adicionado
lápis de editar por turma, reaproveitando o mesmo form (alterna entre
"Adicionar edição"/"Salvar edição"), com mensagem amigável pro erro de
nome duplicado (`unique(product_id, name)`, código `23505`).

**3-4. Repartir alvo por qualquer período + progresso/% por parcela.**
Antes só existia "Repartir por semana", com parcela ACUMULADA (semana 1
pedia uma fatia do total, a última pedia o total inteiro — só dava pra
comparar contra o valor corrente do indicador). Duas mudanças:

- Migração `0035_checkpoint_periodicidade.sql`: novo enum
  `checkpoint_frequency` (dia/semana/quinzena/mês/bimestre/trimestre/
  semestre/ano) e coluna `kpi_checkpoints.frequency` — independente de
  `kpis.frequency`/`entry_frequency` (repartir o CRONOGRAMA do alvo é uma
  decisão diferente de com que cadência o indicador é medido).
- `splitTargetIntoPeriods` (novo, `core/lib/format.ts`) generaliza a
  divisão pra qualquer periodicidade — mensal/bimestral/trimestral/
  semestral/anual avançam por mês de calendário de verdade (fevereiro tem
  28 dias, não 30); dia/semana/quinzena avançam por dias fixos, mesma
  convenção de `periodBounds`. **Mudança de semântica, deliberada e
  alinhada ao exemplo do próprio usuário** ("R$ 100.000 em 4 meses = 4x
  R$ 25.000"): cada parcela agora é uma COTA IGUAL do período (não mais
  acumulada) — a última parcela absorve o resto do arredondamento, pra
  soma bater exato com o total.
- Progresso por parcela: `sumValuesInRange` (novo) soma os lançamentos
  cujo período cai dentro do intervalo da parcela — a cota real lançada
  naquele pedaço do cronograma, não o valor corrente/acumulado do
  indicador. Antes ficava espremido numa lista de `<li>` dentro do modal
  (`max-w-md`); agora tem uma seção própria e espaçosa no Detalhe,
  "Acompanhamento por período" — fora do modal, um cartão por parcela
  (nome do período, valor lançado, cota, % e barrinha), full-width. O
  modal de editar alvo continua com a divisão em si (seletor de
  periodicidade + botão Repartir/Refazer/Limpar) e os números editáveis
  de cada parcela, mas sem tentar caber o progresso detalhado ali também.

**5. Editar/excluir lançamento.** `HistoryModal` já tinha excluir; ganhou
um lápis por linha (histórico principal e lançamentos finos por
`entry_frequency`) que abre `ValueEntryModal` pré-preenchido com aquele
período — o modal já fazia upsert por período, só faltava um jeito de
chegar nele a partir de um lançamento específico em vez de digitar a data
certa às cegas. Título muda pra "Editar lançamento" quando é o caso.

**Bug real achado nesse meio-tempo:** `ValueEntryModal` decidia usar
`kpi_value_entries` (cadência fina) com `kpi.entry_frequency !== null` —
falha quando o campo vem `undefined` em vez de `null` (mesma classe de bug
já corrigida em `canAttachChild`, item 37). Um KPI de teste sem esse campo
setado explicitamente acabava lançando na tabela errada. Trocado por
`Boolean(kpi.entry_frequency)`.

**6-7. Contribuição % + ordenar por contribuição/faturamento.** Novo
helper `contributionRatio` (`core/lib/kpiRollup.ts`) — fração do valor do
filho sobre o valor do pai, `null` (não 0%) quando falta algum dos dois ou
o pai é zero. Usado em três lugares: tabela de quebra do Detalhe (coluna
"Contrib." + filhos ordenados do maior pro menor contribuinte, nulo por
último — não é "zero"), e em Produtos (produtos/edições ordenados por
valor efetivo, badge "X% de {meta-mãe}" quando aplicável).

**8. Gráficos da holding repensados.** O gráfico "Metas no alvo por
empresa" (barra empilhada on-target/off-target/sem-lançamento) respondia
basicamente a mesma pergunta do "Metas x realizado" (linha) logo acima —
virou uma barrinha compacta dentro de cada cartão de empresa. No lugar,
um gráfico novo: "Faturamento por produto no grupo" — ranking horizontal
(maior pro menor) somando o faturamento de cada produto (turmas/edições
incluídas) em TODAS as empresas, cor da barra = empresa dona — pergunta
que nenhuma tela do sistema respondia antes (todo lugar mostra produtos de
uma empresa só). O gráfico de atingimento por empresa ganhou um encoding a
mais (tamanho do ponto = quantidade de metas na média), recuperando o
sinal que a barra removida carregava. Grid de 3 cartões-resumo, que
espremia num celular, virou 2 colunas com o terceiro ocupando a linha
inteira abaixo de `sm:`.

**Revisão de responsividade/usabilidade (fora de Metas/Produtos/Holding):**
`TaskFormModal` (grid de 3 botões de visibilidade viravam 1 coluna
primeiro, item de checklist deixou de truncar e passou a quebrar linha),
`TasksPage`/`HoldingTasksPage` (nome do responsável com mais espaço +
tooltip nativo), `BudgetsPage`/`IntegrationsPage` (dica de "arraste pra o
lado" nas tabelas largas, célula de item de orçamento parou de truncar
duas linhas espremidas), `NotesPage` (título quebra em vez de truncar),
`UsersPage` (e-mail nunca mais corta — prioridade sobre truncar o nome,
já que um e-mail cortado às vezes é a única forma de diferenciar dois
usuários), `ProgressBar` (tooltip nativo no rótulo truncado).

**Responsividade própria de Metas:** `MetasOverview`/`MetaDetail` tinham
tabelas de 7-8 colunas dentro de `min-w-[900px]`/`min-w-[720px]` —
utilizáveis (com scroll horizontal), mas apertadas num celular. Abaixo de
`sm:`, viram cartão empilhado por linha (mesmos dados, sem espremer
coluna nenhuma); o rótulo de categoria da Visão Geral passou a existir
UMA vez só por grupo (compartilhado entre as duas apresentações) — tinha
sido duplicado numa primeira versão e quebrava `getByText` em teste
(ambíguo mesmo com uma das duas cópias escondida por CSS, porque busca de
texto puro não filtra por visibilidade do jeito que `getByRole` filtra).

**Bug real achado ao rodar e2e (não um problema do teste):** o novo
`useMemo` de ordenar `children` em `MetaDetail.tsx` foi colocado DEPOIS
dos `return` condicionais (`ctx.loading`/`!kpi`) — hook pulado nalgumas
renderizações e chamado em outras quebra a contagem de hooks do React
(erro minificado #300), estourando o ErrorBoundary bem no meio do fluxo de
"vincular produto" (o `load()` do `onSaved` liga `loading` por um
instante). Corrigido: hook sempre antes de qualquer return condicional,
com guarda de `kpi` opcional dentro dele (mesmo padrão que `chain` já
usava).

**ai-insights:** `kpi_checkpoints` agora expõe `frequency` pro leitor de
metas; campo do retrato renomeado de `parcelas_semanais` pra `parcelas`
(com `periodicidade`), e o prompt ganhou um parágrafo explicando que
parcela é cota do período (não acumulado) e pedindo pra IA citar o período
específico que ficou devendo, não só o alvo final. Redeploy feito.

**Verificação:** `npx tsc --noEmit`, `npm run build` e `npm run test`
(40/40 — 12 testes novos: `splitTargetIntoPeriods`, `sumValuesInRange`,
`contributionRatio`) limpos. `npm run check:contrast`: 24/24. `npm run
test:e2e`: suíte completa 189 passando, 27 skipped, sem falhas (Desktop e
Mobile 390) — 4 testes novos (repartir por mês com data travada via
`page.clock.setFixedTime` pra resultado determinístico, editar lançamento,
contribuição do filho no Detalhe) mais o teste do gráfico da holding
atualizado pro novo título. `mcp__Supabase__get_advisors`: nenhum item
novo (security/performance) depois da migração 0035.

## 39. Lançamento com calendário completo, ajustes de Metas, dois bugs reais e revisão geral de UI/UX

Sequência de pedidos menores sobre a tela de Metas, seguida de dois bugs
relatados no uso real e fechada com uma auditoria geral de UI/UX no
sistema inteiro.

**1. Lançamento: calendário completo, depois de volta pra só o dia.**
Primeiro pedido: abrir um seletor de calendário completo (em vez de restrito
ao mês corrente) e registrar dia+horário exatos do lançamento
(`kpi_values.occurred_at`/`kpi_value_entries.occurred_at`, timestamptz novo
na migração `0036_kpi_value_occurred_at.sql`). Testado com hora, o usuário
pediu de volta só o dia — `ValueEntryModal` manteve o `occurred_at` (grava
meio-dia do dia escolhido, `${reference}T12:00:00`, pra não colidir com
fuso ao exibir), mas o campo voltou a ser `<input type="date">` simples;
`HistoryModal` mostra a data sem hora (`formatDate`, não `formatDateTime`).

**2. Títulos de tabela centralizados.** `MetasOverview`/`MetaDetail`
tinham cabeçalho de tabela alinhado à esquerda por padrão do navegador —
todas as colunas (incluindo a primeira, "Meta"/"Turma"/"Produto", que
tinha escapado de uma rodada anterior) centralizadas.

**3. Cascata de alvo — debate antes de mexer.** Pedido: o alvo de um
produto deveria ser automaticamente a soma dos alvos das turmas dentro
dele. Como pedido, parou pra debater antes de implementar — cascata
automática tem um risco real (editar o alvo de uma turma muda "sem avisar"
o compromisso que a empresa já assumiu no nível de produto, que pode ter
sido negociado por outro motivo). Opção escolhida pelo usuário: um botão
"Usar soma dos filhos" dentro do formulário de alvo, que preenche o campo
uma vez (o usuário ainda decide se aceita) em vez de recalcular sozinho a
cada mudança.

**4. `MetasOverview`: mais formas de ordenar, cadastro mais rápido.**
Antes só ordenava por nome dentro da categoria. Adicionado seletor com
prazo/nome/alvo/progresso/data de cadastro (`SortKey`, `SORT_LABEL`).
Cadastro de produto/turma ganhou dois atalhos que antes só existiam em
Produtos: criar produto e turma inline de dentro do `AttachProductModal`
(sem trocar de tela) e criar várias turmas de uma vez — um formulário em
lote que gera "Turma jan. 2027, Turma fev. 2027, ..." a partir de
mês/quantidade (`core/lib/bulkEditions.ts`, `buildBulkEditions`).

**5. Mobile: cards de Metas mais separados.** A lista de `MetasOverview`
no celular estava com os itens "grudados" visualmente (só uma borda fina
entre eles). Cada linha virou um cartão próprio
(`rounded-xl border border-line-strong bg-surface shadow-card`) com
espaçamento entre eles — mesmo tratamento dado ao `ChildCard` de
`MetaDetail`.

**6. Ordenação por prazo como padrão + filtros compactos no mobile.**
Dois problemas no mesmo print: a ordenação "automática" (cadastro) deixava
turmas fora de ordem de prazo, e a linha de filtros/ordenação ocupava
espaço demais no celular. `sortBy` passou a nascer em `'prazo'` (em vez de
`'cadastro'`) tanto em `MetasOverview` quanto no `children` de
`MetaDetail`; os controles de categoria/ordenação/produto/"Nova Meta" no
mobile viraram uma grade 2×2 compacta (`grid grid-cols-2 gap-2 sm:contents`
— o wrapper "desaparece" do layout a partir de `sm:`, os filhos voltam a
fluir soltos como antes).

**7. Bug real: lançamento "trava" a partir do segundo cadastro.** O
relato: o primeiro lançamento funciona normal, mas ao abrir o formulário
de novo (outro período), ele aparece com valor/observação do lançamento
ANTERIOR, o toque no campo de texto não responde direito, e salvar não
grava o valor certo. Causa: o efeito de sincronização em `ValueEntryModal`
dependia de `entries`/`existing` — arrays que, quando o mapa de lançamentos
não tinha a chave, chegavam como `?? []`, ou seja, uma referência NOVA a
cada render. Qualquer re-render do componente pai (inclusive um causado
pela própria digitação subindo por outro estado) refazia o efeito, que
lia de novo o "lançamento encontrado para este período" e chamava
`setValue`/`setNote` incondicionalmente — apagando o que a pessoa acabara
de digitar. Corrigido com um `useRef` guardando o último `periodStart`
sincronizado: o efeito só roda de fato quando o período muda, não a cada
render alheio. Regressão nova em `dashboard.spec.ts` reproduz exatamente o
cenário (lançar, fechar, abrir um período diferente e vazio, digitar, e
conferir que o valor digitado não é substituído).

**8. Bug real (achado investigando o Bug 7, não relatado): nome
duplicado ao vincular turma.** Inspeção direta em produção mostrou nomes
como "Faturamento · Entre Donos · Entre Donos · Turma set. 2026". Causa:
o nome de um KPI de nível produto já vem sintetizado como
`"{nome do indicador} · {produto}"` quando ele é criado — mas
`AttachProductModal` (`linkChild` e o insert em lote de `submitBulk`)
montava o nome da turma como `"{nome do PAI} · {produto} · {turma}"`,
repetindo o nome do produto que já estava embutido no nome do pai.
Corrigido nas duas rotas de criação (`${parentKpi.name} · ${entityName}`,
sem repetir o produto) e as 9 linhas já afetadas em produção corrigidas
com um `UPDATE ... regexp_replace` verificado por `RETURNING` antes de
aplicar.

**9. Revisão geral de UI/UX.** Pedido aberto — "garanta que tudo esteja
bem desenhado e funcione perfeitamente". Abordagem: suíte e2e completa
como base (207 passando), depois 3 agentes de leitura em paralelo
varrendo o sistema por módulo (Tarefas/Orçamentos; Mapa de
notas/Insights/Login/Perfil/shell; Notas/Integrações/Usuários/
Auditoria/Empresas) devolvendo achados com arquivo:linha, sem editar nada
— só depois disso, correção manual dos achados concretos. Aplicado nesta
rodada:

- **Acessibilidade de botões de ícone.** Vários botões só de ícone
  (editar/excluir tarefa, integração, mapeamento, nota, empresa, item de
  orçamento; avançar/voltar coluna do kanban; resetar senha, remover da
  empresa, promover/inativar/excluir usuário) tinham `aria-label`
  genérico ("Editar", "Excluir") ou nenhum — passaram a incluir o nome/
  título do item (`` `Editar tarefa "${task.title}"` ``), e os que só
  tinham `title` ganharam o `aria-label` correspondente mantendo o
  `title` como dica visual. Campos de busca sem rótulo (Notas, Usuários,
  seletor de empresa no mobile) ganharam `aria-label`.
- **Dois bugs de referência instável, mesma classe do Bug 7.**
  `UsersPage.tsx`: `<CreateUserModal companies={[company]} />` criava um
  array novo a cada render; o efeito de reset do modal (que depende desse
  prop) reabria o formulário do zero a qualquer re-render alheio,
  apagando o que o admin estava digitando — corrigido com
  `useMemo(() => [company], [company])`. `TaskFormModal.tsx`: o
  `useCallback` de carregar autores de comentário tinha deps vazias de
  propósito (estabilidade referencial), mas lia `commentAuthors` do
  escopo externo — sempre via o `{}` inicial (closure presa), tratando
  todo autor como "faltando" e refazendo a busca à toa; corrigido com um
  `useRef` espelhando o estado, mantendo o callback estável e a leitura
  atualizada.
- **Erros de escrita silenciosos.** `markAllRead`/abrir notificação
  (`AppLayout.tsx`) e arquivar insight (`InsightsPage.tsx`) aplicavam o
  estado otimista mesmo quando o `update` no Supabase falhava — corrigido
  pra checar `error` antes de atualizar o estado local, com toast de erro
  quando falha.
- **Dropdowns não fechavam com Esc.** `useClickOutside` (usado pelos três
  menus do `AppLayout`/`CompanySwitcher` — notificações, perfil, seletor
  de empresa) só fechava ao clicar fora; ganhou um listener de `keydown`
  pra Escape, corrigindo os três de uma vez.
- **Texto obsoleto.** "mapas mentais" (referência ao recurso removido,
  hoje "Notas") em `LoginPage.tsx` e `CompaniesPage.tsx`.
- **Notificação clicável.** `AppLayout.tsx`: clicar numa notificação não
  navegava pro link nem marcava como lida — `openNotification` faz as
  duas coisas, e o item ganhou um indicador visual de não lida.
- **`BudgetsPage`:** os campos de "Adicionar item" eram `<input>` soltos
  (sem `<Field>`/rótulo) dentro de uma `<div>`, sem `onSubmit` — só o
  clique no botão "Adicionar" funcionava, Enter não fazia nada. Viraram
  um `<form>` de verdade com `<Field>` em cada campo e o toggle
  Despesa/Receita ganhou `role="group"`/`aria-pressed`.
- **`key` de lista reaproveitando o valor.** `task.tags.map((tag) => ...
  key={tag})` quebra se a mesma tag aparecer duas vezes na lista —
  passou a incluir o índice (`` key={`${tag}-${i}`} ``) em
  `TasksPage.tsx`/`HoldingTasksPage.tsx`.
- **Dica de coluna vazia escondida no mobile.** O texto "vazio" de uma
  coluna do kanban sem tarefas tinha `hidden md:block` — sem função
  clara de esconder só no celular; virou sempre visível.

**Deliberadamente adiado** (achados reais dos 3 agentes, mas de escopo
maior que esta rodada — não é uma correção pontual, é um padrão
repetido pelo sistema inteiro): erros de leitura do Supabase não
verificados em quase todo `load()`; atualização otimista sem desfazer em
caso de erro (checklist/comentários de tarefa, status/valor de item de
orçamento — fora dos dois casos já corrigidos acima); tabela "Execuções
recentes" de `IntegrationsPage` sem versão em cartão pro mobile (só
scroll horizontal); área de toque abaixo de ~40px em vários botões
pequenos (convenção já estabelecida no resto do sistema, mudar é decisão
maior); pequenos ganhos de DRY (confirmação de exclusão sob medida em vez
de `useConfirmDelete` em Integrações/Empresas, `run()` duplicado em
`UsersPage`, `load` sem `useCallback` em `CompaniesPage`). Fica registrado
aqui caso o usuário queira priorizar algum.

**Verificação:** `npx tsc --noEmit`, `npm run build` e `npm run test`
(48/48) limpos. `npm run check:contrast`: 24/24. `npm run test:e2e`:
suíte completa 207 passando, 27 skipped, sem falhas (Desktop e Mobile
390).

## 40. Lançamento "não salvava": era configuração da turma, não bug

O usuário relatou de novo, ponto a ponto, o mesmo sintoma da seção 39 item
7 mesmo depois daquela correção estar no ar: abrir "Lançar valor" numa
turma mostrava o valor/observação de um lançamento anterior e o valor novo
não parecia gravar. A correção da seção 39 (guarda por `useRef` no efeito
de sincronização) estava mesmo certa e no ar — conferido lendo o código,
o deploy do Netlify (commit batendo) e o banco (nenhuma linha duplicada em
`kpi_values`/`kpi_value_entries`). O que faltava era outra causa,
completamente diferente, pro mesmo sintoma percebido:

**Causa real:** a turma em questão tinha `frequency = 'monthly'` e
`entry_frequency = null` — ou seja, só existe UM valor guardado pro mês
inteiro. Abrir "Lançar valor" em qualquer dia de setembro sempre caía no
mesmo período (01/09 a 30/09) e corretamente virava **edição** do único
número do mês (título "Editar lançamento", campos pré-preenchidos) — não
era o formulário grudando dado de sessão anterior por engano, era o
sistema funcionando como desenhado pra essa configuração. O usuário
quer o oposto: cada lançamento é um dia novo, e o total do mês é a SOMA
dos dias — isso já existe no sistema como `entry_frequency` (cadência de
lançamento mais fina, seção 23 item 3), só que essa turma nunca tinha sido
configurada com ela.

**Correção aplicada (dado em produção, sem mudança de código):** ativado
`entry_frequency = 'daily'` na turma afetada, e o lançamento manual já
existente (R$ 297,00) migrado pra virar o primeiro lançamento do dia
04/09 em `kpi_value_entries` — o gatilho de soma (`0026_kpi_lifecycle.sql`)
recalculou `kpi_values` a partir dele e o total do mês continuou R$ 297,00
(zero perda de dado, só troca de `source: 'manual'` pra `'rollup'`).

**Confusão de UI descoberta no processo (essa sim, uma melhoria real):**
o usuário foi configurar isso manualmente e abriu o seletor errado —
"Frequência de medição" (que de propósito nunca lista "Diário", ver
comentário em `core/types.ts` e a trava `kpis_frequency_not_daily` da
migração `0030`) — em vez de "Lançar em cadência mais fina", o campo
logo abaixo, onde "Diário" já existia como opção. Os dois campos ficam
colados um no outro e, no seletor nativo do celular, o dropdown aberto
cobre o rótulo do campo de baixo. Adicionado um hint só no primeiro campo
explicando que não ter "Diário" ali é de propósito e apontando pro campo
certo.

**Verificação:** `npx tsc --noEmit`, `npm run build` e `npm run
test:e2e` (suíte completa, 207 passando, 27 skipped, Desktop e Mobile
390) limpos.

## 41. Vários lançamentos no mesmo dia (com entry_frequency)

Consequência direta da seção 40: uma vez com cadência diária ativada, o
usuário foi lançar de novo no mesmo dia (uma segunda venda, por exemplo) e
o formulário abriu em modo de EDIÇÃO do primeiro lançamento — sem como
acumular dois valores no mesmo dia. Não era mais o bug de sincronização,
era uma limitação de verdade: `kpi_value_entries` tinha
`unique(kpi_id, period_start)`, então só cabia um lançamento por dia por
natureza, e "lançar de novo" só podia mesmo significar "editar o único que
existe".

**Confirmado com o usuário antes de mudar** (mudança de comportamento pra
todo o sistema, não só uma turma): "Lançar valor" passa a SEMPRE criar um
lançamento novo; editar um lançamento específico só pelo lápis na lista
"Lançamentos por dia" do Histórico.

- **Migração `0037_kpi_value_entries_multiple_per_day.sql`:** derruba a
  `unique(kpi_id, period_start)` de `kpi_value_entries`. O gatilho que soma
  pro período grosso (`app.rollup_kpi_value_entry`, `0026_kpi_lifecycle.sql`)
  já soma por agregação (`sum(value) where period_start between ...`) — nunca
  dependeu de unicidade por dia, então o total continua certo com quantos
  lançamentos o dia tiver. `kpi_values` (a linha grossa/rollup) continua
  única por período, sem mudança — ela representa o TOTAL, não lançamentos
  individuais. A unique dropada também era o único índice com `kpi_id`
  líder nessa tabela — resolvido com um índice dedicado
  (`kpi_value_entries_kpi_id_idx`), senão excluir um KPI (cascade) ou
  buscar por `kpi_id` viraria varredura de tabela inteira.
- **`ValueEntryModal`:** não dá mais pra inferir "é edição" só pelo dia
  escolhido bater com um lançamento existente — precisa saber QUAL
  lançamento (por id). Novo prop `editingEntry?: KpiValueEntry`: presente
  = edita aquele lançamento específico (`update().eq('id', ...)`);
  ausente = sempre um `insert()` novo, nunca mais upsert por período. O
  efeito de sincronizar valor/observação com o que já existe (o guardado
  por `useRef` da seção 39) agora só roda no modo SEM `entry_frequency`
  (onde o período ainda é único de verdade); com `entry_frequency`,
  valor/observação vêm só do `editingEntry` passado na abertura — trocar o
  dia num lançamento novo nunca apaga o que a pessoa já digitou.
- **`HistoryModal`:** o lápis de "Editar lançamento fino" agora passa o
  lançamento inteiro pro callback (`onEdit(periodStart, entry)`), não só o
  dia — o lápis do lançamento grosso (sem `entry_frequency`) continua como
  antes, já que ali o período ainda é único.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 209 passando (2 testes novos: vários lançamentos no mesmo
dia somando e não virando edição sozinho, mais a re-execução dos
cenários já existentes de lançamento único/edição), 27 skipped, sem
falhas (Desktop e Mobile 390). `mcp__Supabase__get_advisors`: a migração
resolveu um alerta de performance que ela mesma introduziu (índice de
`kpi_id` que ia junto com a unique derrubada); nenhum item novo de
segurança.

## 42. Meta de empresa sumindo do painel da Holding quando o valor só existe dois níveis abaixo

Relatado com um exemplo concreto: faturamento de 2026 não aparecia no
card da empresa no painel da Holding, mesmo com lançamento feito na turma
certa. Pedido explícito de garantir "que funcione perfeitamente" e
auditar o sistema inteiro atrás do mesmo tipo de erro.

**Causa raiz:** `HoldingDashboard.tsx` lia o campo `value` direto de
`meta_latest_values`/`kpi_latest_values` — duas views (`0032_metas.sql`)
que fazem INNER JOIN com `kpi_values`/`kpis`, então só trazem uma linha
com valor pra KPI que tem lançamento PRÓPRIO. Um indicador "contêiner"
(nível empresa ou produto, que por desenho nunca lança direto — só soma
os filhos por baixo, via `parent_kpi_id`) nunca aparece nessas views com
valor: a view devolve `null`, e nada no painel da Holding somava a
cadeia no cliente pra corrigir isso. `CompanyDashboard.tsx` e
`ProductsPage.tsx` já faziam essa soma certo (buscam os `kpis` completos,
juntam com `kpi_latest_values` e rodam `buildChildrenByParent`/
`effectiveKpiValue` de `core/lib/kpiRollup.ts`) — só o painel da Holding e
a função de IA (`ai-insights`) tinham ficado pra trás dessa consolidação
anterior.

**Bug de coerção junto:** em vários pontos do arquivo, `Number(meta.value)`
rodava ANTES de checar se o valor existia — e `Number(null) === 0`, não
`null`. Uma meta sem nenhum dado em lugar nenhum da cadeia virava
silenciosamente "0% do alvo, fora da meta" (vermelho) em vez de "sem
lançamento ainda" (neutro). Trocado por `number | null` passado direto,
com `!== null` explícito antes de chamar `attainmentRatio`/`isOnTarget`.

- **`HoldingDashboard.tsx`:** passa a buscar também
  `kpis.select('id, company_id, parent_kpi_id')` e monta
  `rollupRows`/`childrenByParent`/`effectiveValue` (mesmo padrão de
  `CompanyDashboard.tsx`, agora também extraído como tipo `RollupRow` de
  `core/lib/kpiRollup.ts`). Todo lugar que lia `meta.value`/
  `Number(kpis_on_target)`/`Number(kpis_off_target)` direto da view passou a
  usar `metasEffective` (metas com o valor já resolvido pela cadeia) e um
  novo `targetCounts(companyId)` (conta no-alvo/fora-do-alvo a partir do
  valor resolvido, não do que a view já trazia pronto) — cobre os cartões-
  resumo do topo, o card por empresa, a lista de metas dentro de cada
  card e a saúde geral por empresa/grupo.
- **`ai-insights/index.ts`:** o mesmo problema existia no leitor de `kpis`
  (`ultimos_valores` vinha vazio pra indicador contêiner, sem nada
  dizendo que isso era esperado) e em `holdingContext()`
  (`metas_consolidadas` tinha `valor: null` pro mesmo caso). Adicionado o
  mesmo cálculo de `effectiveValue` duplicado localmente (edge function
  não importa de `src/` — build separado) em ambos os lugares, com um novo
  campo `valor_atual` nas metas e uma frase no `SYSTEM_PROMPT` explicando
  que "vazio" numa meta de empresa/produto é normal e não significa "sem
  dado" — checar `valor_atual`/`valor` antes de dizer isso. Redeploy via
  `mcp__Supabase__deploy_edge_function` (versão 13).
- **Auditoria no resto do sistema:** grep por `meta_latest_values`/
  `kpi_latest_values` em `src/` voltou só `core/types.ts` (definição de
  tipo), `ProductsPage.tsx`/`CompanyDashboard.tsx` (já corretos, usados
  como referência) e os dois arquivos corrigidos acima — nenhum outro
  lugar lê essas views sem passar pelo rollup no cliente.
- **e2e:** as fixtures existentes (`KPI_PRODUCT`/`KPI_EDITION`) não
  reproduzem sozinhas o caso relatado, porque o painel da Holding só olha
  meta de indicador de empresa inteira (`product_id === null`, filtro
  intencional desde a `0034_metas_todo_nivel.sql`) e `KPI_PRODUCT` tem
  `product_id` preenchido. Teste novo cria um indicador de empresa (sem
  `product_id`/`parent_kpi_id`) e reparenta `KPI_PRODUCT` por baixo dele,
  formando uma cadeia empresa → produto → turma de 3 níveis; a
  `meta_latest_values` mockada devolve `value: null` pro nível de empresa
  (espelhando a view de verdade), e o teste confere que o card mostra
  `R$ 32.000,00` (o valor lançado só na turma) em vez de sumir/mostrar
  zero. Confirmado que esse teste falha sem o fix (`git stash` só do
  `HoldingDashboard.tsx`) e passa com ele.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 211 passando (1 teste novo), 27 skipped, sem falhas
(Desktop e Mobile 390). Sem migração nesta rodada — nenhum
`get_advisors` necessário.

## 43. Painel por Produto/Turma (Fase 1 do plano de "sistema de gestão completo")

Depois de discutir com o usuário como o sistema deveria evoluir pra virar
uma gestão completa por empresa/área (comercial, financeiro,
administrativo), a primeira fase acordada foi resolver uma dor concreta
já sentida hoje: acompanhar várias metas de uma mesma turma ou produto
(faturamento, vendas, ticket médio…) juntas, numa tela só, sem pular de
indicador em indicador dentro de Metas.

**O que já existia:** o modelo de dados (`kpis`/`metas`/`tasks`/
`budgets`, todos com `product_id`/`product_edition_id` opcionais) já
suportava esse escopo — só não existia uma TELA que juntasse tudo. A
única visão "de uma turma/produto só" era a lista de leitura dentro de
Produtos (nome + valor, sem alvo/status/tarefas/orçamento).

- **`src/modules/dashboard/ProductDashboard.tsx` (novo):** mesmo tipo de
  retrato do painel da empresa (indicadores, alvos com status/prazo/
  progresso, tarefas, orçamento), escopado a um produto OU a uma turma
  dele (o mesmo componente decide pela presença de `:editionId` na URL).
  Reaproveita `StatTile`/`IndicatorLine` (agora exportados de
  `CompanyDashboard.tsx`) e a mesma cadeia de soma de
  `core/lib/kpiRollup.ts` — nenhuma lógica nova de rollup. Limitação real
  do modelo de dados, documentada no topo do arquivo: `tasks` só tem
  `product_id` (granularidade de produto), não `product_edition_id` — por
  isso a seção de tarefas só aparece no painel do PRODUTO, nunca no da
  turma. Orçamento é escopado por `product_edition_id` (null = do
  produto, preenchido = da turma), pra não somar execução de turma dentro
  do cartão do produto.
- **Rotas novas** (`src/app/App.tsx`): `/empresa/:companyId/produtos/:productId`
  e `/empresa/:companyId/produtos/:productId/turmas/:editionId`, dentro do
  mesmo `CompanyProvider` de sempre.
- **`ProductsPage.tsx`:** um link "Ver painel" no cabeçalho do modal de
  produto e um ícone "Ver painel" por linha de turma — sem isso, chegar
  no painel novo exigia digitar a URL de cabeça.
- **e2e:** dois testes novos cobrindo o painel de produto (indicadores +
  alvos + turmas + tarefa + orçamento, todos numa tela) e o de turma
  (indicador + alvo, sem seção de tarefas), mais um teste do atalho "Ver
  painel". As duas rotas novas entraram em `ROUTES` (fixtures.ts), então
  passam automaticamente pelos audits gerais (sem rolagem lateral, sem
  campo com zoom no celular, sem violação de CSP).
  - **Achado no processo:** o mock de teste (`mockSupabase`) ignora
    filtro de querystring e devolve a tabela inteira — com `kpi_id`/`id`
    isso nunca importou porque as fixtures RAW já vinham "certas" pra
    quem usa `.eq(...)` sem `.single()`. Mas `product_editions` tem 2
    linhas nas fixtures, e o painel da turma busca UMA edição com
    `.eq('id', editionId).maybeSingle()` — o próprio `postgrest-js`
    trata "2 linhas voltaram pra uma query de single()" como ERRO
    (`PGRST116`), não como "pega a primeira". Bug só do mock de teste,
    não do app (PostgREST de verdade filtra direito no servidor) —
    corrigido com uma rota específica só nesse teste, filtrando pelo
    `id` de verdade da querystring.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 227 passando (3 testes novos + 2 rotas novas cobertas
pelos audits gerais), 29 skipped, sem falhas (Desktop e Mobile 390). Sem
migração nesta rodada — nenhum `get_advisors` necessário.

## 44. Área/Departamento (Fase 2 do plano de "sistema de gestão completo")

Segunda fase do plano discutido com o usuário — depois do painel por
produto/turma (Fase 1, seção 43), esta fase dá nome e estrutura ao que
antes só existia como `category` de texto livre nas metas: uma área
(Comercial, Financeiro, Administrativo...) que organiza indicador, tarefa
e orçamento ao redor da mesma frente interna da empresa.

- **Migração `0038_departments.sql`:** tabela `departments` por empresa
  (mesmo padrão de `products` — cada empresa define as próprias, sem
  lista fixa pro grupo). Coluna opcional `department_id` em `kpis`,
  `tasks` e `budgets`, cada uma com seu próprio trigger de guarda
  (`app.assert_kpi_department()`/`..._task_...`/`..._budget_...`,
  mesmo padrão de `app.assert_kpi_product()` já usado desde
  `0024_products.sql`) confirmando que a área é da mesma empresa do
  registro. RLS igual a todo módulo por empresa (`is_member`/`can_write`).
  **Seed automático**: toda empresa que já tinha indicador com `category`
  preenchida ganhou uma área com esse nome, e os indicadores foram
  religados a ela — não é uma lista inventada, é o que a empresa já vinha
  usando informalmente (confirmado: a Vibra ganhou "Financeiro" e
  "Clientes" a partir do uso real). `category` continua existindo,
  intocada — área complementa, não substitui (categoria segue livre por
  indicador; área é o contêiner estruturado que também alcança tarefa e
  orçamento, algo que categoria nunca alcançou).
- **`DepartmentsPage.tsx` (novo, rota `/empresa/:id/areas`):** cadastro
  simples — criar/editar/excluir área, com sugestões do mesmo catálogo já
  usado como sugestão de categoria (`KPI_CATEGORIES`). Cada cartão mostra
  quantos indicadores/tarefas/orçamentos já apontam pra ela e um atalho
  "Ver painel".
- **`DepartmentDashboard.tsx` (novo, rota `/empresa/:id/areas/:departmentId`):**
  mesmo tipo de retrato do painel de produto/turma (Fase 1) — reaproveita
  os mesmos `StatTile`/`IndicatorLine` — só que escopado por
  `department_id` em vez de `product_id`. Diferente do painel de produto,
  este MOSTRA tarefas: `tasks.department_id` é direto (não tem a
  limitação de granularidade que só existe pra produto/turma, onde
  `tasks` só tem `product_id`).
- **Formulários que passam a oferecer "Área"** (select opcional, com
  hint explicando que organiza junto com o resto da mesma área):
  `KpisPage.tsx` (só no modo "Criar o meu" e ao editar — o modo "Usar
  sugestões" segue outro fluxo de submissão que não passa por esse
  formulário, mesma regra que já vale pra "Categoria" hoje: dá pra
  definir depois, editando), `TaskFormModal.tsx`, `BudgetsPage.tsx`.
  Todos seguem exatamente o padrão já usado por "Produto" nesses mesmos
  formulários (mesmo `loadDepartments`/`loadProducts`, mesmo formato de
  `Field`).
- **Menu lateral:** item novo "Áreas" entre "Produtos" e "Notas"
  (`AppLayout.tsx`). Reorganização do menu por área (agrupar Metas/
  Tarefas/Orçamento dentro de cada área) fica pra uma rodada futura, se
  o usuário confirmar que quer — não fazia parte do escopo mínimo desta
  fase.
- **e2e:** fixtures ganharam `DEPARTMENTS`/`DEPARTMENT_ID` (uma área
  "Comercial" já cadastrada na Vibra) e as duas rotas novas entraram em
  `ROUTES`. Cinco testes novos: lista com contagens certas + "Ver
  painel", criar área nova a partir de sugestão (com um mock de estado
  simples pra provar que só aparece DEPOIS de criar, não antes), painel
  da área com indicador+alvo+tarefa+orçamento juntos, e os dois
  formulários (Metas/Tarefas) oferecendo a área cadastrada — usando
  `selectOption`/`toHaveValue` em vez de checar `<option>` direto
  (visibilidade de `<option>` dentro de `<select>` fechado é
  inconsistente entre engines de teste).

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 247 passando (5 testes novos + 2 rotas novas cobertas
pelos audits gerais), 31 skipped, sem falhas (Desktop e Mobile 390).
`mcp__Supabase__get_advisors`: nenhum item novo de segurança (os dois
mostrados — `system_settings` sem policy e leaked-password-protection —
já existiam antes desta migração); nenhum item novo de performance (as
colunas `department_id` novas já nasceram com índice parcial).

## 45. Refinar granularidade de tarefa (turma) + menu lateral por área

Pedido direto do usuário, com autorização explícita pra executar melhorias
correlatas sem perguntar: "refine granularidade de tarefas" e "reorganize
o menu lateral por área". Os dois já tinham sido identificados como
lacuna/próximo passo nas seções 43 e 44 — esta rodada fecha os dois.

**1. Granularidade de tarefa — migração `0039_task_product_edition.sql`:**
`tasks.product_id` ia só até produto, nunca até turma — o painel de
produto/turma (seção 43) só mostrava tarefas no nível de produto por
causa exatamente disso, documentado ali como limitação real do modelo,
não da tela. Corrigido:
- Coluna nova `tasks.product_edition_id` (opcional, mesmo nível de
  detalhe que `kpis`/`budgets` já tinham desde `0024_products.sql`).
- **Achado de quebra, corrigido junto:** `tasks.product_id` nunca teve o
  guard de "produto é da mesma empresa" que `kpis`/`budgets` já têm
  desde `0024_products.sql` (`app.assert_kpi_product()`/
  `app.assert_budget_product()`) — lacuna real, não intencional, sem
  relação direta com o pedido mas descoberta ao mexer exatamente nesse
  ponto. `app.assert_task_product()` fecha os dois de uma vez: produto
  da mesma empresa + edição (se houver) do mesmo produto.
- `TaskFormModal.tsx`: select "Turma" novo, em cascata — só aparece
  depois de escolher um produto que tem edições, mesmo padrão de
  `AttachProductModal` em Metas. Trocar de produto (ou de empresa) limpa
  a turma escolhida antes, pra nunca submeter uma combinação inválida.
- `ProductDashboard.tsx`: removida a limitação documentada na seção 43 —
  a seção "Próximos prazos" agora aparece TAMBÉM no painel da turma,
  mostrando só as tarefas dela (`tasksInScope`, mesmo critério já usado
  pra orçamento/indicador). Comentário do topo do arquivo atualizado pra
  não descrever mais uma limitação que não existe.
- `ProductsPage.tsx`: contagem de tarefas do cartão do produto agora
  conta só tarefas PRÓPRIAS dele (sem edição) — antes contava também as
  de cada turma, porque não tinha como diferenciar. Cada linha de turma
  ganhou a própria contagem (`openTasksByEdition`), antes impossível de
  mostrar.

**2. Menu lateral por área — `AppLayout.tsx`:** cada área cadastrada na
empresa ativa entra como sub-item recuado logo abaixo de "Áreas",
linkando direto pro painel dela (indicador+alvo+tarefa+orçamento juntos,
seção 44) — "Áreas" continua levando pra lista/cadastro. Busca as áreas
da empresa ativa (recarrega ao trocar de empresa), com um item por dot
(•) no lugar do ícone repetido, pra marcar visualmente que é filho de
"Áreas" sem precisar de um componente de árvore. Metas/Tarefas/
Orçamentos continuam como itens globais (cross-área) — não fazia sentido
duplicá-los por área, e nenhum dos três precisou de filtro por área
nesta rodada (fica como possível próximo passo, não pedido agora).

**Achado no processo:** duas fixtures de teste de rodadas anteriores
(`task-produto-teste`, na seção 43) tinham `product_id` preenchido mas
sem o campo `product_edition_id` — inofensivo antes (o campo não
existia), mas com o filtro novo (`=== null`) um campo genuinamente
ausente (`undefined`) não bate com `null` e a tarefa sumiria do escopo
por engano. Corrigido preenchendo o campo explicitamente nas fixtures
afetadas — o mesmo cuidado que já vale pra qualquer campo novo em tipo
existente.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 251 passando (reescrita a que assumia "turma nunca mostra
tarefa" + 3 testes novos: cascata produto→turma no formulário salvando
de verdade, painel da turma só com as tarefas dela, menu lateral
mostrando a área e navegando pro painel dela), 31 skipped, sem falhas
(Desktop e Mobile 390). `mcp__Supabase__get_advisors`: nenhum item novo
de segurança nem performance.

## 46. Financeiro — livro de lançamentos (Fase 3, primeira metade)

Primeiro módulo novo do plano de virar sistema de gestão completo por
empresa (debatido e aprovado antes das seções 43-45, que cobriram as
duas primeiras fases: painel por produto/turma e por área). Financeiro é
diferente de Orçamentos: orçamento é previsto × realizado de UM
evento/projeto por vez; financeiro é o dia a dia — receita e despesa
avulsa da empresa, sem precisar amarrar a um orçamento.

**Migração `0040_financial_entries.sql`:** tabela nova `financial_entries`
(`company_id`, `kind` receita/despesa, `category`, `description`,
`amount numeric(14,2) check (amount > 0)`, `occurred_at date`, `notes`),
com o mesmo padrão de vínculo opcional já usado por `kpis`/`tasks`/
`budgets`: `department_id`/`product_id`/`product_edition_id` (e também
`budget_item_id`, pra reconciliar um lançamento com a linha de orçamento
que ele realizou). Um guard só (`app.assert_financial_entry_links()`)
valida os quatro vínculos de uma vez — mesma empresa, e a turma (se
houver) do produto certo. RLS no padrão de sempre (`is_member`/
`can_write`).

**`FinancialsPage.tsx`:** módulo novo espelhando a estrutura de
`BudgetsPage.tsx` (mesmo padrão `scope="company"|"holding"`, mesma
função `round2` em centavos). Três cartões de resumo (Receita/Despesa/
Saldo no mês, com o saldo geral como legenda), tabela de lançamentos
(data, tipo, descrição, categoria, vínculo, valor, editar/excluir) e,
quando há mais de um mês de histórico, uma segunda tabela de fluxo de
caixa por mês com saldo acumulado. Formulário de criar/editar com Tipo
(toggle receita/despesa), Descrição, Valor, Data, Categoria livre e os
mesmos selects em cascata Área → Produto → Turma já usados em
`TaskFormModal.tsx`/`KpisPage.tsx` (só aparecem se a empresa já tem
área/produto cadastrado; Turma só depois de escolher um produto com
edições).

Rotas (`/holding/financeiro`, `/empresa/:id/financeiro`) e item de menu
("Financeiro", ícone `Landmark`) adicionados no mesmo lugar de
Orçamentos, holding e empresa.

**Achado no processo (mesma categoria da seção 45):** a fixture de teste
nova (`FINANCIAL_ENTRIES`) usa `occurred_at` calculado a partir de `new
Date()` no momento em que o arquivo de fixtures carrega, em vez de uma
data fixa — a tela usa "mês corrente" (`new Date().toISOString().slice(0,
7)`) pra calcular Receita/Despesa/Saldo "no mês", e uma data hardcoded
faria esse cálculo depender de em que mês a suíte é rodada.

**Achado de colisão de texto (mesma categoria da seção 45):** o item de
menu novo "Financeiro" colidiu com a sugestão de área "Financeiro" (do
catálogo de categorias) num teste já existente de `Áreas` — corrigido
escopando a asserção a `page.getByRole('main')`, mesmo tipo de ajuste já
feito pra "Comercial" na rodada anterior.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 271 passando (5 testes novos de Financeiro — totais do
mês/saldo geral, listagem com tipo/vínculo formatados, criar com vínculo
de área+produto+turma, editar, pedir exclusão sem excluir direto — mais
2 rotas novas cobertas pelos audits gerais de CSP/zoom/rolagem lateral;
1 teste de `Áreas` ajustado pela colisão de texto acima), 33 skipped, sem
falhas (Desktop e Mobile 390). `mcp__Supabase__get_advisors`: nenhum item
novo de segurança; performance sem item novo além do padrão já existente
de `created_by` sem índice (mesmo lint que `kpis`/`budgets`/`products`
já têm, não é regressão desta migração).

**Pendente pra próxima rodada (Fase 3, segunda metade):** CRM genérico de
contatos (`contacts` com campos customizáveis em jsonb + `contact_stages`
+ Kanban reaproveitando o padrão de Tarefas) — não iniciado ainda.

## 47. Contatos — CRM genérico (Fase 3, segunda metade)

Fecha a Fase 3 do plano de gestão completa: depois do Financeiro (seção
46), o último módulo novo do roadmap aprovado. Diferente de tudo que já
existe no sistema (indicador, tarefa, orçamento, financeiro — todos
amarrados a uma métrica ou um valor), contato é um registro livre: pessoa
ou organização que a empresa se relaciona (lead, cliente, fornecedor,
parceiro...), sem esquema fixo — cada empresa/área acompanha coisas
diferentes de um contato.

**Migração `0041_contacts.sql`:** duas tabelas novas. `contact_stages` é o
pipeline (Kanban) — cada empresa define as próprias etapas, mesmo padrão
livre de `departments`/`products` (nada fixo pro grupo inteiro).
`contacts` tem `stage_id` **obrigatório** (todo contato está em algum
lugar do funil) com `on delete restrict` — diferente do padrão de vínculo
opcional (`set null`) usado em toda parte do sistema até aqui, porque
apagar uma etapa que ainda tem contato dentro é bloqueado, nunca silencioso
(a pessoa move ou exclui os contatos primeiro). Guard trigger
(`app.assert_contact_stage()`) valida que a etapa é da mesma empresa, RLS
no padrão de sempre. Como contato é conceito novo (sem dado real pra
herdar, diferente de como `departments` nasceu dos `kpis.category` já em
uso), toda empresa existente ganha um pipeline comercial genérico de
largada (Novo lead → Em contato → Proposta enviada → Fechado, ganho/
perdido) — texto renomeável/removível livremente depois; sem isso o
Kanban nasceria vazio e travado (não dá pra criar contato sem etapa).

**`ContactsPage.tsx`:** Kanban por etapa, mesmo padrão de setas avançar/
voltar + select de `TasksPage.tsx`, só que a "coluna" é dinâmica (etapa
cadastrada pela empresa) em vez de um enum fixo — cada card tem também o
próprio select pra pular direto pra qualquer etapa. Cabeçalho de cada
coluna tem editar/excluir da etapa e "+ novo contato nesta etapa";
"Excluir etapa" fica bloqueado (erro amigável) enquanto ela tiver contato.
Card de contato: nome, organização, e-mail, telefone, responsável (mesmo
padrão de avatar+iniciais de tarefa), e campos personalizados como badges
(`custom_fields`, pares livres de chave/valor editados no formulário via
uma lista dinâmica "Campo + Valor + remover"). Empresa-only, sem
equivalente na holding — mesmo padrão de Produtos/Áreas (não é um módulo
com contrapartida consolidada faz sentido pro grupo inteiro).

Rota (`/empresa/:id/contatos`) e item de menu ("Contatos", ícone
`Contact2`) logo abaixo das áreas cadastradas, antes de Notas.

**Achado no processo (mesma categoria das rodadas 45 e 46):** o teste que
checava `getByText('Novo lead')`/`getByText('Em contato')` colidiu com o
próprio `<option>` de cada `<select>` de etapa dentro de cada card (todo
card lista as etapas como opção, incluindo o nome de todas as outras) —
diferente das colisões anteriores (texto de nav vs. conteúdo), aqui é
o mesmo elemento do próprio Kanban duplicando o texto. Corrigido trocando
por `getByRole('heading', ...)`, que só pega o `<h2>` do cabeçalho da
coluna, nunca as opções do select.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 290 passando (7 testes novos de Contatos — etapas com
contato e campos certos, criar contato numa etapa, editar, avançar de
etapa com a seta, pedir exclusão sem excluir direto, criar etapa nova,
pedir exclusão de etapa sem excluir direto — mais 1 rota nova coberta
pelos audits gerais de CSP/zoom/rolagem lateral), 34 skipped, sem falhas
(Desktop e Mobile 390). `mcp__Supabase__get_advisors`: nenhum item novo de
segurança; performance sem item novo além do padrão já existente de
`created_by` sem índice (mesmo lint que toda outra tabela já tem).

Com isso, a Fase 3 do plano de virar um sistema de gestão completo por
empresa está concluída: painel por produto/turma (seção 43), painel por
área (seção 44), granularidade de tarefa + menu por área (seção 45),
Financeiro (seção 46) e Contatos (esta seção). Próximos incrementos ficam
a critério do usuário — nenhum item pendente conhecido do roadmap
original.

## 48. Reverter menu lateral expandido em "Áreas"

Feedback direto do usuário com print: a seção 45 fez cada área cadastrada
aparecer como sub-item recuado sob "Áreas" no menu — na prática, isso
deixava aquele item com uma aparência de "sempre aberto/expandido",
diferente visualmente de todo o resto do menu (item plano, um por linha).
Revertido: `AppLayout.tsx` volta a tratar "Áreas" como qualquer outro item
da lista — um único link, mesmo ícone, sem sub-itens. Removido junto: a
busca de `departments` da empresa ativa (não tinha mais nenhum uso depois
disso), o campo `indent` de `NavItem` e a lógica de recuo/marcador
(`•`) na renderização do menu.

Entrar no painel de uma área específica continua existindo — só não é
mais um atalho direto no menu; acontece de dentro da tela `/areas`
("Ver painel" em cada linha, já existente desde a seção 44).

**e2e:** o teste que conferia o sub-item recuado (`menu lateral lista a
área cadastrada, recuada sob "Áreas"...`) foi reescrito pro comportamento
novo (`menu lateral mostra "Áreas" como item único, sem listar cada área
cadastrada` — confere que o link "Comercial" NÃO aparece na nav). Um
segundo teste (`lista mostra a área existente...`) tinha um workaround de
escopo (`page.getByRole('main')`) só por causa da colisão com o nome da
área também aparecendo no menu — removido, já que a colisão não existe
mais.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 290 passando (mesmo total de antes — um teste reescrito,
nenhum novo), 34 skipped, sem falhas (Desktop e Mobile 390).

## 49. Metas: status padrão, ativar/desativar, turma futura escondida, cards desktop

Rodada de 6 pedidos do usuário sobre a tela de Metas e os painéis —
debatidos e confirmados antes de implementar (3 perguntas em aberto,
todas respondidas): "desativar" usa `is_active` (não `archived_at`);
turma escondida só nos painéis, leva junto indicador/tarefa/orçamento
dela, aparece no dia 1 do mês e nunca mais some; resumo do topo continua
juntando planejada+ativa (decisão documentada já existente em
`MetasOverview.tsx`, mantida — só o padrão mudou, não o agrupamento).

**1. Status padrão "Planejada":** `metas.status` tinha `default 'active'`
no banco (`0032_metas.sql`) — migração `0042_meta_default_planned.sql`
troca pra `'planned'`. Os dois pontos do código que inserem um alvo sem
passar `status` explícito (fluxo "criar meta com alvo inicial", duas
variantes em `KpisPage.tsx`) ganharam `status: 'planned'` explícito, e o
valor padrão do formulário de alvo (`MetaFormModal`) também trocou.
Só afeta alvo novo — os que já existem mantêm o status que já tinham.

**2 e 3. Ativar/desativar direto na lista:** `kpis.is_active` já existia
e já era filtrado em todo painel (`.eq('is_active', true)`) — faltava só
o atalho de UI. Novo `ctx.toggleKpiActive()` em `KpisPage.tsx` (update de
uma coluna só, sem abrir modal), com botão (ícone `ToggleRight`/
`ToggleLeft`) em `MetaRow`/`MetaCard` (`MetasOverview.tsx`) e no cabeçalho
de `MetaDetail.tsx` — cobre indicador raiz e qualquer produto/turma por
baixo dele. **Achado corrigido junto:** o rollup de soma em cadeia
(`KpisPage.tsx`, `rollupRows`) somava o valor de um filho mesmo
desativado/arquivado — diferente de todo painel, que já exclui isso na
própria consulta. `rollupRows` agora filtra `is_active && !archived_at`
antes de montar a árvore de soma, igualando o comportamento desta tela ao
dos painéis.

**4. Card "metas desativadas":** novo em `CompanyDashboard.tsx` (contagem
por empresa) e `HoldingDashboard.tsx` (contagem do grupo inteiro, sem
link — são várias empresas possíveis, cada uma com a própria tela de
Metas pra reativar). Não traz os dados de volta, só avisa que existem —
evita a sensação de "sumiu sem explicação". Escopo deliberadamente restrito
aos dois painéis "visão geral" (empresa e holding); `ProductDashboard.tsx`/
`DepartmentDashboard.tsx` (painéis mais estreitos) ficam de fora desta
rodada — mecânico de replicar se algum dia fizer falta.

**5. Turma com início em mês futuro:** `ProductDashboard.tsx` ganhou
`editionIsUpcoming()` (compara ano+mês do `start_date` com o mês atual) —
a seção "Turmas" só lista quem já chegou, com um aviso discreto contando
quantas ainda faltam ("N turma(s) programada(s) ainda não aparece(m)
aqui"). Só afeta a listagem deste painel — a tela de Produtos (cadastro)
continua mostrando todas, e uma turma futura acessada direto por link
continua funcionando normalmente (só não aparece "por acaso" na lista).

**6. Cards do desktop reorganizados:** `MetaRow`/`MetaCard`
(`MetasOverview.tsx`) e `ChildRow`/`ChildCard` (`MetaDetail.tsx`) —
cada meta agora é seu próprio cartão (borda + fundo + respiro), igual ao
padrão que já existia só no celular, em vez de uma faixa de linhas
coladas separadas só por uma borda fina (a "bagunça visual" relatada).
**Achado técnico no meio do caminho:** a primeira versão fez o link da
linha inteira virar `display: contents` (pra caber um botão de
ativar/desativar ao lado sem aninhar `<button>` dentro de `<a>`, inválido
em HTML) — quebrou dois testes que usam `boundingBox()` pra conferir
ordem visual (`display: contents` não tem geometria própria, então
`boundingBox()` retorna `null`). Corrigido: o link continua sendo só uma
parte da linha/cartão (o grid de colunas), o botão fica ao lado como
elemento irmão — nunca aninhado, e sempre com geometria própria.

**Verificação:** `npx tsc --noEmit`, `npm run build`, `npm run test`
(48/48) e `npm run check:contrast` (24/24) limpos. `npm run test:e2e`:
suíte completa 296 passando (6 testes novos — status padrão "Planejada"
na criação, toggle ativar/desativar na lista, card de desativadas no
painel, turma futura escondida com datas relativas a "hoje" — mais 2
testes existentes ajustados: um por causa da correção do rollup/mock de
teste, outro pela troca do seletor de "Financeiro" depois de remover o
wrapper `.card` único da lista), 34 skipped, sem falhas (Desktop e Mobile
390). `mcp__Supabase__get_advisors`: nenhum item novo de segurança (a
migração só muda um `default` de coluna, não mexe em RLS/índice).

## 50. Bug: desativar só a raiz deixava produto/turma ativos por baixo

Relato do usuário: "as metas desativadas e sem lançamentos ainda aparecem
no painel das empresas no card metas." Investigação em produção (não em
fixture) encontrou o caso exato: a empresa MDD tinha um indicador raiz
"Faturamento 2027" desativado (`is_active = false`, criado como
planejamento antecipado, nunca lançado), mas seus 4 produtos e 4 turmas
por baixo (`parent_kpi_id` na cadeia) continuavam `is_active = true`,
cada um com o próprio alvo e zero lançamentos.

**Causa raiz**: `toggleKpiActive` (rodada 49, acima) só atualizava a linha
clicada (`eq('id', kpi.id)`) — igual a `archiveKpi`, que também nunca
cascateou. Isso é aceitável pra arquivar (ação mais rara, tela de
histórico), mas quebra a expectativa de ativar/desativar: o cartão da
tela de Metas mostra a família inteira (raiz + produto + turma) como UMA
coisa só; a pessoa clica o botão daquele cartão achando que desativou
"aquilo tudo", mas por baixo só a raiz mudava — os filhos continuavam
100% ativos, contando em `company_snapshots()`/`meta_latest_values` (que
só olham o `is_active` da PRÓPRIA linha, nunca o da cadeia de pais) e
aparecendo com "sem lançamento" no cartão "Metas" do painel da empresa
(`kpiRows`, que lista todo indicador ativo de qualquer nível, não só
raiz).

**Correção**: `KpisPage.tsx` ganhou `descendantIds(kpiId)` (percorre
`childrenByParent` recursivamente, mesma árvore já usada por
`rollupRows`) e `toggleKpiActive` agora atualiza `.in('id', [kpi.id,
...descendantIds(kpi.id)])` numa única chamada — ativar/desativar vale
pra família toda, nos dois sentidos (reativar a raiz também reativa quem
foi desativado só por estar por baixo dela). Toast avisa quando há
vinculados: "Meta e N vinculado(s) desativados/ativados." `archiveKpi`
não mudou nesta rodada — o relato foi especificamente sobre "desativar",
e arquivar já tem o próprio aviso de que não cascateia (comentário em
`KpisPage.tsx`); ficou registrado como decisão deliberada, não descuido.

**Correção retroativa dos dados**: os 8 descendentes já ativos de
"Faturamento 2027" na empresa MDD foram desativados via
`mcp__Supabase__execute_sql` (`update kpis set is_active = false where id
in (<descendentes, achados por CTE recursiva>) and is_active = true`) —
sem isso, o código novo só valeria pra próxima vez que alguém mexesse no
botão; o caso relatado continuaria visível até lá.

**Verificação**: novo teste e2e "desativar a raiz arrasta produto/turma
vinculados junto (cascata)" (`KPI_PRODUCT`/`KPI_EDITION` das fixtures,
que já formam pai→filho) confere que o PATCH sai com os dois ids juntos,
o toast cita o vinculado, e reverter também traz o filho de volta. `npx
tsc --noEmit`, `npm run build`, `npx vitest run` (48/48) e `npm run
check:contrast` (24/24) limpos. `npx playwright test`: suíte completa 298
passando (1 teste novo), 34 skipped, sem falhas (Desktop e Mobile 390).

## 51. Painel: card "Metas" trocado por comparação de produtos + atalho de equipe

Pedido do usuário, com opinião estruturada antes de implementar (aprovada
com "ok, pode seguir"): três mudanças no painel da empresa e da Holding.

**1) Removido o card "Metas"** (`CompanyDashboard.tsx`) — listava até 8
indicadores com valor cru, sem alvo nem contexto, repetindo o que
"Produtos"/"Alvos" já mostravam. Único caso que ele cobria e mais nada
cobria: indicador de empresa (sem produto/turma) cadastrado sem nenhum
lançamento ainda (bug histórico do item #21, "KPI sem lançamento sumia do
painel"). Esse caso ganhou um card próprio, pequeno e só aparece quando
existe: **"Indicadores sem lançamento"**.

**2) No lugar entrou "Comparação entre produtos"** — gráfico de linha,
faturamento de cada produto principal (sem sub-produto) mês a mês, soma
das turmas incluída. Reaproveita o mesmo truque de "folha da árvore" que
`productRevenue` já usa no painel da Holding (`kpiRollup.ts`: um nó do
meio nunca lança direto, só soma os filhos) — aqui como série no tempo em
vez de ranking de um instante só. Só indicador em moeda (mesma razão de
sempre: unidades diferentes não comparam na mesma escala). Precisou de
uma consulta nova (`kpi_values` sem filtro de período, todo o histórico
da empresa — mesmo custo que `KpisPage.tsx` já paga pro histórico de um
indicador).

**3) Atalho de performance por responsável** — pedido literal: "clico em
Felipe e tenho um painel com todas as metas e tarefas dele". Novo módulo
`src/modules/team/PersonDashboard.tsx`, rotas
`/empresa/:companyId/equipe/:userId` e `/holding/usuarios/:userId` (o
`:companyId` só define o link de "voltar" — a tela em si já busca em
TODO o grupo, a RLS decide o que aparece, mesmo padrão de "Minhas
tarefas" na Holding). Mostra toda meta (`meta_latest_values`, todo
nível — diferente dos painéis, que escopam a alvo de empresa inteira de
propósito) e toda tarefa da pessoa, com valor de verdade via o mesmo
rollup group-wide que `HoldingDashboard.tsx` já monta.

**Entrada**: novo card **"Equipe"** no painel da empresa (ranking dos
membros com meta em risco/tarefa vencida, reaproveitando dados já
carregados — sem consulta nova) e **"Equipe do grupo"** na Holding
(mesma ideia, cross-empresa, a partir de `metasEffective` + uma consulta
nova de `profiles`, `is_super_admin()` já dá acesso a todo cadastro).
Nome do responsável no card "Alvos" também virou link — precisou tirar
a linha "prazo" de dentro do `<Link>` da meta (não dá pra aninhar `<a>`
dentro de `<a>`), ficando como um parágrafo próprio logo abaixo.

**Sugestão complementar implementada**: badge "N sem responsável" no
cabeçalho do card "Alvos", quando alguma meta em aberto não tem dono.

**Achado real durante a implementação** (não relacionado ao pedido, mas
bloqueava o card "Indicadores sem lançamento"): três `Kpi` das fixtures
e2e (`KPI_NOVALUE`/`KPI_WITH`/`KPI_EXTRA`) datam de antes do campo
`product_id` existir no tipo e nunca ganharam a chave — em JS,
`objeto.product_id` vira `undefined`, não `null`, então todo filtro
`=== null` (inclusive um pré-existente em `metaRows`, nunca coberto por
teste até agora) falhava silenciosamente pra eles. Postgrest de verdade
NUNCA omite uma coluna nullable — é só as fixtures que mentiam. Corrigido
preenchendo `product_id`/`product_edition_id`/`parent_kpi_id`/
`archived_at`/`entry_frequency`/`department_id: null` explícitos nos
três, em vez de espalhar `?? null`/`!row.product_id` pelo código real
pra tolerar um formato que a API de verdade nunca produz.

**Verificação**: 3 testes e2e novos (linha por produto no gráfico com
dois produtos e dois meses; card "Equipe" leva à performance da pessoa
com meta+tarefa dela visíveis; "Equipe do grupo" na Holding com o mesmo
link). `npx tsc --noEmit`, `npm run build`, `npx vitest run` (48/48) e
`npm run check:contrast` (24/24) limpos. `npx playwright test`: suíte
completa 309 passando (3 testes novos), 35 skipped, sem falhas (Desktop
e Mobile 390).

## 52. Bug do atingimento "down", arquivar turma, e simplificação do painel

Lote de itens do usuário a partir de um screenshot real (empresa MDD).

**1) Bug real corrigido — atingimento de alvo "down" sem teto e invertido
no zero.** Relato: meta "Churn 2026", alvo 5, lançado 1 → painel mostrava
"500%". `attainmentRatio()` (`core/lib/format.ts`) para direção "down"
(menor é melhor) fazia `alvo / valor` sem limite nenhum — um valor pequeno
contra um alvo maior explode o %. Pior: valor **0** (o melhor resultado
possível num "down") caía no `else` e virava **0%**, o oposto do
esperado. Achado ao investigar: dois outros lugares do sistema
(`CompanyDashboard.tsx`'s `kpiAttainment`, `HoldingDashboard.tsx`'s
`attainment`) já tinham descoberto o mesmo problema por conta própria e
já capavam em 300% na mão (com comentário explícito) — só a função
compartilhada, usada em toda barra de progresso do sistema (Alvos,
MetaDetail, ProductDashboard, DepartmentDashboard, PersonDashboard), não
tinha o teto. Centralizado o teto de 300% dentro da própria função (valor
0 agora usa o teto, não zero) e os dois pontos que reimplementavam a
mesma conta na mão foram simplificados pra só chamar `attainmentRatio()`.
Testado com o caso exato do relato (`attainmentRatio(1, 5, 'down')` = 3,
não mais 5) e o caso de valor 0.

**2) Opção de arquivar uma turma/sub-produto.** `ProductEdition` não
tinha nenhum jeito de sumir de vista sem excluir de vez — só `status`
(planejamento/andamento/encerrado, não esconde nada) ou exclusão
permanente. Migração `0043_product_edition_archive.sql` adiciona
`archived_at` (mesmo padrão de `kpis`/`metas`: null = ativa, arquivar não
apaga nada). `ProductsPage.tsx` ganha botão "Arquivar" por turma + seção
recolhida "N turma(s) arquivada(s)" com botão "Reativar". Turma arquivada
sai da lista de candidatas a vincular meta nova (`KpisPage.tsx`'s
`AttachProductModal`) e dos seletores de turma em tarefa/lançamento
financeiro novos (`TaskFormModal.tsx`, `FinancialsPage.tsx`,
`ProductDashboard.tsx`'s lista de "Turmas") — mas continua acessível
direto por link (mesma regra do arquivamento de indicador).

**3) Simplificação do painel da empresa, a pedido do usuário:**
- Removidos os cards "Próximos prazos", "Tarefas por situação" e
  "Indicadores sem lançamento" (este último tinha acabado de nascer na
  rodada anterior — o usuário decidiu não querer nem essa versão
  reduzida do antigo card "Metas"; ficou combinado repensar juntos que
  indicador faz sentido no lugar).
- Card "Comparação entre produtos" estava desproporcionalmente alto: o
  grid de duas colunas esticava o cartão do gráfico pra bater a altura do
  cartão "Alvos" ao lado (`align-items: stretch`, padrão do CSS Grid) —
  corrigido com `items-start` no container.
- Gráfico "Metas: realizado x alvo" cortava os nomes dos alvos
  ("Faturamento", "Churn") nas pontas — margem esquerda/direita do
  `LineChart` era `0`/`8px`, apertada demais pra rótulo de categoria
  centrado na borda. Virou cartão de largura cheia (sobrava só ele depois
  de remover "Tarefas por situação", que dividia a linha com ele) e
  ganhou margem de `16`/`24px`.

**Não implementado nesta rodada — respondido/discutido em texto**:
"como cadastro um responsável" (já existe, campo "Responsável" no form de
Alvo — resposta direta, sem mudança de código); "Orçamento pra dentro do
Financeiro" e "repensar outros indicadores do painel" (opinião dada,
aguardando direção do usuário antes de mexer).

**Verificação**: novo teste unitário (`attainmentRatio` com teto e caso
zero) + 1 novo teste e2e (arquivar/reativar turma) + 1 teste e2e ajustado
(removida a checagem de "Tarefas por situação") + 1 teste e2e reescrito
(o card que ele cobria não existe mais — vira teste de regressão
"continua não aparecendo"). `npx tsc --noEmit`, `npm run build`, `npx
vitest run` (49/49) e `npm run check:contrast` (24/24) limpos. `npx
playwright test`: suíte completa 311 passando (Desktop + Mobile), 35
skipped, sem falhas. `mcp__Supabase__get_advisors`: nenhum item novo (a
migração só adiciona uma coluna nullable + índice, mesmo padrão de
`kpis.archived_at`).
