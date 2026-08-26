from pathlib import Path
import pandas as pd
from spending_tracker.data_processing import chase
from spending_tracker.data_processing import amex
from spending_tracker.data_processing import nationwide
from spending_tracker.data_processing import common
from spending_tracker.data_ingestion import pdf_parsing
from spending_tracker.data_processing import table_schema


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

def create_transactions_metadata_df(cleaned_transactions_df: pd.DataFrame) -> pd.DataFrame:
    """
    Create a table that is a mix of LLM and Manual changes through the dashboard. 

    """
    transactions_metadata_df = cleaned_transactions_df[["event_id", "merchant"] + table_schema._PARTITION_COLS]

    # code to utilise LLM suggestions
    transactions_metadata_df["llm_merchant"] = transactions_metadata_df["merchant"]
    transactions_metadata_df["llm_category"] = None

    # add NULL columns for default values of manually changed fiels
    transactions_metadata_df["manual_merchant"] = None
    transactions_metadata_df["manual_category"] = None
    transactions_metadata_df["manual_amount"] = None
    transactions_metadata_df["hidden"] = False

    return transactions_metadata_df


def parse_and_clean(data_home: Path) -> list:
    raw_transactions_data_root = data_home / "transactions" / "raw"
    processed_transactions_data_root = data_home / "transactions" / "processed"
    transaction_metadata_data_root = data_home / "transactions_metadata"
    raw_transaction_tuples = pdf_parsing.find_raw_transaction_partitions(raw_transactions_data_root)
    
    for user, bank, account_id, month, filename in raw_transaction_tuples:
        raw_data_path = raw_transactions_data_root / user / bank / account_id / month / f"{filename}"

        # Parse the PDF to a DataFrame
        raw_transactions_df = _BANK_TO_DATA_LOADING_FUNCTIONS[bank](raw_data_path)

        # Clean the DataFrame
        cleaned_transactions_df = _BANK_TO_PROCESSING_FUNCTIONS[bank](raw_transactions_df, 
                                                                    account_id=account_id, 
                                                                    user=user)

        # Save the cleaned DataFrame to CSV
        common.save_partitioned_dataframe_to_csv(cleaned_transactions_df, processed_transactions_data_root, 
                                                 partition_columns=table_schema._PARTITION_COLS, 
                                                 export_columns=table_schema._TRANSACTIONS_DB_COLUMNS,
                                                 filename="transactions.csv")

        transactions_metadata_df = create_transactions_metadata_df(cleaned_transactions_df)

        common.save_partitioned_dataframe_to_csv(transactions_metadata_df,
                                                 transaction_metadata_data_root,
                                                 partition_columns=table_schema._PARTITION_COLS,
                                                 export_columns=table_schema._TRANSACTIONS_METADATA_DB_COLUMNS,
                                                 filename="transaction_metadata.csv")



    return None