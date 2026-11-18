from supabase import Client
import pandas as pd
from spending_tracker.database import supabase_client


def load_accounts_from_supabase() -> pd.DataFrame:
    """Fetch the accounts table from Supabase as a DataFrame."""
    client = supabase_client.load_supabase_client()
    response = (
        client
        .table("accounts")
        .select("*")
        .execute()
    )
    return pd.DataFrame(response.data)
