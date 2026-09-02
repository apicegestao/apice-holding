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
