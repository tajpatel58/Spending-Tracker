import pandas as pd
from pathlib import Path
import re
import uuid


def parse_transaction_details(details: str) -> dict[str, str]:
    """
    Cleans the transaction details string and returns a dictionary
    of transaction details.

    Example Input/Output:
    Input:
        "Duty Free \n Purchase | SGD 97.20 | FX rate £1 = SGD 1.7182"

    Output:
        {
            "merchant": "Duty Free",
            "type": "Purchase",
            "other_details": "SGD 97.20 | FX rate £1 = SGD 1.7182"
        }
    """

    if not isinstance(details, str):
        raise TypeError("Transaction details must be a string")

    if not details.strip():
        raise ValueError("Transaction details cannot be empty")

    # Split on the first line break.
    lines = re.split(r"\r?\n", details, maxsplit=1)

    merchant = re.sub(r"\s+", " ", lines[0]).strip()

    # Everything after the line break starts with the transaction type.
    remainder = lines[1].strip()

    # Split type from the optional additional details.
    parts = re.split(r"\s*\|\s*", remainder, maxsplit=1)

    transaction_type = re.sub(r"\s+", " ", parts[0]).strip()

    other_details = parts[1].strip() if len(parts) > 1 else ""

    if not merchant:
        raise ValueError(f"Could not extract merchant from: {details!r}")

    if not transaction_type:
        raise ValueError(f"Could not extract transaction type from: {details!r}")

    return {
        "merchant": merchant,
        "type": transaction_type,
        "other_details": other_details,
    }


def clean_transaction_dataframe(chase_df: pd.DataFrame, 
                          account_id: str,
                          user: str,
                          csv_path: Path = None) -> pd.DataFrame:

    # add columns for account_id and user
    chase_df["account_id"] = account_id
    chase_df["user"] = user

    # Convert 'date' column to datetime
    chase_df['date'] = pd.to_datetime(chase_df['date'], errors='coerce')

    # Convert 'amount' and 'balance' columns to numeric, removing any non-numeric characters
    chase_df['amount'] = -1 * pd.to_numeric(chase_df['amount'].str.replace(r'[^\d.-]', '', regex=True), errors='coerce')

    # Clean the 'transaction_details' column
    chase_df[["merchant", "type", "other_details"]] = (
        chase_df["transaction_details"]
        .apply(parse_transaction_details)
        .apply(pd.Series)
    )

    # create dupe columns as might be changed by end user. 
    chase_df["raw_merchant"] = chase_df["merchant"]
    chase_df["raw_amount"] = chase_df["amount"]
    chase_df["bank"] = "Chase Bank"
    chase_df["category"] = None 

    # add event_id column with unique UUIDs for each row
    chase_df["event_id"] = chase_df.apply(lambda _: str(uuid.uuid4()), axis=1)

    export_cols = ["event_id", "date", "merchant", "type", "category", "amount", "other_details", "account_id", "user", "raw_merchant", "raw_amount", "bank"]

    chase_df = chase_df[export_cols]
    return chase_df