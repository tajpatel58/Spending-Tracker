from pathlib import Path
from spending_tracker.data_processing import chase
from spending_tracker.data_processing import common
from spending_tracker.data_ingestion import pdf_parsing


_COLS_PER_BANK = {
    "Chase": ["date", "transaction_details", "amount", "balance"],
}


_BANK_TO_PROCESSING_FUNCTIONS = {
    "Chase": chase.clean_transaction_dataframe,
}


def parse_and_clean(data_home: Path) -> list:
    raw_transactions_data_root = data_home / "transactions" / "raw"
    processed_transactions_data_root = data_home / "transactions" / "processed"
    raw_transaction_tuples = pdf_parsing.find_raw_transaction_partitions(raw_transactions_data_root)
    for user, bank, account_id, month in raw_transaction_tuples:
        pdf_path = raw_transactions_data_root / user / bank / account_id / month / "statement.pdf"
        csv_path = processed_transactions_data_root / user / bank / account_id / month / "statement.csv"

        # Parse the PDF to a DataFrame
        raw_transactions_df = pdf_parsing.pdf_to_dataframe(pdf_path, columns=_COLS_PER_BANK.get(bank))

        # Clean the DataFrame
        cleaned_transactions_df = _BANK_TO_PROCESSING_FUNCTIONS.get(bank)(raw_transactions_df, account_id, user)

        # Save the cleaned DataFrame to CSV
        common.save_dataframe_to_csv(cleaned_transactions_df, csv_path)
    return None