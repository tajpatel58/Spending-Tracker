from datetime import datetime
from spending_tracker.database import supabase_client

TABLE_NAME = "calendar_events"
PAGE_SIZE = 1000
DELETE_CHUNK_SIZE = 100


def fetch_stored_events(time_min: datetime, time_max: datetime) -> dict[str, dict]:
    """Return the stored events dated within the [time_min, time_max) window, by event_id."""
    supabase_api = supabase_client.load_supabase_client()
    rows, offset = [], 0
    while True:
        page = (
            supabase_api
            .table(TABLE_NAME)
            .select("event_id, google_updated_ts, budget, category, sub_category")
            .gte("event_date", time_min.date().isoformat())
            .lt("event_date", time_max.date().isoformat())
            .order("event_id")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        ).data
        rows += page
        if len(page) < PAGE_SIZE:
            return {row["event_id"]: row for row in rows}
        offset += PAGE_SIZE


def delete_events(event_ids: list[str]) -> None:
    """Delete the given events, a chunk at a time so the request URL stays short."""
    supabase_api = supabase_client.load_supabase_client()
    for i in range(0, len(event_ids), DELETE_CHUNK_SIZE):
        (
            supabase_api
            .table(TABLE_NAME)
            .delete()
            .in_("event_id", event_ids[i:i + DELETE_CHUNK_SIZE])
            .execute()
        )
