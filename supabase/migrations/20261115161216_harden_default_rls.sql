-- Supabase's optional automatic-RLS event trigger is an administrator helper.
-- Keep the trigger enabled while removing client execution privileges.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc
    where oid = to_regprocedure('public.rls_auto_enable()')
      and prorettype = 'pg_catalog.event_trigger'::regtype
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
