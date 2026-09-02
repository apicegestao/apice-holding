-- ============================================================================
-- Notas de tarefa podiam ser criadas e apagadas, mas não editadas — só dava
-- pra corrigir um erro de digitação apagando a nota inteira e escrevendo de
-- novo (perdendo a hora original). Autor edita a própria nota.
-- ============================================================================

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
