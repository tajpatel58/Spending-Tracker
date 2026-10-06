from spending_tracker.data_ingestion import cal
import pandas as pd
from pathlib import Path
from datetime import datetime
from spending_tracker.database import upload

data_home = Path(__file__).parents[2] / "data"

# fetch todays date as "Month-YY" format
today_month = datetime.now().strftime("%B-%y")
calendar_save_path = data_home / "calendar" / f"{today_month}" / "events.csv"

# fetch google calendar events for the month
events = cal.fetch_events(today_month)
# extract budget and category using LLM
events_df = cal.extract_events_df(events)

calendar_save_path.parent.mkdir(parents=True, exist_ok=True)
events_df.to_csv(calendar_save_path, index=False)

# upload to database
upload.dataframe_to_db(
    dataframe=events_df,
    table_name="calendar_events",
    on_conflict="event_id",
)
