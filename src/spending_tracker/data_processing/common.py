import hashlib
import pandas as pd
from pathlib import Path

_TRANSACTIONS_DB_COLUMNS = ["event_id", "date", "month","merchant", 
                            "type", "category", "amount", 
                            "other_details", "account_id", "user", 
                            "raw_merchant", "raw_amount", "bank", 
                            "hidden"]

def generate_event_id(*inputs):
    raw = "|".join(str(value) for value in inputs)

    return hashlib.sha256(raw.encode()).hexdigest()


def save_dataframe_to_csv(df: pd.DataFrame, csv_path: Path):
    """
    Save a DataFrame to a CSV file.
    """
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(csv_path, index=False)
    return csv_path


def save_partitioned_dataframe_to_csv(
    transactions_df: pd.DataFrame,
    output_root: Path,
    partition_columns: list[str],
    filename: str = "statement.csv",
) -> list[Path]:
    """Save one CSV per unique combination of partition column values.

    For example, partition_columns=["user", "bank", "account_id", "month"]
    creates paths like output_root/user/bank/account_id/month/filename.
    Returns the paths written, in sorted order.
    """
    if not partition_columns:
        raise ValueError("partition_columns must contain at least one column")

    missing_columns = [column for column in partition_columns if column not in transactions_df.columns]
    if missing_columns:
        raise KeyError(f"Partition columns not found in dataframe: {missing_columns}")

    output_paths = []
    for partition_values, partition_df in transactions_df.groupby(partition_columns, dropna=False):
        if not isinstance(partition_values, tuple):
            partition_values = (partition_values,)

        partition_path = output_root.joinpath(
            *(str(value) for value in partition_values),
            filename,
        )
        save_dataframe_to_csv(partition_df, partition_path)
        output_paths.append(partition_path)

    return sorted(output_paths)