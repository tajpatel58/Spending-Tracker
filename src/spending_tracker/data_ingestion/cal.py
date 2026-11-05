import re
from datetime import date, datetime, timezone
from pathlib import Path
import pandas as pd
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from spending_tracker.classification.ollama import llm_extract_calendar_event

# Read-only access is all a calendar sync needs
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
DATA_DIR = Path(__file__).parents[3]
CREDENTIALS_FILE = DATA_DIR / "data" / "json" / "google_calendar_secret.json"
TOKEN_FILE = DATA_DIR / "data" / "json" / "token.json"
HOLIDAY_TAG = re.compile(r"(?<!bank )\bholiday\b", re.IGNORECASE)


def get_credentials() -> Credentials:
    """Load saved credentials, refreshing or re-authenticating as needed."""
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request()) 
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)   
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(creds.to_json())

    return creds


def sync_window(today: date | None = None) -> tuple[datetime, datetime]:
    """UTC [start, end) bounds to sync: the 1st of last month to 12 months after the 1st of this month."""
    today = today or date.today()
    this_month = today.year * 12 + today.month - 1
    first_of = lambda month: datetime(month // 12, month % 12 + 1, 1, tzinfo=timezone.utc)
    return first_of(this_month - 1), first_of(this_month + 12)


def fetch_events(time_min: datetime, time_max: datetime, calendar_id: str = "primary") -> list[dict]:
    """Return all events overlapping the given [time_min, time_max) window."""
    service = build("calendar", "v3", credentials=get_credentials())

    events, page_token = [], None

    while True:
        response = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min.isoformat(),
            timeMax=time_max.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            pageToken=page_token,
        ).execute()

        for e in response.get("items", []):
            events.append({
                "event_id": e["id"],
                "title": e.get("summary", "(no title)"),
                "event_date": (e["start"].get("dateTime") or e["start"]["date"])[:10],
                "start_time": e["start"].get("dateTime", "")[11:16] or None,
                "description": e.get("description"),
                "google_updated_ts": e.get("updated"),
            })

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return events


def can_reuse(event: dict, stored: dict | None) -> bool:
    """True when a stored event's extraction still holds: it's unchanged, and has its sub-category if it needs one."""
    if not stored or not stored.get("google_updated_ts") or not event["google_updated_ts"]:
        return False
    # Parsed, as the database may format the timestamp differently from Google
    unchanged = (datetime.fromisoformat(stored["google_updated_ts"])
                 == datetime.fromisoformat(event["google_updated_ts"]))
    return unchanged and (stored["category"] != "holiday" or bool(stored["sub_category"]))


def extract_events_df(events: list[dict], stored_events: dict[str, dict]) -> tuple[pd.DataFrame, dict]:
    """Return the events as a DataFrame, one row per event, with budget/category/sub-category from the
    LLM (or from stored_events, by event_id, when unchanged), and counts of what happened to each.

    An event the LLM fails on is left out, so its stored row stays as it was until the next run.
    """
    extracted_events = []
    counts = {"extracted": 0, "reused": 0, "failed": 0}

    for event in events:
        stored = stored_events.get(event["event_id"])
        if can_reuse(event, stored):
            extraction = stored
            counts["reused"] += 1
        else:
            try:
                extraction = llm_extract_calendar_event(event)
            except ValueError as exc:
                print(f"Skipping {event['title']!r} ({event['event_date']}): {exc}")
                counts["failed"] += 1
                continue
            counts["extracted"] += 1

        category = "holiday" if HOLIDAY_TAG.search(event["description"] or "") else extraction["category"]
        extracted_events.append({
            **event,
            "budget": extraction["budget"],
            "category": category,
            "sub_category": extraction["sub_category"] if category == "holiday" else None,
        })

    parsed_events_df = pd.DataFrame(
        extracted_events,
        columns=["event_id", "title", "event_date", "start_time", "description",
                 "google_updated_ts", "budget", "category", "sub_category"],
    )
    parsed_events_df["event_date"] = pd.to_datetime(parsed_events_df["event_date"]).dt.date

    return parsed_events_df, counts

