-- The server-side grounded answer engine calls the invoker-mode search RPC
-- through the service client. EXECUTE on the private helper is insufficient
-- without schema USAGE, so grant only that namespace permission; individual
-- private functions remain separately revoked and allow-listed.
grant usage on schema private to service_role;
