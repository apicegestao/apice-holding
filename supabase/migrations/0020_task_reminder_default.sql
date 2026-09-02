-- ============================================================================
-- "Lembrete padrão" quer dizer isso: 1 dia antes por padrão, mesmo pra quem
-- cria a tarefa por um caminho que não passa pelo formulário completo (o
-- atalho "virar tarefa" do mapa mental, por exemplo). O formulário já
-- mandava 1 por padrão; agora o próprio banco garante isso pra qualquer
-- jeito de inserir.
-- ============================================================================

alter table public.tasks
  alter column remind_days_before set default 1;
