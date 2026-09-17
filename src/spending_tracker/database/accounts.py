from urllib import response
from supabase import Client
import pandas as pd

def upload_accounts_to_db(accounts_df: pd.DataFrame,
                          supabase_client: Client) -> dict:
    """Upload accounts to the database."""
    records = (
        accounts_df.astype(object)
        .where(accounts_df.notna(), None)
        .to_dict(orient="records")
    )
    response = (
        supabase_client
        .table("accounts")
        .upsert(
            records,
            on_conflict="account_id"
        )
        .execute()
    )

    return response