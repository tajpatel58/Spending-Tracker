import pandas as pd
from pathlib import Path
import re
from spending_tracker.data_processing import common

_AMEX_CARD_MEMBER_TO_USER_MAPPING = {
    "T PATEL": "Taj",
    "R PATEL": "Radhika"
}

def load_raw_amex_statement_csv(csv_path: Path) -> pd.DataFrame:
    """
    Load a raw Amex statement CSV and return a DataFrame.
    """
    # Define the expected columns for Amex statements
    expected_columns = ["Date", "Description", "Card Member", "Account #", "Amount"]

    # load in csv
    raw_amex_df = pd.read_csv(csv_path, 
                              usecols=expected_columns,
                              dtype=str)

    return raw_amex_df

def parse_transaction_details(details: str) -> dict[str, str]:
    """
    Cleans the transaction details string and returns a dictionary
    of transaction details. 

    For Amex, the spacing is not consistent and the last string is typically location. 

    Example Input/Output:
    Input:
        "Bond Dental London"

    Output:
        {
            "merchant": "Bond Dental",
            "other_details": "London"
        }
    """

    if not isinstance(details, str):
        raise TypeError("Transaction details must be a string")

    if not details.strip():
        raise ValueError("Transaction details cannot be empty")

    # standardise whitespace between text
    details = re.sub(r"\s+", " ", details).strip()

    # split on the last white space
    parts = details.rsplit(maxsplit=1)
    merchant = parts[0]
    other_details = parts[1] if len(parts) > 1 else ""

    return {
        "merchant": merchant,
        "other_details": other_details
    }


def clean_amex_transaction_dataframe(amex_df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    amex_df = amex_df.rename(columns={
        "Date": "date",
        "Description": "transaction_details",
        "Card Member": "card_member",
        "Account #": "account_id",
        "Amount": "amount"
    })

    # add occurence column to handle duplicate transactions
    amex_df["occurrence"] = amex_df.groupby(["date", "transaction_details", "amount", "card_member", "account_id"]).cumcount().add(1)

    # add columns for account_id and user
    amex_df["account_id"] = amex_df["account_id"].str.replace(r"\D", "", regex=True)
    amex_df["user"] = amex_df["card_member"].map(_AMEX_CARD_MEMBER_TO_USER_MAPPING)

    # Convert 'date' column to datetime and add month column for partitioning
    amex_df['date'] = pd.to_datetime(amex_df['date'], errors='coerce', format='%d/%m/%Y')
    amex_df['month'] = amex_df['date'].dt.strftime('%B-%y')

    # Convert 'amount' and 'balance' columns to numeric, removing any non-numeric characters
    amex_df['amount'] = -1 * pd.to_numeric(amex_df['amount'].str.replace(r'[^\d.-]', '', regex=True), errors='coerce')

    # Clean the 'transaction_details' column
    amex_df[["merchant", "other_details"]] = (
        amex_df["transaction_details"]
        .apply(parse_transaction_details)
        .apply(pd.Series)
    )

    # create dupe columns as might be changed by end user. 
    amex_df["raw_merchant"] = amex_df["merchant"]
    amex_df["raw_amount"] = amex_df["amount"]
    amex_df["bank"] = "Amex"
    amex_df["category"] = None 
    amex_df["hidden"] = False
    amex_df["type"] = None

    # add event_id column with unique UUIDs for each row
    amex_df["event_id"] = amex_df.apply(
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

    amex_df = amex_df[common._TRANSACTIONS_DB_COLUMNS]
    return amex_df