from urllib import response
from supabase import Client
import pandas as pd

def upload_users_to_db(users_df: pd.DataFrame,
                          supabase_client: Client) -> dict:
    """Upload users to the database."""
    records = (
        users_df.astype(object)
        .where(users_df.notna(), None)
        .to_dict(orient="records")
    )
    response = (
        supabase_client
        .table("users")
        .upsert(
            records,
            on_conflict="email"
        )
        .execute()
    )

    return response