from calendar import month
from pathlib import Path
import pandas as pd


def filter_csv_paths(csv_paths: list[Path],
                      specific_user: str = None,
                      specific_bank: str = None,
                      specific_account_id: str = None,
                      specific_month: str = None) -> list[Path]:
    """Filter CSV paths based on user, bank, account_id, and month, if None, then don't filter on that parameter."""
    filtered_csv_paths = [
        csv_path for csv_path in csv_paths
        if (specific_user is None or specific_user in csv_path.parts) and
            (specific_bank is None or specific_bank in csv_path.parts) and
            (specific_account_id is None or specific_account_id in csv_path.parts) and
            (specific_month is None or specific_month in csv_path.parts)
    ]
    return filtered_csv_paths


def load_csv_in_batch(
    data_path_root: Path,
    specific_user: str = None,
    specific_bank: str = None,
    specific_account_id: str = None,
    specific_month: str = None,
    dtype_kwargs: dict[str, type] = None,
) -> dict[str, pd.DataFrame]:
    """Load every processed transaction CSV under processed_root.
    Kwargs can be used for datatype passing. 

    The returned dictionary is keyed by each CSV path relative to processed_root.
    """
    csv_files = sorted(data_path_root.rglob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found under {data_path_root}")

    print(csv_files)

    # filter paths based on user, bank, account_id, and month
    filtered_csv_paths = filter_csv_paths(csv_files, specific_user, specific_bank, specific_account_id, specific_month)

    print(filtered_csv_paths)

    # ensure account_id column is read as string to preserve leading zeros
    list_of_dataframes = [pd.read_csv(csv_path, dtype=dtype_kwargs) for csv_path in filtered_csv_paths]

    complete_transactions_df = pd.concat(list_of_dataframes, ignore_index=True)
    return complete_transactions_df