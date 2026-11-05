from spending_tracker.data_ingestion import cal
import pandas as pd
from pathlib import Path
from datetime import datetime
from spending_tracker.database import calendar_events, upload

data_home = Path(__file__).parents[2] / "data"

# fetch todays date as "Month-YY" format
today_month = datetime.now().strftime("%B-%y")
calendar_save_path = data_home / "calendar" / f"{today_month}" / "events.csv"

# fetch google calendar events from last month to a year ahead, so future trips are covered
time_min, time_max = cal.sync_window()
events = cal.fetch_events(time_min, time_max)

# fetch what's already stored, so unchanged events can skip the LLM
stored_events = calendar_events.fetch_stored_events(time_min, time_max)
# extract budget, category and sub-category using LLM
events_df, counts = cal.extract_events_df(events, stored_events)

calendar_save_path.parent.mkdir(parents=True, exist_ok=True)
events_df.to_csv(calendar_save_path, index=False)

# upload to database
if not events_df.empty:
    upload.dataframe_to_db(
        dataframe=events_df,
        table_name="calendar_events",
        on_conflict="event_id",
    )

# remove events no longer in the calendar, unless the fetch came back empty
fetched_ids = {event["event_id"] for event in events}
removed_ids = sorted(stored_events.keys() - fetched_ids) if fetched_ids else []
calendar_events.delete_events(removed_ids)

print(
    f"{len(events)} events from {time_min.date()} to {time_max.date()}: "
    f"{counts['extracted']} extracted, {counts['reused']} reused, "
    f"{len(removed_ids)} deleted, {counts['failed']} failed"
)
