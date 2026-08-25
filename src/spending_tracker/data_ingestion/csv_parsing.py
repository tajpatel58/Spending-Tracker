from pathlib import Path
import pandas as pd


def load_processed_transactions(
    processed_transactions_root: Path,
) -> dict[str, pd.DataFrame]:
    """Load every processed transaction CSV under processed_root.

    The returned dictionary is keyed by each CSV path relative to processed_root.
    """
    csv_files = sorted(processed_transactions_root.rglob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found under {processed_transactions_root}")

    # ensure account_id column is read as string to preserve leading zeros
    list_of_dataframes = [pd.read_csv(csv_path, dtype={"account_id": str}) for csv_path in csv_files]

    complete_transactions_df = pd.concat(list_of_dataframes, ignore_index=True)
    return complete_transactions_df