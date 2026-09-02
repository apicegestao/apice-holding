-- ============================================================================
-- O mapa mental (organograma arrastável, pouco usado) vira um bloco de notas
-- simples — e a diferença que importa não é a interface, é a privacidade:
-- uma nota é só de quem escreveu, nem outro admin da mesma empresa enxerga.
-- Por isso este é o único módulo do sistema cuja policy de SELECT não usa
-- app.is_member(company_id) — a regra aqui é "só quem escreveu", não "quem
-- tem acesso à empresa".
--
-- Nada de mapa mental sobrevive à troca — conferido antes de aplicar: só
-- dado de exemplo (1 mapa, 2 nós, nenhuma tarefa vinculada), nada real.
-- ============================================================================

alter table public.tasks drop column if exists mind_map_node_id;
drop table if exists public.mind_map_nodes;
drop table if exists public.mind_maps;

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null default 'Nova nota',
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_lookup_idx on public.notes (company_id, user_id, updated_at desc);

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function app.touch_updated_at();

alter table public.notes enable row level security;

-- Só quem escreveu enxerga e mexe — nem outro membro da mesma empresa, nem
-- admin dela. Escrever ainda exige pertencer à empresa (app.is_member), pra
-- não sobrar nota "órfã" numa empresa de que a pessoa nem faz mais parte.
create policy notes_select on public.notes for select to authenticated
  using (user_id = auth.uid());
create policy notes_write on public.notes for all to authenticated
  using (user_id = auth.uid() and app.is_member(company_id))
  with check (user_id = auth.uid() and app.is_member(company_id));
