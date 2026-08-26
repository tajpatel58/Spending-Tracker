import pandas as pd
from pathlib import Path
import re
from spending_tracker.data_ingestion import pdf_parsing
from spending_tracker.data_processing import common
from spending_tracker.data_processing import table_schema

def load_raw_chase_statement_pdf(pdf_path: Path) -> pd.DataFrame:
    """
    Load a raw Chase statement PDF and return a DataFrame.
    """
    # Define the expected columns for Chase statements
    expected_columns = ["date", "transaction_details", "amount", "balance"]

    # Use the pdf_to_dataframe function to extract data from the PDF
    raw_chase_df = pdf_parsing.pdf_to_dataframe(pdf_path, columns=expected_columns)

    return raw_chase_df


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


def clean_chase_transaction_dataframe(chase_df: pd.DataFrame, **kwargs) -> pd.DataFrame:

    # add columns for account_id and user
    chase_df["account_id"] = kwargs["account_id"]
    chase_df["user"] = kwargs["user"]

    # add occurence column to handle duplicate transactions
    chase_df["occurrence"] = chase_df.groupby(["date", "transaction_details", "amount", "account_id"]).cumcount().add(1)

    # Convert 'date' column to datetime and add month column for partitioning
    chase_df['date'] = pd.to_datetime(chase_df['date'], errors='coerce')
    chase_df['month'] = chase_df['date'].dt.strftime('%B-%y')

    # Convert 'amount' and 'balance' columns to numeric, removing any non-numeric characters
    chase_df['amount'] = pd.to_numeric(chase_df['amount'].str.replace(r'[^\d.-]', '', regex=True), errors='coerce')

    # Clean the 'transaction_details' column
    chase_df[["merchant", "type", "other_details"]] = (
        chase_df["transaction_details"]
        .apply(parse_transaction_details)
        .apply(pd.Series)
    )

    # remove round ups
    chase_df = chase_df[~chase_df["merchant"].str.contains("Round up")]

    # create dupe columns as might be changed by end user. 
    chase_df["bank"] = "Chase"

    # add event_id column with unique UUIDs for each row
    chase_df["event_id"] = chase_df.apply(
        lambda row: common.generate_event_id(
            row["account_id"],
            row["date"].strftime("%Y-%m-%d"),
            row["amount"],
            row["transaction_details"],
            row["balance"],
            row["occurrence"]
        ),
        axis=1
    )

    chase_df = chase_df[table_schema._TRANSACTIONS_DB_COLUMNS]
    return chase_df