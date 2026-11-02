import uuid

from starlette.routing import Match

from app.main import app


def endpoint_for(method, path):
    scope = {"type": "http", "method": method, "path": path, "root_path": ""}
    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route.endpoint.__name__
    return None


def test_bulk_read_is_not_taken_for_a_notification_id():
    # Раньше «bulk» попадал в /{notification_id}/read чата и падал на проверке UUID.
    assert endpoint_for("POST", "/api/v1/notifications/bulk/read") == "bulk_mark_as_read"


def test_single_read_still_reaches_the_id_route():
    assert endpoint_for("POST", f"/api/v1/notifications/{uuid.uuid4()}/read") == "read_notification"


def test_notification_handlers_take_the_current_user_dependency():
    # `Depends(CurrentUser)` поверх готового Annotated превращался в query args/kwargs → 422.
    for route in app.router.routes:
        if getattr(route, "path", "").startswith("/api/v1/notifications") and hasattr(route, "dependant"):
            assert not {p.name for p in route.dependant.query_params} & {"args", "kwargs"}, route.path
