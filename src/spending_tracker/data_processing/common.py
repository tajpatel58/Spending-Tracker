import hashlib
import pandas as pd
from pathlib import Path

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