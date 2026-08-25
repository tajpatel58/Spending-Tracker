import pandas as pd
from pathlib import Path
import re
from spending_tracker.data_processing import common

def load_raw_nationwide_statement_csv(csv_path: Path) -> pd.DataFrame:
    """
    Load a raw nationwide statement CSV and return a DataFrame.
    """
    # Define the expected columns for nationwide statements
    expected_columns = ["Date", "Transaction type", "Description", "Paid out", "Paid in", "Balance"]

    # load in csv
    raw_nationwide_df = pd.read_csv(csv_path, 
                              dtype=str, 
                              skiprows=3,
                              usecols=expected_columns)

    return raw_nationwide_df

def parse_transaction_details(details: str) -> dict[str, str]:
    """
    Cleans the transaction details string and returns a dictionary
    of transaction details. 

    Apple Pay transactions may end with an ``APPLEPAY`` marker and four digits.
    Only that suffix is moved into ``other_details``; other descriptions remain
    unchanged.

    Example Input/Output:
    Input:
        "Bond Dental APPLEPAY 1234"

    Output:
        {
            "merchant": "Bond Dental",
            "other_details": "APPLEPAY 1234"
        }
    """

    if not isinstance(details, str):
        raise TypeError("Transaction details must be a string")

    if not details.strip():
        raise ValueError("Transaction details cannot be empty")

    # standardise whitespace between text
    details = re.sub(r"\s+", " ", details).strip()

    applepay_match = re.search(r"\s+(APPLEPAY\s+\d{4})$", details, flags=re.IGNORECASE)
    if applepay_match:
        merchant = details[:applepay_match.start()].rstrip()
        other_details = applepay_match.group(1)
    else:
        merchant = details
        other_details = ""

    return {
        "merchant": merchant,
        "other_details": other_details
    }


def clean_nationwide_transaction_dataframe(nationwide_df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    nationwide_df = nationwide_df.rename(columns={
        "Date": "date",
        "Transaction type": "type",
        "Description": "transaction_details",
        "Paid out": "paid_out",
        "Paid in": "paid_in",
        "Balance": "balance"
    })

    # add columns for account_id and user
    account_id = kwargs["account_id"]
    nationwide_df["account_id"] = account_id
    nationwide_df["user"] = "Joint"

    # Convert 'date' column to datetime and add month column for partitioning
    nationwide_df['date'] = pd.to_datetime(nationwide_df['date'], errors='coerce', format='%d %b %Y')
    nationwide_df['month'] = nationwide_df['date'].dt.strftime('%B-%y')

    # Convert 'amount' and 'balance' columns to numeric, removing any non-numeric characters
    nationwide_df["paid_in"] = pd.to_numeric(nationwide_df["paid_in"].str.replace(r'[^\d.-]', '', regex=True), errors='coerce')
    nationwide_df["paid_out"] = pd.to_numeric(nationwide_df["paid_out"].str.replace(r'[^\d.-]', '', regex=True), errors='coerce')
    nationwide_df['amount'] = nationwide_df["paid_in"].fillna(0).astype(float) - nationwide_df["paid_out"].fillna(0).astype(float)

    # Clean the 'transaction_details' column
    nationwide_df[["merchant", "other_details"]] = (
        nationwide_df["transaction_details"]
        .apply(parse_transaction_details)
        .apply(pd.Series)
    )

    # create dupe columns as might be changed by end user. 
    nationwide_df["raw_merchant"] = nationwide_df["merchant"]
    nationwide_df["raw_amount"] = nationwide_df["amount"]
    nationwide_df["bank"] = "Nationwide"
    nationwide_df["category"] = None 
    nationwide_df["hidden"] = False

        # add occurence column to handle duplicate transactions
    nationwide_df["occurrence"] = nationwide_df.groupby(["date", "transaction_details", "amount", "user", "account_id"]).cumcount().add(1)

    # add event_id column with unique UUIDs for each row
    nationwide_df["event_id"] = nationwide_df.apply(
        lambda row: common.generate_event_id(
            row["account_id"],
            row["date"].strftime("%Y-%m-%d"),
            row["amount"],
            row["transaction_details"],
            row["user"],
            row["occurrence"]
        ),
        axis=1
    )

    nationwide_df = nationwide_df[common._TRANSACTIONS_DB_COLUMNS]
    return nationwide_df