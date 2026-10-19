# Student profiles, materials and mentor supervision — 2026-10-19

The workspace student profile uses the same horizontal section navigation as the CRM card. Documents and meeting notes each have a separate top-level tab; tasks and confidential working notes remain under Tasks and records. Visited panels preserve drafts and upload selection. Legacy workspace confidential-note anchors remain supported. The meeting-note create link now uses a valid query string in both shells, and saved note titles appear in the list.

Existing CRM sections remain available according to permissions: roadmaps, deadlines and subtasks, meetings, applications, shortlist, admission credentials, activities, team, services, contacts, contracts and payments, reconciliation, portal access and history. Profile editing, export and header actions remain available.

Admin, MZK manager and academic head now default to all students in the workspace instead of an empty personal-assignment scope. A visible supervisor selector offers all students, own students, or a specific mentor. Meeting/note cache keys include the selected scope. Mentor requests retain their existing personal scope.

`GET /conversations` accepts optional `scope=all|mine` (default mine, backwards compatible). The all scope without a mentor filter is restricted to the three supervisor roles and lists active-student conversations in one database query. Staff-only private conversations are excluded. Nonmember observers can read student conversations but do not gain membership or sending rights. Workspace chat requests respect the selected scope.

The Sheets and Notion inboxes have independent close controls preserving other URL filters. Failed loads and link failures show retry/error states. Successful links invalidate card caches. The Notion inbox and bulk link share eligibility rules and explain skipped matches. Duplicate and ambiguous identities remain protected.

## Local preview

New code is running in the existing local Docker project at http://localhost:3016 with backend port 8116. A separate database `student_card_tabs_20261019` uses schema 119. The previous `student_card` database (an unrelated local schema 117) is retained and backed up; it was not migrated or reset. The existing demonstration student URL with UUID `fc65a60e-7f4f-4e80-a3bd-187410d352b8` remains valid. Only demo fixtures were created. External sync credentials are empty and automatic intake/Notion writes are disabled.

Compose override and preview fixture/check scripts are local-only under `/tmp/tte-student-card-tabs`. The frontend is built with `VITE_LOCAL_API_PORT=8116` and served by Docker. Production deployment is held for the user's visual review; no main merge or production deployment was performed.

## Validation

- Frontend suite: 539 passed. Final saved-title change: both affected meeting-note tests passed.
- Backend suite: 1061 passed, one skipped.
- Frontend lint, TypeScript and production build passed.
- Local HTTP/API: mentor document upload, download, note and note-session creation passed. All three supervisor roles could read the mentor's documents and notes with no assignment to the student, both globally and via mentor filter.
- Local chat API: all three supervisor roles could inspect student conversations; nonmember sending was rejected. Mentor and student all-scope listing was rejected.
- Browser automation was unavailable (browser app-server could not start); visual approval remains with the user on the running Docker preview.
