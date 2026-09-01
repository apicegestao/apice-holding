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
