-- R3A-09: application-note authority comes from the stored author profile.

create or replace function private.guard_application_note_actor_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_kind text;
begin
  v_author_kind := private.session_actor_kind(new.author_profile_id);
  if v_author_kind not in ('consumer', 'operator')
    or new.author_kind::text is distinct from v_author_kind
  then
    raise exception using errcode = '42501', message = 'APPLICATION_NOTE_ACTOR_MISMATCH';
  end if;
  new.author_kind := v_author_kind::public.application_note_author_kind;
  return new;
end;
$$;

revoke all on function private.guard_application_note_actor_kind()
  from public, anon, authenticated, service_role;

drop trigger if exists application_notes_guard_actor_kind on public.application_notes;
create trigger application_notes_guard_actor_kind
before insert on public.application_notes
for each row execute function private.guard_application_note_actor_kind();
alter table public.application_notes enable always trigger application_notes_guard_actor_kind;
