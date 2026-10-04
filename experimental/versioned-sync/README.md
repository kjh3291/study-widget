# Versioned sync — isolated protocol prototype

This is a **local test prototype**, not a replacement enabled in the widget. It uses Node 24's SQLite and an HTTP server bound only to 127.0.0.1. Production Electron does not import or package these modules. No real profile, Git repository, cloud account, or learning materials are used by the tests.

## Run

```
node experimental/versioned-sync/test.cjs
node experimental/versioned-sync/test-files.cjs
```

Each test creates two independent client profiles and a persistent server database in a temporary directory, then removes only that test directory. The local server uses an ephemeral bearer token. This is single-account test authentication, not production authentication.

## Implemented guarantees

- Each entity has a stable caller-provided ID and server revision. Todos, individual timetable classes and subtasks must be separate entities.
- A write includes the revision that the editor last saw. A stale revision is rejected without changing the stored record.
- Client writes are persisted to an outbox before network activity. Responses lost after a commit can be retried using the same operation ID without duplicate revisions; altered reuse is rejected.
- Concurrent edits are kept locally until an explicit choice. An edit made during upload remains queued.
- History is append-only; deletion creates a versioned tombstone. Restoring an earlier value is a new revision, never removal of newer history.
- A receiving client acknowledges a cursor only after all received records and files have been applied and its local state saved. A conflict, download error, or changed local file prevents acknowledgement.
- Binary files use immutable content hashes. Upload completes before metadata is queued. Downloads are checked before replacement. Changed supplemental/course materials retain the previous version. A remote deletion moves the receiver's file to local `삭제한 파일/<original path>`; that folder is never submitted as an entity.

## Tests and limits

Tests cover HTTP authentication, independent edits, stale writes, conflict persistence and choices, offline/server restart, response-loss retries, edits during upload, history/restore, deletion versus edit, binary versions, corruption, unqueued external edits, local deletion holding, traversal rejection and device acknowledgements.

File blob transfer uses an injected local immutable store in the file test, **not R2**. Supabase deployment, RLS/account isolation, real realtime subscriptions, R2 signed uploads, quota controls and two physical OS clients have **not** been implemented/verified. Node 24 SQLite is a test reference backend, not a backend selected for cloud deployment.

## Required before enabling

1. Connect the user's Supabase and Cloudflare accounts; deploy a private test project only. Keep credentials out of source and distributables.
2. Implement the same atomic revision check, immutable receipts/history and per-account authorization in Supabase; exercise the actual deployed transactions, including simultaneous requests and account isolation.
3. Implement authenticated R2 blob transport and quota limits, and test interrupted uploads/downloads.
4. Add a preview-only migration assigning persistent IDs to timetable classes and subtasks. Check all existing IDs, totals and file hashes; never replace the live shared snapshot during evaluation.
5. Integrate an explicit experimental toggle and status UI, file watcher plus full manual scan, reconnect catch-up and a restore/conflict UI.
6. Verify Mac/Windows using isolated profiles, then back up and switch both devices together. Do not run legacy Git and cloud writers against the same live dataset. Retain Git data for rollback.

Server storage alone does not establish "all devices synced": only a receiver's durable applied cursor does. Offline devices must show pending; acknowledgements are scoped to a captured server revision, not a guarantee that nobody can subsequently edit.
