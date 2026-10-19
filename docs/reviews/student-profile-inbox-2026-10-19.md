# Student profiles and intake inbox — 2026-10-19

The workspace student profile now uses the same horizontal navigation and section panels as the CRM card. Universities, applications, admission credentials, profile, team, payments and reconciliation no longer render as one long accordion. Visited panels retain drafts. Legacy workspace notes anchors still open confidential notes; meeting notes have a separate anchor. Both profiles expose Documents directly in the top row and retain the existing upload flows and permissions.

Google Sheets and Notion inboxes have independent close controls that preserve other URL filters. Loading failures offer retry instead of claiming all records were processed. Student pickers show loading/retry states, link errors stay visible in the dialog, and successful links invalidate the student/card caches. Open inboxes refresh every minute.

Read-only production diagnosis: both Sheets sources were successfully read (242 package rows, 223 case rows), with two staged submissions awaiting review. Intake auto-create and auto-link remain disabled. Three pending Notion suggestions were ineligible for bulk linking: two students already had linked pages, one suggestion was 95% confidence. Bulk HTTP responses were successful; a Sheets create attempt returned a duplicate-protection 409. No failed-link workaround should overwrite an existing link or create duplicates.

The Notion inbox now receives eligibility and explanations from the same backend policy as bulk linking. Bulk results count skipped records and include reasons. Exact, unique matches to active students without an existing page remain eligible; other cases require manual review. No production records were linked as part of diagnosis.

Validation: backend suite 1056 passed, one skipped; frontend suite 529 passed before the final legacy-anchor regression test, then all 14 affected navigation/workspace/inbox tests passed. Frontend lint and production build passed after final changes. No migration, credentials, environment flags or deployment workflow changes.
