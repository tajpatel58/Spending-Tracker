import pandas as pd
from loguru import logger

from spending_tracker.database import supabase_client


def load_accounts_from_supabase() -> pd.DataFrame:
    """Fetch the accounts table from Supabase as a DataFrame."""
    client = supabase_client.load_supabase_client()
    response = client.table("accounts").select("*").execute()
    logger.debug(f"Loaded {len(response.data)} accounts from Supabase")
    return pd.DataFrame(response.data)


def load_labelled_transactions_as_dict(
    from_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Load transactions that have been manually categorised.

    If ``from_date`` (e.g. "2026-10-01") is given, only transactions on or
    after that date are returned; otherwise all transactions are returned.
    """

    client = supabase_client.load_supabase_client()
    metadata_response = client.table("transactions_metadata").select("*").execute()

    transactions_query = client.table("transactions").select("*")
    if from_date is not None:
        transactions_query = transactions_query.gte("date", from_date)

    if end_date is not None:
        transactions_query = transactions_query.lte("date", end_date)

    transactions_response = transactions_query.execute()

    # convert to dataframes and merge on event_id:
    metadata_df = pd.DataFrame(metadata_response.data)
    transactions_df = pd.DataFrame(transactions_response.data)
    transactions_with_metadata_df = pd.merge(
        transactions_df, metadata_df, on="event_id", how="inner"
    )
    transactions_with_metadata_df["category"] = transactions_with_metadata_df[
        "manual_category"
    ].fillna(transactions_with_metadata_df["llm_category"])
    transactions_with_metadata_df["cleaned_merchant"] = transactions_with_metadata_df[
        "manual_merchant"
    ].fillna(transactions_with_metadata_df["llm_merchant"])

    labelled_examples = [
        {
            "merchant": row["merchant"],
            "cleaned_merchant": row["cleaned_merchant"],
            "amount": row["amount"],
            "category": row["category"],
        }
        for _, row in transactions_with_metadata_df.iterrows()
    ]

    return labelled_examples
