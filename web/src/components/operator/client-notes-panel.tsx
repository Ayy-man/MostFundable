"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ClientNoteClientError,
  createClientNote,
  deleteClientNote,
  loadClientNotes,
  updateClientNote,
} from "@/lib/operator/client-notes.client";
import {
  CLIENT_NOTE_BODY_MAX,
  type ClientNote,
} from "@/lib/operator/client-notes";

type NotesRead =
  | { readonly clientId: string; readonly state: "failed" }
  | { readonly clientId: string; readonly state: "loading" }
  | {
      readonly clientId: string;
      readonly liveLimit: number;
      readonly notes: readonly ClientNote[];
      readonly state: "ready";
      readonly writeBlockedReason: "archived" | "privacy_erased" | null;
    };

interface EditDraft {
  readonly body: string;
  readonly expectedUpdatedAt: string;
  readonly noteId: string;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function replaceNote(notes: readonly ClientNote[], next: ClientNote): readonly ClientNote[] {
  return Object.freeze(notes.map((note) => note.id === next.id ? next : note));
}

function nextRequestId(): string {
  return crypto.randomUUID();
}

export function ClientNotesPanel({
  clientId,
  enabled = true,
}: {
  clientId: string;
  enabled?: boolean;
}) {
  const [read, setRead] = useState<NotesRead>({ clientId, state: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [newBody, setNewBody] = useState("");
  const [newRequestId, setNewRequestId] = useState(nextRequestId);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ clientId: string; message: string } | null>(null);
  const [notice, setNotice] = useState<{ clientId: string; message: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setRead({ clientId, state: "loading" });
      setNewBody("");
      setNewRequestId(nextRequestId());
      setEditDraft(null);
      setDeleteCandidate(null);
    });
    void loadClientNotes(clientId).then(
      (snapshot) => {
        if (active) setRead({ clientId, state: "ready", ...snapshot });
      },
      () => {
        if (active) setRead({ clientId, state: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [clientId, enabled, reloadVersion]);

  const visibleRead: NotesRead | { readonly state: "disabled" } = !enabled
    ? { state: "disabled" }
    : read.clientId === clientId
      ? read
      : { clientId, state: "loading" };
  const notes = visibleRead.state === "ready" ? visibleRead.notes : [];
  const writeBlockedReason = visibleRead.state === "ready"
    ? visibleRead.writeBlockedReason
    : null;
  const activeEdit = editDraft && notes.some((note) => note.id === editDraft.noteId)
    ? editDraft
    : null;
  const currentProblem = problem?.clientId === clientId ? problem.message : null;
  const currentNotice = notice?.clientId === clientId ? notice.message : null;
  const headingId = `client-notes-${clientId}`;

  function startMutation(key: string) {
    setPending(key);
    setProblem(null);
    setNotice(null);
  }

  function mutationFailure(error: unknown) {
    const clientError = error instanceof ClientNoteClientError ? error : null;
    setProblem({
      clientId,
      message: clientError
        ? clientError.message
        : "The note change could not be verified. Reload the notes before trying again.",
    });
    if (clientError?.code === "client_note_stale"
      || clientError?.code === "client_note_not_found"
      || clientError?.code === "client_note_request_conflict"
      || clientError?.code === "client_notes_write_blocked") {
      setEditDraft(null);
      setDeleteCandidate(null);
      setNewBody("");
      setNewRequestId(nextRequestId());
      setReloadVersion((value) => value + 1);
    }
  }

  async function submitNewNote() {
    startMutation("create");
    try {
      const note = await createClientNote(clientId, { body: newBody, requestId: newRequestId });
      setRead((current) => current.clientId === clientId && current.state === "ready"
        ? { ...current, notes: Object.freeze([note, ...current.notes]) }
        : current);
      setNewBody("");
      setNewRequestId(nextRequestId());
      setNotice({ clientId, message: "Private client note saved." });
    } catch (error) {
      mutationFailure(error);
    } finally {
      setPending(null);
    }
  }

  async function submitEdit() {
    if (!activeEdit) return;
    startMutation(`edit:${activeEdit.noteId}`);
    try {
      const note = await updateClientNote(clientId, activeEdit.noteId, {
        body: activeEdit.body,
        expectedUpdatedAt: activeEdit.expectedUpdatedAt,
      });
      setRead((current) => current.clientId === clientId && current.state === "ready"
        ? { ...current, notes: replaceNote(current.notes, note) }
        : current);
      setEditDraft(null);
      setNotice({ clientId, message: "Private client note updated." });
    } catch (error) {
      mutationFailure(error);
    } finally {
      setPending(null);
    }
  }

  async function confirmDelete(note: ClientNote) {
    startMutation(`delete:${note.id}`);
    try {
      await deleteClientNote(clientId, note.id, { expectedUpdatedAt: note.updatedAt });
      setRead((current) => current.clientId === clientId && current.state === "ready"
        ? { ...current, notes: Object.freeze(current.notes.filter((candidate) => candidate.id !== note.id)) }
        : current);
      setDeleteCandidate(null);
      if (editDraft?.noteId === note.id) setEditDraft(null);
      setNotice({ clientId, message: "Private client note deleted." });
    } catch (error) {
      mutationFailure(error);
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-border pt-5">
      <div className="flex items-start gap-2">
        <LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold" id={headingId}>Private client notes</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            These notes are stored on the client record for workspace operators. Consumers never see them in messages or their portal.
          </p>
        </div>
      </div>

      {currentProblem ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {currentProblem}
        </p>
      ) : null}
      {currentNotice ? (
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" role="status">
          {currentNotice}
        </p>
      ) : null}

      {visibleRead.state === "disabled" ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Private client notes are not enabled for this workspace.
        </p>
      ) : visibleRead.state === "loading" ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          Loading private client notes…
        </p>
      ) : visibleRead.state === "failed" ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive" role="alert">
            Private client notes could not be loaded. No notes are being inferred.
          </p>
          <Button className="mt-3" onClick={() => setReloadVersion((value) => value + 1)} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      ) : (
        <>
          {writeBlockedReason ? (
            <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status">
              {writeBlockedReason === "privacy_erased"
                ? "This client was privacy-erased, so private notes are permanently read-only."
                : "This client is archived, so private notes are read-only until the client is reactivated."}
            </p>
          ) : (
            <form
              className="mt-4 rounded-lg border border-border bg-muted/20 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitNewNote();
              }}
            >
              <fieldset disabled={pending !== null}>
                <Label htmlFor={`new-client-note-${clientId}`}>Add a private note</Label>
                <Textarea
                  className="mt-2 min-h-24 resize-y"
                  id={`new-client-note-${clientId}`}
                  maxLength={CLIENT_NOTE_BODY_MAX}
                  onChange={(event) => setNewBody(event.target.value)}
                  placeholder="Add context for the funding team"
                  value={newBody}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {newBody.length}/{CLIENT_NOTE_BODY_MAX} · {notes.length} of {visibleRead.liveLimit} active notes
                  </span>
                  <Button disabled={newBody.trim().length === 0} size="sm" type="submit">
                    {pending === "create" ? "Saving…" : "Save note"}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}

          {notes.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              No private notes have been recorded for this client.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {notes.map((note) => {
                const editing = activeEdit?.noteId === note.id;
                const confirmingDelete = deleteCandidate === note.id;
                return (
                  <li className="rounded-lg border border-border p-3" key={note.id}>
                    {editing && activeEdit ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitEdit();
                        }}
                      >
                        <Label htmlFor={`edit-client-note-${note.id}`}>Edit private note</Label>
                        <Textarea
                          className="mt-2 min-h-24 resize-y"
                          id={`edit-client-note-${note.id}`}
                          maxLength={CLIENT_NOTE_BODY_MAX}
                          onChange={(event) => setEditDraft({ ...activeEdit, body: event.target.value })}
                          value={activeEdit.body}
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {activeEdit.body.length}/{CLIENT_NOTE_BODY_MAX}
                          </span>
                          <div className="flex gap-2">
                            <Button disabled={pending !== null} onClick={() => setEditDraft(null)} size="sm" type="button" variant="ghost">Cancel</Button>
                            <Button disabled={pending !== null || activeEdit.body.trim().length === 0} size="sm" type="submit">
                              {pending === `edit:${note.id}` ? "Saving…" : "Save changes"}
                            </Button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{note.body}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {note.createdByName} · {displayDate(note.createdAt)}
                          {note.updatedAt !== note.createdAt
                            ? ` · Edited by ${note.updatedByName} ${displayDate(note.updatedAt)}`
                            : ""}
                        </p>
                        {writeBlockedReason === null ? <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            disabled={pending !== null}
                            onClick={() => {
                              setDeleteCandidate(null);
                              setEditDraft({ body: note.body, expectedUpdatedAt: note.updatedAt, noteId: note.id });
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Edit
                          </Button>
                          {confirmingDelete ? (
                            <>
                              <Button disabled={pending !== null} onClick={() => setDeleteCandidate(null)} size="sm" variant="ghost">Cancel</Button>
                              <Button disabled={pending !== null} onClick={() => { void confirmDelete(note); }} size="sm" variant="destructive">
                                {pending === `delete:${note.id}` ? "Deleting…" : "Confirm delete"}
                              </Button>
                            </>
                          ) : (
                            <Button
                              disabled={pending !== null}
                              onClick={() => {
                                setEditDraft(null);
                                setDeleteCandidate(note.id);
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              Delete
                            </Button>
                          )}
                        </div> : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
