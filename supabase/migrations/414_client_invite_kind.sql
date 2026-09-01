-- A consumer invitation is a distinct identity binding. Keeping it in the
-- closed invite enum lets delivery, expiry, replay protection and acceptance
-- use the same durable rail as team and affiliate invitations.

alter type public.tenant_invite_kind
  add value if not exists 'client';
