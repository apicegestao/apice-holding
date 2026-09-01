-- search_path fixo em todas as funcoes, para que ninguem consiga sequestrar
-- uma chamada criando um objeto de mesmo nome em outro schema.
alter function app.touch_updated_at() set search_path = public, pg_temp;
alter function app.sync_task_completion() set search_path = public, pg_temp;
alter function app.guard_profile_privileges() set search_path = public, pg_temp;
