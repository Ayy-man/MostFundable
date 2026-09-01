-- R2A-13: outcome rows are the sole authority for the derived fee basis.

revoke all on function public.fees_set_outcome_basis(uuid, bigint, text)
  from public, anon, authenticated, service_role;
