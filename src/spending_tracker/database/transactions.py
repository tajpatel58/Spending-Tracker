from urllib import response
from supabase import Client
import pandas as pd

def upload_transactions_to_db(
    transactions_df: pd.DataFrame,
    supabase_client: Client,
    table_name: str,
    exclude_columns: list[str] | None = None,
) -> dict:
    """Upsert transactions, optionally leaving selected columns untouched.

    Columns listed in ``exclude_columns`` are omitted from the upsert payload.
    On a conflict, Supabase therefore does not update those columns. The
    ``event_id`` column must remain present because it is the conflict key.
    """
    exclude_columns = set(exclude_columns or [])
    missing_columns = exclude_columns - set(transactions_df.columns)
    if missing_columns:
        raise KeyError(f"Columns to exclude not found in dataframe: {sorted(missing_columns)}")

    if "event_id" in exclude_columns:
        raise ValueError("event_id cannot be excluded because it is the upsert conflict key")

    upsert_df = transactions_df.drop(columns=exclude_columns)
    records = (
        upsert_df.astype(object)
        .where(upsert_df.notna(), None)
        .to_dict(orient="records")
    )
    response = (
        supabase_client
        .table(f"{table_name}")
        .upsert(
            records,
            on_conflict="event_id"
        )
        .execute()
    )

    return response


def fetch_transactions_from_db(
    supabase_client: Client,
    table_name: str,
) -> pd.DataFrame:
    """Fetch all transactions from the database."""
    response = (
        supabase_client
        .table(f"{table_name}")
        .select("*")
        .execute()
    )
    if response.status_code != 200:
        raise RuntimeError(f"Failed to fetch transactions: {response.data}")

    transactions_df = pd.DataFrame(response.data)
    return transactions_df


def fetch_manually_categorised_transactions_as_dict(
    supabase_client: Client,
) -> dict:
    """Load transactions that have been manually categorised."""
    metadata_response = (
        supabase_client
        .table("transactions_metadata")
        .select("*")
        .is_("hidden", "null")
        .execute()
    )

    transactions_response = (
        supabase_client
        .table("transactions")
        .select("*")
        .execute()
    )

    # convert to dataframes and merge on event_id:
    metadata_df = pd.DataFrame(metadata_response.data)
    transactions_df = pd.DataFrame(transactions_response.data)
    transactions_with_metadata_df = pd.merge(transactions_df, metadata_df, on="event_id", how="inner")
    transactions_with_metadata_df["category"] = transactions_with_metadata_df["manual_category"].fillna(transactions_with_metadata_df["llm_category"])

    labelled_examples = [
        {
            "merchant": row["merchant"],
            "amount": row["amount"],
            "category": row["category"]
        }
        for _, row in transactions_with_metadata_df.iterrows()
    ]

    return labelled_examples