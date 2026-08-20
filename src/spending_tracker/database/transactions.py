from supabase import Client
import pandas as pd

def upload_transactions_to_db(transactions_df: pd.DataFrame, supabase_client: Client) -> dict:
    records = (
        transactions_df.astype(object)
        .where(transactions_df.notna(), None)
        .to_dict(orient="records")
    )
    response = (
        supabase_client
        .table("transactions")
        .upsert(
            records,
            on_conflict="event_id"
        )
        .execute()
    )

    return response