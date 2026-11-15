-- Run once in the Supabase SQL editor. Re-running is safe for this version.
begin;
create schema if not exists lsc_private;
revoke all on schema lsc_private from public, anon;
grant usage on schema lsc_private to authenticated;

create table if not exists lsc_private.sync_clocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0
);
revoke all on lsc_private.sync_clocks from public, anon, authenticated;

create table if not exists public.lsc_sync_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('round','profile','background')),
  id text not null check (length(id) between 1 and 160),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),
  revision bigint not null check (revision>0),
  updated_at timestamptz not null default now(),
  primary key(user_id,kind,id),
  unique(user_id,revision)
);
alter table public.lsc_sync_records enable row level security;
revoke all on public.lsc_sync_records from public, anon, authenticated;
grant select on public.lsc_sync_records to authenticated;
drop policy if exists lsc_read_own on public.lsc_sync_records;
create policy lsc_read_own on public.lsc_sync_records for select to authenticated
  using ((select auth.uid())=user_id);

-- Writes use a private, fixed-search-path function with an explicit auth check.
-- The public RPC wrapper cannot choose a user_id or bypass the revision check.
create or replace function lsc_private.apply_record(p_kind text,p_id text,p_payload jsonb,p_expected bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  old public.lsc_sync_records%rowtype;
  next_revision bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('round','profile','background') or p_id is null or length(p_id) not between 1 and 160
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>524288
    or p_expected is null or p_expected<0 then raise exception 'Invalid sync record' using errcode='22023'; end if;
  insert into lsc_private.sync_clocks(user_id) values(uid) on conflict do nothing;
  -- A per-user transaction lock makes cursor revisions follow commit order.
  perform 1 from lsc_private.sync_clocks where user_id=uid for update;
  select * into old from public.lsc_sync_records where user_id=uid and kind=p_kind and id=p_id;
  if coalesce(old.revision,0)<>p_expected then
    return jsonb_build_object('applied',false,'record',to_jsonb(old)-'user_id');
  end if;
  if old.payload=p_payload then
    return jsonb_build_object('applied',true,'record',to_jsonb(old)-'user_id');
  end if;
  update lsc_private.sync_clocks set revision=revision+1 where user_id=uid returning revision into next_revision;
  insert into public.lsc_sync_records(user_id,kind,id,payload,revision,updated_at)
    values(uid,p_kind,p_id,p_payload,next_revision,now())
    on conflict(user_id,kind,id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at
    returning * into old;
  return jsonb_build_object('applied',true,'record',to_jsonb(old)-'user_id');
end;
$$;
revoke all on function lsc_private.apply_record(text,text,jsonb,bigint) from public, anon;
grant execute on function lsc_private.apply_record(text,text,jsonb,bigint) to authenticated;

create or replace function public.lsc_sync_apply(p_kind text,p_id text,p_payload jsonb,p_expected bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select lsc_private.apply_record(p_kind,p_id,p_payload,p_expected);
$$;
revoke all on function public.lsc_sync_apply(text,text,jsonb,bigint) from public, anon;
grant execute on function public.lsc_sync_apply(text,text,jsonb,bigint) to authenticated;
commit;
