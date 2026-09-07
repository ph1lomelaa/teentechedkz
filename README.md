# TeenTechEd CRM

An operations platform for a university-admissions consultancy: it runs the full
client lifecycle from an inbound lead to an enrolled student, and it runs the
company's own working regulations on top of that — mentor assignment, service
delivery, quality reviews, complaints, refunds and payouts.

The system replaced a stack of Notion boards, Google Forms and spreadsheets. Those
sources are still read (staff kept working in them during the migration), but the
database is now the source of truth.

- **How it is built inside** — [ARCHITECTURE.md](ARCHITECTURE.md)
  (web tier vs. worker, queues, WebSocket fan-out, integration patterns).
- **How to run it** — [docs/SETUP.md](docs/SETUP.md).

---

## 1. Problem domain

A consultancy guides school students through applying to foreign universities.
One student means a signed contract, a paid package of services, several country
applications, a personal roadmap of deadlines, a team of mentors, dozens of
documents, and a year or more of meetings and messaging.

Three things made spreadsheets stop working:

1. **No single record of a student.** Contract terms lived in one sheet, the
   admissions progress in another, mentor notes in Telegram, documents in Drive.
   Answering "where is this student right now" required a person who remembered.
2. **Nothing enforced the regulations.** The company has written rules — response
   deadlines, mandatory mentor roles per student, monthly quality reviews,
   penalties and bonuses. A document cannot enforce itself.
3. **No accountability trail.** Who changed a status, who saw a passport scan, who
   approved staff access — none of it was recoverable.

The system is built around those three gaps, which is why so much of it is
assignment, status, deadline and audit machinery rather than CRUD screens.

---

## 2. Roles and access model

Four roles: `admin`, `mzk_manager`, `mentor`, `student`.

| Role | Scope |
|---|---|
| `admin` | Everything, including the permission registry and staff accounts. |
| `mzk_manager` | Account/quality manager: owns the client relationship, reviews mentor work, handles complaints and refunds. |
| `mentor` | Sees **only** students they are assigned to, enforced server-side. |
| `student` | Client-facing portal account, linked to exactly one student record. |

Access is resource-based, not role-based at the call site. A central registry
(`backend/app/core/permissions.py`) maps `(resource, action)` pairs to roles, with
per-user overrides stored in the database and edited from an admin screen. Mentor
scoping is a separate layer: a mentor who is not assigned to a student gets `404`,
not `403` — the existence of the record is not disclosed.

**Why a registry rather than checks in each handler.** Access rules previously
lived in ~30 hand-written helpers. An audit found three helpers with the same name
and three different behaviours, and helpers whose name contradicted their body. A
conformance test now asserts the registry and the remaining legacy helpers answer
identically, so the two cannot drift.

---

## 3. Functional scope

### 3.1 Client lifecycle

- **Student record** — profile, guardians, emergency contacts, target degree and
  intake year, work folder, company-issued working phone.
- **Contracts** with a pipeline status (`active_work`, `paused`, `suspended`,
  `no_status`, …), amendments, and a renewal signal that fires before a contract
  ages out.
- **Payments** — schedule, actual receipts, mentor payouts, and a background
  notifier that warns the student, the mentors and the managers about upcoming and
  overdue instalments.
- **Services** — what was actually sold (career guidance, IELTS mock, IELTS/SAT
  prep, portfolio work), each with its own status and assigned specialist.

### 3.2 Admissions

- **Applications** per country, with submission and visa status.
- **University reference** and a per-student shortlist, plus scholarships.
- **Roadmaps** — reusable templates authored by staff become live per-student
  roadmaps with stages, tasks and subtasks. A student may run several roadmaps at
  once (parallel applications to different countries).
- **Questionnaires** attached to roadmap tasks — the student fills them in the
  portal, staff reads structured answers instead of chat messages.

Students **cannot** move their own roadmap statuses. Progress is confirmed by a
mentor; the student fills questionnaires and watches progress. This is a
deliberate restriction — self-reported completion diverged from the real process.

### 3.3 Work management

- **Mentor assignment** — a student has a team, not one mentor: lead mentor,
  IELTS teacher, career counsellor, country mentor. Assignments are foreign keys
  to real accounts, carry a status (`active`, `awaiting_signature`, `required`,
  `replaced`), and every replacement is written to history with a reason.
- **Task SLA and urgency** — background loops escalate tasks by colour status and
  notify when deadlines approach or pass.
- **Meetings** and **check-ins**.
- **Session notes** — live transcription of a call streamed from the browser
  straight to the speech-to-text provider, with a chunked audio backup that is
  re-transcribed server-side if the live stream drops.
- **Responsibilities matrix** — who owns what for a given student.

### 3.4 Communication

- **Telegram** — group chats are bound to students; incoming messages, voice notes
  and files land in an inbox, attachments are transcribed, and an LLM extracts
  candidate insights for a human to confirm.
- **In-app chat** over WebSocket, with Redis fan-out so a message reaches the user
  regardless of which web process holds their socket.
- **Notifications** — per-user, pushed live and collected in one bell.

### 3.5 Documents and sensitive data

- Document storage in S3-compatible object storage, with a verification state.
- National ID numbers are encrypted at rest (`pgcrypto`).
- Confidential notes are a separate resource with its own access rule.
- Uploads are read with a hard size cap while streaming, so an oversized file
  cannot exhaust process memory before the size check.

### 3.6 Regulation and quality

This is the part that encodes the company's written rules:

- **Agreements** — regulations are published in the system and signed
  electronically; an unsigned mentor gets assignments in `awaiting_signature`.
- **Complaints** — a complaints book with response SLA and breach tracking.
- **Refund cases** and **security incidents** with their own workflows.
- **Monthly quality reviews** — individual reviews aggregate into a monthly score
  per manager.
- **Mentor rewards and penalties** — stage bonuses and a register of financial
  penalties derived from task colour statuses, with the mentor's right to object.

### 3.7 Intake and data sources

- **Google Forms** (manager package form, student case form) are polled and staged
  in `intake_submissions`. Rows without a plausible duplicate become student cards
  automatically, with no status, so the database shows the full picture of
  inbound demand; rows resembling an existing student wait for a human to link
  them, because automatic linking would create duplicates.
- **Notion** is mirrored row-by-row and fuzzy-matched to students, with manual
  linking for the rest.
- **Landing form** posts leads into the same intake pipeline.
- Contract amounts and personal arrangements are never imported automatically —
  they are human-entered fields by design.

### 3.8 Accounts and access provisioning

- **Self-registration** through a single `/join` link, verified by Google. A
  student whose phone exactly matches a free card gets their portal immediately;
  everyone else lands in an approval queue with a matching hint.
- **Approval queue** — bulk approval is allowed only where an objective check
  exists (exact phone match against a free card). Staff approvals are a separate,
  explicit action with named confirmation, because nothing about a staff request
  can be verified automatically.
- **Account recovery without email.** The system sends no email at all. Recovery
  is Google sign-in: a person links their Google account once and can always get
  back in. The fallback is a generated temporary password, shown once to an admin,
  which forces a change on first login and revokes existing sessions.

### 3.9 Administration

- **Permission registry UI** with per-user overrides.
- **Audit log** — logins, access grants, password resets, permission changes,
  Google links, invitations.
- **Status history** per entity, and Excel export.

---

## 4. Client surfaces

Three front-ends over one API, because the audiences need different things:

| Surface | Route | Audience |
|---|---|---|
| Classic CRM | `/students`, `/finances`, `/statistics`, … | Managers and admins — dense tables, filters, bulk actions. |
| Workspace | `/workspace/*` | Mentors — dark theme, one student card with tabs instead of many pages. |
| Portal | `/portal/*` | Students — roadmap, tasks, documents, meetings, university shortlist. |

Shared business logic lives in common components and API clients; the three
differ in layout and design tokens, not in duplicated logic.

---

## 5. Architecture in brief

```
browser / Telegram → Caddy → frontend (nginx)
                           → backend (FastAPI, async)   ← fast DB I/O only
                                     ↓ enqueue
                                   Redis  (queue · WS pub/sub · rate limit)
                                     ↓
                                   worker (arq)  ← all slow/external work
                                     ↓
                     PostgreSQL · MinIO · Notion/Telegram/STT/LLM
```

The rule that shapes everything: **the web tier never waits on an external API.**
It answers from the database or enqueues a job. Transcription, LLM calls, Telegram
file downloads and all periodic syncs live in a single `worker` process.

This is not incidental — it comes from an incident. Transcription and Telegram
handling once ran synchronously inside HTTP requests on one uvicorn process with a
small connection pool. A few concurrent heavy operations blocked the event loop and
the pool, and the **whole site** stopped responding, not just the heavy feature.

Full reasoning, including why background loops are forbidden in the web process
and how the WebSocket hub works across processes, is in
[ARCHITECTURE.md](ARCHITECTURE.md).

**Stack:** FastAPI (async) · SQLAlchemy 2.0 (async) · asyncpg · PostgreSQL 15 ·
Redis + `arq` · MinIO · React 18 + TypeScript · Vite · TanStack Query · Tailwind ·
Radix UI · Alembic.

---

## 6. Engineering notes

**Authentication.** Short-lived JWT access token plus an opaque refresh token,
stored hashed and rotated on every refresh, in an httpOnly cookie. A 20-second
grace window resolves the two-tabs race that otherwise logs a valid session out.
Passwords are bcrypt. In production the backend refuses to start on default
secrets — a crashed deploy is safer than a silently insecure one.

**Observability.** Four independent layers: errors to Sentry (PII off), metrics to
Prometheus/Grafana (host, containers, app, database, Redis), logs to Loki, and
alerts on service health, resource pressure, 5xx rate and backup staleness.

**Backups.** Nightly `pg_dump` with integrity verification, retention and an
off-site copy to object storage. The deploy takes a dump *before* running
migrations, since migrations are not reversible without one.

**CI/CD.** Push to `main` runs tests, applies the schema and every migration to a
clean database, and asserts a single Alembic head. Only a green run deploys.
`main` is production; the pipeline is the only barrier in front of users.

**Testing.** ~60 backend test files, deliberately hermetic — no database fixtures.
Tests target decisions rather than plumbing: permission-registry conformance,
duplicate prevention on intake, partial-success semantics of bulk operations,
token verification rules. Front-end unit tests cover filter logic and state that
survives navigation.

---

## 7. Scale

| | |
|---|---|
| Database tables | 80 |
| API routes | 385 across 53 modules |
| Alembic migrations | 88 |
| Front-end pages | 87 across 3 surfaces |
| Backend test files | 60 |

---

## 8. Repository layout

```
backend/         FastAPI app — api/v1/endpoints, models, services, core; worker.py
frontend/        React app — pages/{,workspace,portal}, components, api clients
migration/       One-off importers from Notion and Google Sheets
monitoring/      Grafana · Prometheus · Loki · exporters
scripts/         Backup, restore, smoke checks
docs/            Setup guide, plans, regulations
```
