-- ============================================================================
-- Nova frequência: quinzenal. Sozinha nesta migração de propósito — adicionar
-- valor a um enum não pode ser usado (em constraint, default, cast) na mesma
-- transação em que foi criado; separar em migração própria evita esse risco.
-- ============================================================================
alter type kpi_frequency add value if not exists 'biweekly' after 'weekly';
