from pathlib import Path
import pandas as pd


def load_csv_in_batch(
    data_path_root: Path,
    **kwargs,
) -> dict[str, pd.DataFrame]:
    """Load every processed transaction CSV under processed_root.
    Kwargs can be used for datatype passing. 

    The returned dictionary is keyed by each CSV path relative to processed_root.
    """
    csv_files = sorted(data_path_root.rglob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found under {data_path_root}")

    # ensure account_id column is read as string to preserve leading zeros
    list_of_dataframes = [pd.read_csv(csv_path, dtype=kwargs) for csv_path in csv_files]

    complete_transactions_df = pd.concat(list_of_dataframes, ignore_index=True)
    return complete_transactions_df