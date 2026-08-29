-- ===========================================================================
-- Motor: execucoes_agentes e aprovacoes (SPEC.md secao 3)
-- Seguro de rodar mais de uma vez (idempotente).
-- ===========================================================================

-- Tabela execucoes_agentes ---------------------------------------------------
create table if not exists execucoes_agentes (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  item_tipo text not null,
  item_id text not null,
  agente text not null,
  chamado_por uuid references execucoes_agentes(id),
  status text not null default 'rodando',
  entrada jsonb,
  saida jsonb,
  erro text,
  tokens_entrada int,
  tokens_saida int,
  inicio timestamptz not null default now(),
  fim timestamptz
);

create index if not exists execucoes_agentes_item_id_idx on execucoes_agentes (item_id);
create index if not exists execucoes_agentes_chamado_por_idx on execucoes_agentes (chamado_por);

alter table execucoes_agentes enable row level security;

drop policy if exists "usuarios autenticados leem execucoes_agentes" on execucoes_agentes;
create policy "usuarios autenticados leem execucoes_agentes"
  on execucoes_agentes for select
  to authenticated
  using (true);

-- Realtime (equivalente a marcar a tabela em Database > Replication)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'execucoes_agentes'
  ) then
    alter publication supabase_realtime add table execucoes_agentes;
  end if;
end $$;

-- Tabela aprovacoes -----------------------------------------------------------
create table if not exists aprovacoes (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  item_tipo text not null,
  item_id text not null,
  titulo text not null,
  proposta jsonb,
  status text not null default 'pendente',
  decidido_por uuid references perfis(id),
  decidido_em timestamptz,
  observacao text
);

create index if not exists aprovacoes_area_status_idx on aprovacoes (area, status);

alter table aprovacoes enable row level security;

drop policy if exists "usuarios autenticados leem aprovacoes" on aprovacoes;
create policy "usuarios autenticados leem aprovacoes"
  on aprovacoes for select
  to authenticated
  using (true);

drop policy if exists "usuarios autenticados decidem aprovacoes" on aprovacoes;
create policy "usuarios autenticados decidem aprovacoes"
  on aprovacoes for update
  to authenticated
  using (true)
  with check (true);
