-- R3A-04: clients leave the active book through the governed archive lifecycle.

revoke delete on table public.clients from authenticated;
drop policy if exists clients_operator_delete on public.clients;
