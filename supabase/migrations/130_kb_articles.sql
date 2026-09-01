-- 130_kb_articles.sql — Phase 16 (S3.3).
-- Org-neutral knowledge copy with resumable snapshot imports and exact cosine search.

create type public.kb_import_status as enum ('running', 'succeeded', 'failed');

create function private.kb_metadata_valid(p_metadata jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
    or octet_length(p_metadata::text) > 8192 then
    return false;
  end if;

  for v_key in select jsonb_object_keys(p_metadata)
  loop
    if v_key not in ('category', 'section', 'tags') then
      return false;
    end if;
  end loop;

  if p_metadata ? 'category'
    and (jsonb_typeof(p_metadata -> 'category') <> 'string'
      or length(p_metadata ->> 'category') not between 1 and 120) then
    return false;
  end if;
  if p_metadata ? 'section'
    and (jsonb_typeof(p_metadata -> 'section') <> 'string'
      or length(p_metadata ->> 'section') not between 1 and 120) then
    return false;
  end if;
  if p_metadata ? 'tags'
    and (jsonb_typeof(p_metadata -> 'tags') <> 'array'
      or jsonb_array_length(p_metadata -> 'tags') > 16
      or exists (
        select 1
        from jsonb_array_elements(p_metadata -> 'tags') as item
        where jsonb_typeof(item) <> 'string' or length(item #>> '{}') not between 1 and 80
      )) then
    return false;
  end if;
  return true;
exception
  when others then return false;
end;
$$;

create function private.kb_cosine_similarity(
  p_left double precision[],
  p_right double precision[]
)
returns double precision
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when cardinality(p_left) <> 64 or cardinality(p_right) <> 64 then null
    when coalesce((select sum(value * value) from unnest(p_left) as value), 0) = 0 then null
    when coalesce((select sum(value * value) from unnest(p_right) as value), 0) = 0 then null
    else
      (select sum(left_value * right_value)
       from unnest(p_left, p_right) as pair(left_value, right_value))
      / sqrt((select sum(value * value) from unnest(p_left) as value))
      / sqrt((select sum(value * value) from unnest(p_right) as value))
  end
$$;

create table public.kb_articles (
  id uuid primary key default extensions.gen_random_uuid(),
  source_article_id text not null unique,
  title text not null,
  body text not null,
  source_url text not null,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  source_checksum text not null,
  embedding double precision[] not null,
  embedding_version text not null,
  embedded_at timestamptz not null,
  first_imported_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now(),
  tombstoned_at timestamptz,
  constraint kb_articles_source_id_shape check (
    source_article_id = btrim(source_article_id)
    and length(source_article_id) between 1 and 200
  ),
  constraint kb_articles_title_length check (length(btrim(title)) between 1 and 240),
  constraint kb_articles_body_length check (length(btrim(body)) between 1 and 40000),
  constraint kb_articles_url_shape check (
    length(source_url) between 1 and 2048 and source_url ~ '^https?://'
  ),
  constraint kb_articles_metadata_shape check (private.kb_metadata_valid(metadata)),
  constraint kb_articles_checksum_shape check (source_checksum ~ '^[0-9a-f]{64}$'),
  constraint kb_articles_embedding_shape check (cardinality(embedding) = 64),
  constraint kb_articles_embedding_finite check (
    array_position(embedding, 'NaN'::double precision) is null
    and array_position(embedding, 'Infinity'::double precision) is null
    and array_position(embedding, '-Infinity'::double precision) is null
  ),
  constraint kb_articles_embedding_version_length check (length(embedding_version) between 1 and 64),
  constraint kb_articles_import_time_order check (last_imported_at >= first_imported_at),
  constraint kb_articles_embedded_time_order check (embedded_at >= first_imported_at)
);

create table public.kb_import_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  driver text not null,
  subject text not null,
  "window" text not null,
  idempotency_key text generated always as (driver || '|' || subject || '|' || "window") stored,
  status public.kb_import_status not null default 'running',
  cursor text,
  source_count integer not null default 0,
  added_count integer not null default 0,
  changed_count integer not null default 0,
  restored_count integer not null default 0,
  unchanged_count integer not null default 0,
  tombstoned_count integer not null default 0,
  embedded_count integer not null default 0,
  error_code text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint kb_import_runs_key_unique unique (driver, subject, "window"),
  constraint kb_import_runs_driver_shape check (driver ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint kb_import_runs_subject_shape check (subject ~ '^[a-z][a-z0-9:_-]{0,127}$'),
  constraint kb_import_runs_window_shape check ("window" ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
  constraint kb_import_runs_cursor_length check (cursor is null or length(cursor) between 1 and 512),
  constraint kb_import_runs_counts_nonnegative check (
    source_count >= 0 and added_count >= 0 and changed_count >= 0
    and restored_count >= 0 and unchanged_count >= 0 and tombstoned_count >= 0
    and embedded_count >= 0
  ),
  constraint kb_import_runs_error_shape check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  constraint kb_import_runs_terminal_shape check (
    (status = 'running' and completed_at is null and error_code is null)
    or (status = 'succeeded' and completed_at is not null and error_code is null)
    or (status = 'failed' and completed_at is null and error_code is not null)
  ),
  constraint kb_import_runs_time_order check (updated_at >= started_at)
);

create table public.kb_import_seen (
  run_id uuid not null references public.kb_import_runs(id) on delete cascade,
  source_article_id text not null,
  source_checksum text not null,
  seen_at timestamptz not null default now(),
  primary key (run_id, source_article_id),
  constraint kb_import_seen_source_id_shape check (
    source_article_id = btrim(source_article_id)
    and length(source_article_id) between 1 and 200
  ),
  constraint kb_import_seen_checksum_shape check (source_checksum ~ '^[0-9a-f]{64}$')
);

create index kb_articles_active_source_idx
  on public.kb_articles(source_article_id)
  where tombstoned_at is null;

create function public.search_kb_articles(
  p_embedding double precision[],
  p_limit integer default 5
)
returns table (
  id uuid,
  source_article_id text,
  title text,
  body text,
  source_url text,
  source_updated_at timestamptz,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select article.id,
    article.source_article_id,
    article.title,
    article.body,
    article.source_url,
    article.source_updated_at,
    article.metadata,
    private.kb_cosine_similarity(article.embedding, p_embedding) as similarity
  from public.kb_articles as article
  where article.tombstoned_at is null
    and cardinality(p_embedding) = 64
    and private.kb_cosine_similarity(article.embedding, p_embedding) is not null
  order by similarity desc, article.source_article_id asc
  limit case when p_limit between 1 and 8 then p_limit else 0 end
$$;

create function public.kb_begin_import(p_driver text, p_subject text, p_window text)
returns public.kb_import_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.kb_import_runs;
begin
  if p_driver !~ '^[a-z][a-z0-9_]{0,31}$'
    or p_subject !~ '^[a-z][a-z0-9:_-]{0,127}$'
    or p_window !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$' then
    raise exception using errcode = '22023', message = 'KB_IMPORT_KEY_INVALID';
  end if;

  insert into public.kb_import_runs (driver, subject, "window")
  values (p_driver, p_subject, p_window)
  on conflict (driver, subject, "window") do update
  set status = case
      when public.kb_import_runs.status = 'failed' then 'running'::public.kb_import_status
      else public.kb_import_runs.status
    end,
    error_code = case when public.kb_import_runs.status = 'failed' then null else public.kb_import_runs.error_code end,
    updated_at = case when public.kb_import_runs.status = 'failed' then now() else public.kb_import_runs.updated_at end
  returning * into v_run;
  return v_run;
end;
$$;

create function public.kb_apply_article(
  p_run_id uuid,
  p_source_article_id text,
  p_title text,
  p_body text,
  p_source_url text,
  p_source_updated_at timestamptz,
  p_metadata jsonb,
  p_source_checksum text,
  p_embedding double precision[],
  p_embedding_version text,
  p_next_cursor text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.kb_import_runs;
  v_article public.kb_articles;
  v_outcome text;
begin
  select * into v_run from public.kb_import_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'running' then
    raise exception using errcode = '55000', message = 'KB_IMPORT_NOT_RUNNING';
  end if;

  select * into v_article
  from public.kb_articles
  where source_article_id = p_source_article_id
  for update;

  if v_article.id is null then
    insert into public.kb_articles (
      source_article_id, title, body, source_url, source_updated_at, metadata,
      source_checksum, embedding, embedding_version, embedded_at
    ) values (
      p_source_article_id, p_title, p_body, p_source_url, p_source_updated_at, p_metadata,
      p_source_checksum, p_embedding, p_embedding_version, now()
    );
    v_outcome := 'added';
  elsif v_article.source_checksum <> p_source_checksum then
    update public.kb_articles set
      title = p_title,
      body = p_body,
      source_url = p_source_url,
      source_updated_at = p_source_updated_at,
      metadata = p_metadata,
      source_checksum = p_source_checksum,
      embedding = p_embedding,
      embedding_version = p_embedding_version,
      embedded_at = now(),
      last_imported_at = now(),
      tombstoned_at = null
    where id = v_article.id;
    v_outcome := 'changed';
  elsif v_article.tombstoned_at is not null then
    update public.kb_articles set last_imported_at = now(), tombstoned_at = null
    where id = v_article.id;
    v_outcome := 'restored';
  else
    update public.kb_articles set last_imported_at = now() where id = v_article.id;
    v_outcome := 'unchanged';
  end if;

  insert into public.kb_import_seen (run_id, source_article_id, source_checksum)
  values (p_run_id, p_source_article_id, p_source_checksum)
  on conflict (run_id, source_article_id) do update
  set source_checksum = excluded.source_checksum, seen_at = now();

  update public.kb_import_runs set
    cursor = nullif(p_next_cursor, ''),
    source_count = (select count(*) from public.kb_import_seen where run_id = p_run_id),
    added_count = added_count + (v_outcome = 'added')::integer,
    changed_count = changed_count + (v_outcome = 'changed')::integer,
    restored_count = restored_count + (v_outcome = 'restored')::integer,
    unchanged_count = unchanged_count + (v_outcome = 'unchanged')::integer,
    embedded_count = embedded_count + (v_outcome in ('added', 'changed'))::integer,
    updated_at = now()
  where id = p_run_id;

  return v_outcome;
end;
$$;

create function public.kb_complete_import(p_run_id uuid)
returns public.kb_import_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.kb_import_runs;
  v_tombstoned integer;
begin
  select * into v_run from public.kb_import_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'running' or v_run.cursor is not null then
    raise exception using errcode = '55000', message = 'KB_IMPORT_INCOMPLETE';
  end if;

  update public.kb_articles as article
  set tombstoned_at = now(), last_imported_at = now()
  where article.tombstoned_at is null
    and not exists (
      select 1 from public.kb_import_seen as seen
      where seen.run_id = p_run_id and seen.source_article_id = article.source_article_id
    );
  get diagnostics v_tombstoned = row_count;

  update public.kb_import_runs set
    status = 'succeeded',
    tombstoned_count = v_tombstoned,
    completed_at = now(),
    updated_at = now(),
    error_code = null
  where id = p_run_id
  returning * into v_run;
  return v_run;
end;
$$;

create function public.kb_fail_import(p_run_id uuid, p_error_code text)
returns public.kb_import_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.kb_import_runs;
begin
  if p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception using errcode = '22023', message = 'KB_ERROR_CODE_INVALID';
  end if;
  update public.kb_import_runs set
    status = 'failed', error_code = p_error_code, completed_at = null, updated_at = now()
  where id = p_run_id and status = 'running'
  returning * into v_run;
  if v_run.id is null then
    raise exception using errcode = '55000', message = 'KB_IMPORT_NOT_RUNNING';
  end if;
  return v_run;
end;
$$;

alter table public.kb_articles enable row level security;
alter table public.kb_articles force row level security;
alter table public.kb_import_runs enable row level security;
alter table public.kb_import_runs force row level security;
alter table public.kb_import_seen enable row level security;
alter table public.kb_import_seen force row level security;

revoke all on table public.kb_articles, public.kb_import_runs, public.kb_import_seen from public, anon, authenticated;
grant select on table public.kb_articles to authenticated;
grant all on table public.kb_articles, public.kb_import_runs, public.kb_import_seen to service_role;

create policy kb_articles_active_select on public.kb_articles
for select to authenticated
using (tombstoned_at is null);

revoke all on function private.kb_metadata_valid(jsonb) from public, anon, authenticated;
revoke all on function private.kb_cosine_similarity(double precision[], double precision[]) from public, anon, authenticated;
grant execute on function private.kb_metadata_valid(jsonb) to authenticated, service_role;
grant execute on function private.kb_cosine_similarity(double precision[], double precision[]) to authenticated, service_role;

revoke all on function public.search_kb_articles(double precision[], integer) from public, anon;
grant execute on function public.search_kb_articles(double precision[], integer) to authenticated, service_role;

revoke all on function public.kb_begin_import(text, text, text) from public, anon, authenticated;
revoke all on function public.kb_apply_article(uuid, text, text, text, text, timestamptz, jsonb, text, double precision[], text, text) from public, anon, authenticated;
revoke all on function public.kb_complete_import(uuid) from public, anon, authenticated;
revoke all on function public.kb_fail_import(uuid, text) from public, anon, authenticated;
grant execute on function public.kb_begin_import(text, text, text) to service_role;
grant execute on function public.kb_apply_article(uuid, text, text, text, text, timestamptz, jsonb, text, double precision[], text, text) to service_role;
grant execute on function public.kb_complete_import(uuid) to service_role;
grant execute on function public.kb_fail_import(uuid, text) to service_role;
