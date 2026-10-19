import hashlib
import pandas as pd
from pathlib import Path

def generate_event_id(*inputs):
    raw = "|".join(str(value) for value in inputs)

    return hashlib.sha256(raw.encode()).hexdigest()


def save_dataframe_to_csv(
    df: pd.DataFrame,
    csv_path: Path,
    upsert_cols: list[str] = None,
):
    """
    Save a DataFrame to a CSV file.

    If upsert is False, the file is overwritten. If upsert is True and the file
    exists, rows are merged with the existing data: rows in df replace existing
    rows with the same key_columns values (all columns if key_columns is None).
    """
    csv_path.parent.mkdir(parents=True, exist_ok=True)

    if upsert_cols and csv_path.exists():
        existing_df = pd.read_csv(csv_path)
        combined_df = pd.concat([existing_df, df], ignore_index=True)
        df = combined_df.drop_duplicates(subset=upsert_cols, keep="last")

    df.to_csv(csv_path, index=False)
    return csv_path


def save_partitioned_dataframe_to_csv(
    data: pd.DataFrame,
    output_root: Path,
    partition_columns: list[str],
    export_columns: list[str] = None,
    upsert_cols: list[str] = None,
    filename: str = "statement.csv",
) -> list[Path]:
    """Save one CSV per unique combination of partition column values.

    For example, partition_columns=["user", "bank", "account_id", "month"]
    creates paths like output_root/user/bank/account_id/month/filename.
    Returns the paths written, in sorted order.
    """
    if not partition_columns:
        raise ValueError("partition_columns must contain at least one column")

    missing_columns = [column for column in partition_columns if column not in data.columns]
    if missing_columns:
        raise KeyError(f"Partition columns not found in dataframe: {missing_columns}")

    output_paths = []
    for partition_values, partition_df in data.groupby(partition_columns, dropna=False):
        if not isinstance(partition_values, tuple):
            partition_values = (partition_values,)

        partition_path = output_root.joinpath(
            *(str(value) for value in partition_values),
            filename,
        )

        if export_columns is None:
            export_columns = partition_df.columns

        partition_df = partition_df[export_columns]

        save_dataframe_to_csv(partition_df, partition_path, upsert_cols)
        output_paths.append(partition_path)

    return sorted(output_paths)