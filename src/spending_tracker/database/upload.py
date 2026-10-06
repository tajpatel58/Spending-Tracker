from urllib import response
from supabase import Client
import pandas as pd
from datetime import date
from spending_tracker.database import supabase_client

def parse_dataframe_to_records(dataframe: pd.DataFrame) -> list[dict]:
    """Parse a DataFrame into a list of records suitable for database upload."""

    records = dataframe.astype(object).where(dataframe.notna(), None).to_dict(orient="records")
    # JSON can't encode date/datetime objects, so send them as ISO strings
    return [
        {k: v.isoformat() if isinstance(v, date) else v for k, v in record.items()}
        for record in records
    ]

def dataframe_to_db(dataframe: pd.DataFrame,
                           table_name: str,
                           on_conflict: str,) -> dict:
    """Upload a DataFrame to the database."""
    records = parse_dataframe_to_records(dataframe)
    supabase_api = supabase_client.load_supabase_client()
    response = (
        supabase_api
        .table(table_name)
        .upsert(
            records,
            on_conflict=on_conflict
        )
        .execute()
    )

    return response