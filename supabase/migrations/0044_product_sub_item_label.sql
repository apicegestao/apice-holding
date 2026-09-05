-- Sistema atende empresas com naturezas bem diferentes (educação, consultoria,
-- SaaS) — "turma" faz sentido pra MDD, mas não pra um produto de consultoria
-- (projeto) ou SaaS (plano/conta). Em vez de fixar o rótulo no código, cada
-- produto escolhe como chama as próprias unidades; null = usa o padrão
-- "Turma" (comportamento de sempre, sem mudança pra quem não configurar).
alter table public.products add column if not exists sub_item_label text;
