from pathlib import Path
from spending_tracker.data_processing import chase
from spending_tracker.data_processing import amex
from spending_tracker.data_processing import nationwide
from spending_tracker.data_processing import common
from spending_tracker.data_ingestion import pdf_parsing


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


def parse_and_clean(data_home: Path) -> list:
    raw_transactions_data_root = data_home / "transactions" / "raw"
    processed_transactions_data_root = data_home / "transactions" / "processed"
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
                                                 partition_columns=["user", "bank", "account_id", "month"], filename="statement.csv")
    return None