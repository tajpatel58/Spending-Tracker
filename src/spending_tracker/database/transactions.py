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