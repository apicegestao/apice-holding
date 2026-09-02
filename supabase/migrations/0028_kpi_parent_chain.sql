-- ============================================================================
-- A cadeia de metas pode ter mais de dois níveis: sub-produto (turma) soma
-- pro produto, que por sua vez pode somar pra uma meta da empresa toda
-- (ex.: "Imersão Set/2026" → "Entre Donos" → "Faturamento da MDD"). A
-- guarda antiga travava em só dois níveis; agora o que importa é não formar
-- ciclo (A não pode contribuir pra B se B já contribui, direta ou
-- indiretamente, pra A) — profundidade em si não tem limite de negócio.
-- ============================================================================

create or replace function app.assert_kpi_parent()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  parent record;
  cursor_id uuid;
  depth integer := 0;
begin
  if new.parent_kpi_id is null then
    return new;
  end if;
  if new.parent_kpi_id = new.id then
    raise exception 'Um KPI não pode ser pai dele mesmo';
  end if;

  select company_id, parent_kpi_id into parent from public.kpis where id = new.parent_kpi_id;
  if not found then
    raise exception 'KPI pai % não encontrado', new.parent_kpi_id;
  end if;
  if parent.company_id is distinct from new.company_id then
    raise exception 'O KPI pai precisa ser da mesma empresa';
  end if;

  -- Sobe a cadeia a partir do pai proposto: se em algum ponto encontrar o
  -- próprio KPI que está sendo salvo, fechar essa ligação formaria um
  -- ciclo — nunca deveria acontecer via UI (o formulário só oferece pais
  -- "de ponta", sem pai próprio), mas a guarda fica no banco por segurança.
  cursor_id := parent.parent_kpi_id;
  while cursor_id is not null loop
    depth := depth + 1;
    if depth > 20 then
      raise exception 'Cadeia de KPIs pai/filho longa demais — verifique se não há um ciclo';
    end if;
    if cursor_id = new.id then
      raise exception 'Isso formaria um ciclo: % já depende, direta ou indiretamente, de %', new.parent_kpi_id, new.id;
    end if;
    select parent_kpi_id into cursor_id from public.kpis where id = cursor_id;
  end loop;

  return new;
end $$;
