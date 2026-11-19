import pandas as pd
from loguru import logger

from spending_tracker.database import supabase_client

_PAGE_SIZE = 1000  # Supabase returns at most 1,000 rows per request by default


def _select_all(query) -> list[dict]:
    """Run a select query page by page, so tables over the row limit aren't silently cut off."""
    query = query.order("event_id")  # stable order, so pages don't overlap or skip rows
    rows, offset = [], 0
    while True:
        page = query.range(offset, offset + _PAGE_SIZE - 1).execute().data
        rows += page
        if len(page) < _PAGE_SIZE:
            return rows
        offset += _PAGE_SIZE


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
    metadata_rows = _select_all(
        client.table("transactions_metadata").select(
            "event_id, manual_merchant, manual_category, llm_merchant, llm_category"
        )
    )

    transactions_query = client.table("transactions").select(
        "event_id, merchant, amount"
    )
    if from_date is not None:
        transactions_query = transactions_query.gte("date", from_date)

    if end_date is not None:
        transactions_query = transactions_query.lte("date", end_date)

    transactions_rows = _select_all(transactions_query)

    # convert to dataframes and merge on event_id:
    metadata_df = pd.DataFrame(metadata_rows)
    transactions_df = pd.DataFrame(transactions_rows)
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
