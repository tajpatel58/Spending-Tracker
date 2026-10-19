import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from spending_tracker.data_ingestion import csv_parsing
from spending_tracker.data_processing import lunchflow
from spending_tracker.database import transactions as transactions_db
from spending_tracker.data_processing import common
from spending_tracker.data_processing import statements
from spending_tracker.data_processing import table_schema

todays_month = datetime.now().strftime("%B-%y")
from_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
examples_for_categorisation_date = "2026-10-01"
data_home = Path(__file__).resolve().parents[2] / "data"
processed_transactions_data_home = data_home / "transactions" / "processed"
transaction_metadata_home = data_home / "transactions_metadata"
force_llm = False
upsert_cols = ["event_id"]
lunchflow_account_ids = []


"""
For each mapped lunchflow account, fetch transactions from the start of `month` (e.g. "October-26",
defaults to the current month) onwards, clean them and save them to
data_home/transactions/processed/<user>/<bank>/<account_id>/<month>/transactions.csv.
Returns a single combined dataframe of everything saved.
"""

processed_transactions_data_root = data_home / "transactions" / "processed"
transaction_metadata_data_root = data_home / "transactions_metadata"
account_mapping_df = lunchflow.load_lunchflow_account_mapping(lunchflow_account_ids)
upsert_transactions_df_list =  []
upsert_transactions_metadata_df_list = []

for row in account_mapping_df.itertuples(index=False):
    transactions_response = lunchflow.get_transactions(row.lunchflow_account_id, 
                                                       from_date=from_date)
    
    transactions_df = lunchflow.transactions_to_dataframe(transactions_response)

    if not transactions_df.empty:
        print(f"Running Transactions for {row.account_id}")
        cleaned_transactions_df = lunchflow.clean_lunchflow_transactions_df(transactions_df,
                                                                    user=row.user,
                                                                    bank=row.bank,
                                                                    account_id=row.account_id)

        # partitions by month too, as transactions from `month` onwards can span several months
        common.save_partitioned_dataframe_to_csv(cleaned_transactions_df,
                                                processed_transactions_data_root,
                                                partition_columns=table_schema._LUNCHFLOW_PARTITION_COLS,
                                                export_columns=table_schema._TRANSACTIONS_DB_COLUMNS,
                                                filename="transactions.csv",
                                                upsert_cols=upsert_cols)

        # fetch labelled data from supabase
        labelled_examples = transactions_db.fetch_manually_categorised_transactions_as_dict(examples_for_categorisation_date
                                                                                            )
        
        transactions_metadata_df = statements.create_transactions_metadata_df(cleaned_transactions_df, 
                                                                                labelled_examples,
                                                                                force_llm)

        common.save_partitioned_dataframe_to_csv(transactions_metadata_df,
                                                    transaction_metadata_data_root,
                                                    partition_columns=table_schema._LUNCHFLOW_PARTITION_COLS,
                                                    export_columns=table_schema._TRANSACTIONS_METADATA_DB_COLUMNS,
                                                    filename="transaction_metadata.csv",
                                                    upsert_cols=upsert_cols)

        upsert_transactions_df_list.append(cleaned_transactions_df)
        upsert_transactions_metadata_df_list.append(transactions_metadata_df)


upsert_transactions_df = pd.concat(upsert_transactions_df_list)[table_schema._TRANSACTIONS_DB_COLUMNS]
upsert_transactions_metadata_df = pd.concat(upsert_transactions_metadata_df_list)[table_schema._TRANSACTIONS_METADATA_DB_COLUMNS]


transactions_db.upload_transactions_to_db(upsert_transactions_df, 
                                       table_name="transactions")

transactions_db.upload_transactions_to_db(upsert_transactions_metadata_df, 
                                       table_name="transactions_metadata",
                                       exclude_columns=["manual_merchant", "manual_category", "manual_amount", "manual_date", "hidden"])