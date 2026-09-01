-- R4A-02: an application write requires an operator or platform-admin caller.
--
-- Migration 080 scoped both write policies through `private.can_access_client`
-- and the tenant wall alone. `can_access_client` is true for a consumer's own
-- client, so a consumer's own JWT reached the operator tracker directly through
-- the Data API and stored caller-chosen `operator_status`, `consumer_status`,
-- `amount_cents` and `visibility`. Migration 317 froze the identity columns and
-- deliberately left those four mutable for `updateApplication`; nobody asked who
-- else could reach them. This adds the missing caller-kind predicate and changes
-- nothing else: `applications_select_scoped` stays open so a consumer keeps
-- reading their own applications, and `application_notes_insert_scoped` stays
-- consumer-reachable because R3A-09 derives `author_kind` from the stored role.
--
-- `private.session_actor_kind` is a policy predicate now, and RLS quals are
-- executed with the querying role's privileges, so `authenticated` must hold
-- EXECUTE or every write — the operator's included — raises 42501 instead of
-- evaluating. The grant matches the other four policy helpers
-- (`auth_app_role`, `auth_org_id`, `can_access_client`, `tenant_write_allowed`),
-- and `private` is not a PostgREST-exposed schema, so the function gains no
-- callable surface of its own.

grant execute on function private.session_actor_kind(uuid) to authenticated;

alter policy applications_insert_scoped on public.applications
with check (
  (select private.session_actor_kind((select auth.uid())) in ('operator', 'platform_admin'))
  and (select private.can_access_client(client_id))
  and (select private.tenant_write_allowed(private.auth_org_id()))
);

alter policy applications_update_scoped on public.applications
using (
  (select private.session_actor_kind((select auth.uid())) in ('operator', 'platform_admin'))
  and (select private.can_access_client(client_id))
  and (select private.tenant_write_allowed(private.auth_org_id()))
)
with check (
  (select private.session_actor_kind((select auth.uid())) in ('operator', 'platform_admin'))
  and (select private.can_access_client(client_id))
  and (select private.tenant_write_allowed(private.auth_org_id()))
);
