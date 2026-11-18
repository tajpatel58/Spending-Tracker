import os
import time
import pandas as pd
from loguru import logger
from pathlib import Path
from datetime import datetime, timedelta
from spending_tracker.data_ingestion import csv_parsing
from spending_tracker.data_processing import lunchflow
from spending_tracker.database import transactions as transactions_db
from spending_tracker.data_processing import common
from spending_tracker.data_processing import statements
from spending_tracker.data_processing import table_schema
from spending_tracker.classification import classify
from spending_tracker.logging_config import setup_logging, log_run_summary

setup_logging(run_name="daily_pipeline")
run_started = time.perf_counter()

todays_month = datetime.now().strftime("%B-%y")
from_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
examples_for_categorisation_date = "2026-10-01"
data_home = Path(__file__).resolve().parents[1] / "data"
processed_transactions_data_home = data_home / "transactions" / "processed"
transaction_metadata_home = data_home / "transactions_metadata"
force_llm = False
upsert_cols = ["event_id"]
lunchflow_account_ids = []
llm_model = os.getenv("LLM_MODEL", "ollama") # need to be one of claude/ollama. CI sets LLM_MODEL=claude.

"""
For each mapped lunchflow account, fetch transactions from the start of `month` (e.g. "October-26",
defaults to the current month) onwards, clean them and save them to
data_home/transactions/processed/<user>/<bank>/<account_id>/<month>/transactions.csv.
Returns a single combined dataframe of everything saved.
"""

processed_transactions_data_root = data_home / "transactions" / "processed"
transaction_metadata_data_root = data_home / "transactions_metadata"
logger.info(f"Starting daily pipeline: transactions from {from_date}, LLM = {llm_model}")

account_mapping_df = lunchflow.load_lunchflow_account_mapping(lunchflow_account_ids)
logger.info(f"Loaded {len(account_mapping_df)} lunchflow accounts from Supabase")
upsert_transactions_df_list =  []
upsert_transactions_metadata_df_list = []
llm_usage = classify.new_llm_usage()
account_metrics = {}  # account_id -> one-line summary, for the end-of-run table

# fetch labelled data from supabase
labelled_examples = transactions_db.fetch_manually_categorised_transactions_as_dict(examples_for_categorisation_date
                                                                                    )
logger.info(f"Loaded {len(labelled_examples)} manually labelled examples (since {examples_for_categorisation_date})")

for row in account_mapping_df.itertuples(index=False):
    transactions_response = lunchflow.get_transactions(row.lunchflow_account_id, 
                                                       from_date=from_date)
    
    transactions_df = lunchflow.transactions_to_dataframe(transactions_response)

    if transactions_df.empty:
        logger.info(f"{row.bank}/{row.account_id}: no transactions since {from_date}")
        account_metrics[f"{row.bank}/{row.account_id}"] = "0 fetched"

    if not transactions_df.empty:
        logger.info(f"{row.bank}/{row.account_id}: fetched {len(transactions_df)} transactions")
        llm_calls_before = llm_usage["calls"]
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
        
        transactions_metadata_df = statements.create_transactions_metadata_df(cleaned_transactions_df, 
                                                                              labelled_examples,
                                                                              force_llm,
                                                                              llm_model,
                                                                              llm_usage)

        common.save_partitioned_dataframe_to_csv(transactions_metadata_df,
                                                transaction_metadata_data_root,
                                                partition_columns=table_schema._LUNCHFLOW_PARTITION_COLS,
                                                export_columns=table_schema._TRANSACTIONS_METADATA_DB_COLUMNS,
                                                filename="transaction_metadata.csv",
                                                upsert_cols=upsert_cols)

        upsert_transactions_df_list.append(cleaned_transactions_df)
        upsert_transactions_metadata_df_list.append(transactions_metadata_df)

        kept = len(cleaned_transactions_df)
        account_metrics[f"{row.bank}/{row.account_id}"] = (
            f"{len(transactions_df)} fetched, {kept} kept (settled), "
            f"{llm_usage['calls'] - llm_calls_before} LLM calls"
        )


logger.info(classify.llm_usage_summary(llm_usage, llm_model))

upload_metrics = {}
if not upsert_transactions_df_list:
    # pd.concat([]) would raise, so a quiet few days ends the run cleanly instead
    logger.warning(f"No new transactions since {from_date}; nothing to upload")
else:
    upsert_transactions_df = pd.concat(upsert_transactions_df_list)[table_schema._TRANSACTIONS_DB_COLUMNS]
    upsert_transactions_metadata_df = pd.concat(upsert_transactions_metadata_df_list)[table_schema._TRANSACTIONS_METADATA_DB_COLUMNS]

    transactions_db.upload_transactions_to_db(upsert_transactions_df, 
                                           table_name="transactions")

    transactions_db.upload_transactions_to_db(upsert_transactions_metadata_df, 
                                           table_name="transactions_metadata",
                                           exclude_columns=["manual_merchant", "manual_category", "manual_amount", "manual_date", "hidden", "manual_sub_category"])
    upload_metrics = {"transactions": f"{len(upsert_transactions_df)} rows",
                      "transactions_metadata": f"{len(upsert_transactions_metadata_df)} rows"}

llm_cost = classify.llm_usage_cost(llm_usage, llm_model)
log_run_summary("Daily pipeline summary", {
    "Run": {
        "LLM model": llm_model,
        "Transactions from": from_date,
        "Labelled examples": len(labelled_examples),
        "Duration": f"{time.perf_counter() - run_started:.1f}s",
    },
    "Accounts": account_metrics or {"(none)": "no accounts mapped"},
    "Supabase upserts": upload_metrics or {"(none)": "nothing to upload"},
    "LLM usage": {
        **{key: f"{value:,}" for key, value in llm_usage.items()},
        "est. cost": f"${llm_cost:.4f}" if llm_cost is not None else "n/a (local)",
    },
})