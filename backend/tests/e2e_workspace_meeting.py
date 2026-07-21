"""Real local integration smoke for meeting → audio recovery → note → task.

Run inside the backend container:
    python -m tests.e2e_workspace_meeting /tmp/tte-meeting-smoke.webm

The script uses configured local services, validates shared workspace reads and
removes every record and MinIO object it creates.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import settings


BASE = "http://127.0.0.1:8000/api/v1"
AUDIO_PATH = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tte-meeting-smoke.webm"


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS {label}")


def main() -> None:
    marker = f"workspace-e2e-{uuid.uuid4().hex[:8]}"
    meeting_id = session_id = note_id = task_id = None
    with httpx.Client(base_url=BASE, timeout=90, follow_redirects=True) as client:
        login = client.post(
            "/auth/login",
            json={"email": settings.FIRST_ADMIN_EMAIL, "password": settings.FIRST_ADMIN_PASSWORD},
        )
        require(login.status_code == 200, "admin login")
        token = login.json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"

        try:
            students = client.get("/workspace/students", params={"scope": "all"})
            require(students.status_code == 200 and students.json()["items"], "workspace student available")
            student_id = students.json()["items"][0]["student"]["id"]

            starts_at = datetime.now(timezone.utc) + timedelta(minutes=10)
            meeting = client.post(
                "/meetings",
                json={
                    "student_id": student_id,
                    "title": marker,
                    "meeting_type": "regular",
                    "description": "Integration smoke meeting",
                    "starts_at": starts_at.isoformat(),
                    "ends_at": (starts_at + timedelta(minutes=30)).isoformat(),
                },
            )
            require(meeting.status_code == 201, "meeting created")
            meeting_id = meeting.json()["id"]

            session = client.post(
                "/note-sessions",
                json={
                    "student_id": student_id,
                    "meeting_id": meeting_id,
                    "title": marker,
                    "source": "workspace_e2e",
                },
            )
            require(session.status_code == 201, "note session created")
            session_id = session.json()["id"]

            with open(AUDIO_PATH, "rb") as audio:
                chunk = client.post(
                    f"/note-sessions/{session_id}/audio-chunks",
                    data={"chunk_index": "0"},
                    files={"file": ("meeting.webm", audio, "audio/webm")},
                )
            require(chunk.status_code == 201, "real WebM uploaded to MinIO")
            chunk_id = chunk.json()["id"]

            with open(AUDIO_PATH, "rb") as audio:
                duplicate = client.post(
                    f"/note-sessions/{session_id}/audio-chunks",
                    data={"chunk_index": "0"},
                    files={"file": ("meeting.webm", audio, "audio/webm")},
                )
            require(duplicate.status_code == 201 and duplicate.json()["id"] == chunk_id, "audio upload idempotent")

            recovered = client.post(f"/note-sessions/{session_id}/reconcile-audio")
            recovered_body = recovered.json() if recovered.status_code == 200 else {}
            require(recovered.status_code == 200, "Deepgram recovery completed")
            require(bool(recovered_body.get("backup_transcript_text", "").strip()), "recovered transcript is not empty")
            require(recovered_body["chunks"][0]["status"] == "transcribed", "audio chunk marked transcribed")

            transcript = client.post(
                f"/note-sessions/{session_id}/transcripts",
                json={
                    "text": "Prepare the documents and create a task for next week.",
                    "speaker": "Mentor",
                    "client_segment_id": marker,
                },
            )
            require(transcript.status_code == 201, "live transcript stored")

            ended = client.patch(f"/note-sessions/{session_id}/end")
            require(ended.status_code == 200, "session ended")
            finalized = client.post(f"/note-sessions/{session_id}/finalize")
            require(finalized.status_code == 200, "AI note finalized")
            note_id = finalized.json()["note"]["id"]
            require("Восстановленная аудиозапись" in finalized.json()["note"]["source_text"], "recovery included in note context")

            task = client.post(
                "/tasks",
                json={"student_id": student_id, "task_text": f"{marker}: prepare documents"},
            )
            require(task.status_code == 200, "follow-up task created")
            task_id = task.json()["id"]

            workspace_notes = client.get("/workspace/notes", params={"scope": "all"})
            require(any(row["id"] == note_id for row in workspace_notes.json()["notes"]), "note visible in shared workspace")
            workspace_meetings = client.get("/workspace/meetings", params={"scope": "all"})
            require(any(row["id"] == meeting_id and row["note_session_id"] == session_id for row in workspace_meetings.json()["items"]), "meeting and note linked in workspace")
            tasks = client.get("/tasks", params={"scope": "all", "size": 200})
            require(any(row["id"] == task_id for row in tasks.json()["items"]), "task visible in shared workspace data")
        finally:
            if task_id:
                client.delete(f"/tasks/{task_id}")
            if session_id:
                client.delete(f"/note-sessions/{session_id}")
            if note_id:
                client.delete(f"/notes/{note_id}")
            if meeting_id:
                client.delete(f"/meetings/{meeting_id}")
            client.post("/auth/logout")


if __name__ == "__main__":
    main()
