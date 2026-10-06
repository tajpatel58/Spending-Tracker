from datetime import datetime, timezone
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


def parse_month(month: str) -> tuple[datetime, datetime]:
    """Parse "Month-YY" (e.g. "October-26") into UTC [start, end) bounds."""
    try:
        start = datetime.strptime(month.strip(), "%B-%y").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ValueError(f'Invalid month {month!r}; expected "Month-YY", e.g. "October-26"')
    end = start.replace(year=start.year + (start.month == 12), month=start.month % 12 + 1)
    return start, end


def fetch_events(month: str, calendar_id: str = "primary") -> list[dict]:
    """Return all events in the given month, formatted as "Month-YY" (e.g. "October-26")."""
    time_min, time_max = parse_month(month)
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
                # Timed events have start.dateTime; all-day events have start.date
                "event_date": (e["start"].get("dateTime") or e["start"]["date"])[:10],
                "description": e.get("description"),
                "google_updated_ts": e.get("updated"),
            })

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return events


def extract_events_df(events: list[dict]) -> pd.DataFrame:
    """Return the month's events as a DataFrame, one row per event, and extract budget/category using LLM"""

    for event in events:
        extraction = llm_extract_calendar_event(event)
        event["budget"] = extraction["budget"]
        event["category"] = extraction["category"]


    parsed_events_df = pd.DataFrame(
        events,
        columns=["event_id", "title", "event_date", "description", "google_updated_ts", "budget", "category"],
    )
    parsed_events_df["event_date"] = pd.to_datetime(parsed_events_df["event_date"]).dt.date


    return parsed_events_df

