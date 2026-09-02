-- ============================================================================
-- Varredura de segurança — três correções reais, nenhuma muda comportamento
-- visível do sistema (a aplicação nunca dependeu do que está sendo fechado
-- aqui; só quem tentasse contornar a interface é que perde acesso).
-- ============================================================================

-- 1) company_members permitia que QUALQUER admin de empresa inserisse uma
-- linha com o próprio company_id mas um user_id arbitrário (a policy só
-- confere o company_id, nunca o user_id) — ou seja, um admin de uma empresa
-- conseguiria anexar qualquer outra conta do sistema (até um super admin) ao
-- próprio time, com o papel que quisesse, direto pela API REST, sem passar
-- pela Edge Function admin-users e suas checagens. O app inteiro (conferido:
-- nenhuma tela do sistema grava nesta tabela pelo cliente) só lê esta tabela
-- do lado do cliente — toda escrita já vem da Edge Function admin-users, que
-- roda com service_role (e service_role sempre ignora RLS). Fechar a escrita
-- pra authenticated não muda nada que o sistema realmente faz.
drop policy if exists company_members_write on public.company_members;

-- 2) app.system_settings está sem RLS. Na prática já não dava pra ler/gravar
-- por anon/authenticated (grant explícito só pra service_role desde a
-- migração 0007, e o schema "app" nem é exposto pela API) — mas é o tipo de
-- proteção que devia estar em toda tabela por padrão, não por causa de duas
-- outras camadas coincidirem. service_role ignora RLS (rolbypassrls), então
-- a Edge Function que já usa esta tabela continua funcionando igual.
alter table app.system_settings enable row level security;

-- 3) Uma função sem search_path fixo herda o search_path de quem a chama —
-- praticamente inofensivo aqui (não é security definer, roda com o
-- privilégio de quem editou a tarefa), mas todas as outras funções do
-- sistema já são fixadas (migração 0011) e esta ficou de fora por ter
-- nascido depois. Alinhando com o padrão.
alter function app.sync_task_reminder() set search_path = public, pg_temp;
