-- ============================================================================
-- Módulo Mapa Mental
-- ============================================================================

create table if not exists public.mind_maps (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  title       text not null,
  description text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mind_maps_company_idx on public.mind_maps (company_id, updated_at desc);

drop trigger if exists mind_maps_touch on public.mind_maps;
create trigger mind_maps_touch before update on public.mind_maps
  for each row execute function app.touch_updated_at();

create table if not exists public.mind_map_nodes (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references public.mind_maps (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  parent_id   uuid references public.mind_map_nodes (id) on delete cascade,
  label       text not null default 'Nova ideia',
  notes       text,
  color       text not null default '#0EA5E9',
  position_x  double precision not null default 0,
  position_y  double precision not null default 0,
  collapsed   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mind_map_nodes_map_idx on public.mind_map_nodes (map_id);

drop trigger if exists mind_map_nodes_touch on public.mind_map_nodes;
create trigger mind_map_nodes_touch before update on public.mind_map_nodes
  for each row execute function app.touch_updated_at();

alter table public.tasks
  drop constraint if exists tasks_mind_map_node_id_fkey;
alter table public.tasks
  add constraint tasks_mind_map_node_id_fkey
  foreign key (mind_map_node_id) references public.mind_map_nodes (id) on delete set null;

-- ---------------------------------------------------------------- RLS
alter table public.mind_maps      enable row level security;
alter table public.mind_map_nodes enable row level security;

drop policy if exists mind_maps_select on public.mind_maps;
create policy mind_maps_select on public.mind_maps for select to authenticated
  using (app.is_member(company_id));
drop policy if exists mind_maps_write on public.mind_maps;
create policy mind_maps_write on public.mind_maps for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

drop policy if exists mind_map_nodes_select on public.mind_map_nodes;
create policy mind_map_nodes_select on public.mind_map_nodes for select to authenticated
  using (app.is_member(company_id));
drop policy if exists mind_map_nodes_write on public.mind_map_nodes;
create policy mind_map_nodes_write on public.mind_map_nodes for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));
