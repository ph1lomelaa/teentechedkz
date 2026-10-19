# Google Drive recording import — local preview

Implemented on branch `codex/drive-recording-import`. Production is unchanged.

The recording screen in both CRM and workspace exposes Meeting link, Google Drive and File upload. Public link-shared Drive media files use a server-side import job. Private files can instead be downloaded by their owner and uploaded through the restored file panel. Folder/Docs links are not supported.

The importer extracts a Drive file ID/resource key, builds its own download URL, validates each HTTPS redirect against specific Google download hosts, handles the large-file confirmation form, checks content length and streamed size (300 MiB limit), rejects error pages/documents, and uses the existing STT/quality/note-generation pipeline. A total download deadline and redirect/form limits bound requests. Drive source credentials expire in Redis after one hour and are excluded from job arguments; worker HTTP request URL logging is suppressed.

An atomic session claim protects against concurrent Drive/file imports. Session status persists downloading, transcribing, note generation and errors; page navigation does not cancel a queued job. Failed imports allow retry via Drive or file. Stale/cancelled attempts cannot overwrite a new import. No schema migration is required.

Validation:
- Existing backend suite: 1083 passed, 1 skipped (host run excluding the Drive downloader module, which requires libmagic).
- New endpoint/worker tests: 9 passed on host.
- New downloader tests: 8 passed in Docker with libmagic, including confirmation forms, resource keys, redirect restrictions, private/missing/quota responses, renamed PDF, empty data, advertised/streamed size limits and timeout.
- Frontend full suite: 557 passed; subsequent page integration tests: 2 passed for CRM/workspace source selection and retained input.
- Lint, TypeScript and production frontend build passed; build uses local API port 8116.
- Local E2E passed with real API/PostgreSQL/Redis worker/MinIO, testing success, closed file, oversize, wrong format, duplicate request protection, and direct file upload. Google HTTP, Deepgram and AI responses were fixtures restricted to the disposable E2E process. These tests do not establish successful real Google Drive access or speech recognition.

Local preview: http://localhost:3016/workspace/meetings/session/eec3bbef-dd52-4e6c-bf39-0a4508188dd9
Fixture note: http://localhost:3016/workspace/meetings/notes/100e16c0-7127-48d7-921e-558eaa244dea

Remaining live check: a real short link-shared Drive recording plus authorized local transcription/AI credentials. Automatic approval rejected copying production Deepgram/OpenAI keys into local Docker without explicit authorization; no keys were copied. A persistent real worker with those credentials has therefore not been started. Browser visual automation was unavailable in this session; preview is ready for user inspection. Do not deploy until local live/visual review.
