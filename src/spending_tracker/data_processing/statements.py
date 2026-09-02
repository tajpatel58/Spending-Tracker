from pathlib import Path
import pandas as pd
from spending_tracker.data_processing import chase
from spending_tracker.data_processing import amex
from spending_tracker.data_processing import nationwide
from spending_tracker.data_processing import common
from spending_tracker.data_ingestion import pdf_parsing
from spending_tracker.data_processing import table_schema
from spending_tracker.classification import classify
from spending_tracker.database import supabase_client
from spending_tracker.database import transactions as transactions_db


_BANK_TO_EXT_MAPPING = {
    "Chase": "pdf",
    "Amex": "csv",
    "Nationwide": "csv"
}


_BANK_TO_DATA_LOADING_FUNCTIONS = {
    "Chase": chase.load_raw_chase_statement_pdf,
    "Amex": amex.load_raw_amex_statement_csv,
    "Nationwide": nationwide.load_raw_nationwide_statement_csv
}


_BANK_TO_PROCESSING_FUNCTIONS = {
    "Chase": chase.clean_chase_transaction_dataframe,
    "Amex": amex.clean_amex_transaction_dataframe,
    "Nationwide": nationwide.clean_nationwide_transaction_dataframe
}

def create_transactions_metadata_df(cleaned_transactions_df: pd.DataFrame,
                                    labelled_examples=[]) -> pd.DataFrame:
    """
    Create a table that is a mix of LLM and Manual changes through the dashboard. 

    """
    transactions_metadata_df = cleaned_transactions_df[["event_id", "merchant", "amount"] + table_schema._PARTITION_COLS]

    # code to utilise LLM suggestions
    transactions_metadata_df = classify.apply_to_df(transactions_metadata_df, labelled_examples)

    # add NULL columns for default values of manually changed fiels
    transactions_metadata_df["manual_merchant"] = None
    transactions_metadata_df["manual_category"] = None
    transactions_metadata_df["manual_amount"] = None
    transactions_metadata_df["hidden"] = False

    return transactions_metadata_df


def parse_and_clean_single_dataset(data_home: Path,
                                   user: str,
                                   bank: str,
                                   account_id: str,
                                   month: str, 
                                   labelled_examples: list) -> list:
    raw_transactions_data_root = data_home / "transactions" / "raw"
    processed_transactions_data_root = data_home / "transactions" / "processed"
    transaction_metadata_data_root = data_home / "transactions_metadata"

    # might be a pdf/cv so figure out which one: 
    ext = _BANK_TO_EXT_MAPPING.get(bank)
    raw_data_path = raw_transactions_data_root / user / bank / account_id / month / f"statement.{ext}"
    
    # Parse the PDF to a DataFrame
    raw_transactions_df = _BANK_TO_DATA_LOADING_FUNCTIONS[bank](raw_data_path)

    # Clean the DataFrame
    cleaned_transactions_df = _BANK_TO_PROCESSING_FUNCTIONS[bank](raw_transactions_df, 
                                                                account_id=account_id, 
                                                                user=user)

    # Save the cleaned DataFrame to CSV
    common.save_partitioned_dataframe_to_csv(cleaned_transactions_df, 
                                             processed_transactions_data_root, 
                                             partition_columns=table_schema._PARTITION_COLS, 
                                             export_columns=table_schema._TRANSACTIONS_DB_COLUMNS,
                                             filename="transactions.csv")

    transactions_metadata_df = create_transactions_metadata_df(cleaned_transactions_df, labelled_examples)

    common.save_partitioned_dataframe_to_csv(transactions_metadata_df,
                                             transaction_metadata_data_root,
                                             partition_columns=table_schema._PARTITION_COLS,
                                             export_columns=table_schema._TRANSACTIONS_METADATA_DB_COLUMNS,
                                             filename="transaction_metadata.csv")


def parse_and_clean_batch(data_home: Path,
                          specific_user: str = None,
                          specific_account_id: str = None,
                          specific_bank: str = None,
                          specific_month: str = None) -> list:
    raw_transactions_data_root = data_home / "transactions" / "raw"
    raw_transaction_tuples = pdf_parsing.find_raw_transaction_partitions(raw_transactions_data_root)

    # load manually labelled examples from the database
    client = supabase_client.load_supabase_client()
    labelled_examples = transactions_db.fetch_manually_categorised_transactions_as_dict(client)
    
    for user, bank, account_id, month, _ in raw_transaction_tuples:
        if specific_user and user != specific_user:
            continue
        if specific_month and month != specific_month:
            continue
        if specific_account_id and account_id != specific_account_id:
            continue
        if specific_bank and bank != specific_bank:
            continue
        print(f"Processing {user}/{bank}/{account_id}/{month}")
        parse_and_clean_single_dataset(data_home, user, bank, account_id, month, labelled_examples)

    return None