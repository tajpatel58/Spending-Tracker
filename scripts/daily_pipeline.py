import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from loguru import logger

from spending_tracker.classification import classify
from spending_tracker.data_processing import common, lunchflow, statements, table_schema
from spending_tracker.database import fetch
from spending_tracker.database import transactions as transactions_db
from spending_tracker.logging_config import (
    finalise_log_file,
    log_pipeline_summary,
    setup_logging,
)

# By Default this pipeline will fetch (today - num_days_lag) -> today transactions and process them.
# adjustable pipeline params
num_days_lag = 5
start_date_for_labelled_transactions = "2026-10-01"
end_date_for_labelled_transactions = (
    ""  # defaults to todays date if not set, change for testing more LLM calls.
)
force_llm = False
upsert_cols = ["event_id"]
lunchflow_account_ids = []  # defaults to running all.
llm_model = "claude"  # need to be one of claude/ollama. CI sets LLM_MODEL=claude.
dry_run = True  # estimate only: fetches transactions, no LLM calls, no uploads
max_llm_cost_usd = float(
    os.getenv("MAX_LLM_COST_USD", "0.05")
)  # abort if the worst-case estimate is above this


# additional pipeline params.
setup_logging(run_name="daily_pipeline")
run_started = time.perf_counter()
from_date = (datetime.now() - timedelta(days=num_days_lag)).strftime("%Y-%m-%d")
end_date_for_labelled_transactions = (
    end_date_for_labelled_transactions or datetime.now().strftime("%Y-%m-%d")
)

# env vars used in workflow, overwrites if set.
dry_run = os.getenv("LLM_DRY_RUN", str(dry_run)).lower() == "true"
llm_model = os.getenv("LLM_MODEL", llm_model)


# path params
data_home = Path(__file__).resolve().parents[1] / "data"
processed_transactions_data_root = data_home / "transactions" / "processed"
transaction_metadata_data_root = data_home / "transactions_metadata"


logger.bind(public=True).info(
    f"Starting daily pipeline: transactions from {from_date}, LLM = {llm_model}"
    + (" (DRY RUN)" if dry_run else "")
)

account_mapping_df = lunchflow.load_lunchflow_account_mapping(lunchflow_account_ids)
logger.bind(public=True).info(
    f"Loaded {len(account_mapping_df)} lunchflow accounts from Supabase"
)
cleaned_by_account = {}  # "bank/account_id" -> cleaned transactions, from pass 1
upsert_transactions_metadata_df_list = []
llm_usage = classify.new_llm_usage()
llm_estimate = {}
account_metrics = {}  # "bank/account_id" -> one-line summary, for the end-of-run table (never public)
totals = {
    "accounts": len(account_mapping_df),
    "accounts_with_transactions": 0,
    "fetched": 0,
    "kept": 0,
}
upload_metrics = {}

# fetch labelled data from supabase
labelled_examples = fetch.load_labelled_transactions_as_dict(
    start_date_for_labelled_transactions, end_date_for_labelled_transactions
)
logger.bind(public=True).info(
    f"Loaded {len(labelled_examples)} labelled examples (from {start_date_for_labelled_transactions} -> {end_date_for_labelled_transactions})"
)


def emit_summary(status: str) -> None:
    """Log the end-of-run metrics table (also on dry runs and aborts) with the run's current state."""
    log_pipeline_summary(
        status,
        llm_model=llm_model,
        from_date=from_date,
        labelled_examples_count=len(labelled_examples),
        duration_seconds=time.perf_counter() - run_started,
        account_metrics=account_metrics,
        totals=totals,
        llm_estimate=llm_estimate,
        max_llm_cost_usd=max_llm_cost_usd,
        llm_usage=llm_usage,
        llm_cost=classify.llm_usage_cost(llm_usage, llm_model),
        upload_metrics=upload_metrics,
    )
    finalise_log_file(status)  # move this run's log into logs/<status>/


#### For each Account-ID fetch transactions + clean.
for row in account_mapping_df.itertuples(index=False):
    account = f"{row.bank}/{row.account_id}"
    transactions_response = lunchflow.get_transactions(
        row.lunchflow_account_id, from_date=from_date
    )

    transactions_df = lunchflow.transactions_to_dataframe(transactions_response)

    if transactions_df.empty:
        logger.info(f"{account}: no transactions since {from_date}")
        account_metrics[account] = "0 fetched"
        continue

    cleaned_transactions_df = lunchflow.clean_lunchflow_transactions_df(
        transactions_df, user=row.user, bank=row.bank, account_id=row.account_id
    )
    logger.info(
        f"{account}: fetched {len(transactions_df)} transactions, {len(cleaned_transactions_df)} settled"
    )

    # partitions by month too, as transactions from `month` onwards can span several months
    common.save_partitioned_dataframe_to_csv(
        cleaned_transactions_df,
        processed_transactions_data_root,
        partition_columns=table_schema._LUNCHFLOW_PARTITION_COLS,
        export_columns=table_schema._TRANSACTIONS_DB_COLUMNS,
        filename="transactions.csv",
        upsert_cols=upsert_cols,
    )

    cleaned_by_account[account] = cleaned_transactions_df
    account_metrics[account] = (
        f"{len(transactions_df)} fetched, {len(cleaned_transactions_df)} kept (settled)"
    )
    totals["accounts_with_transactions"] += 1
    totals["fetched"] += len(transactions_df)
    totals["kept"] += len(cleaned_transactions_df)


if not cleaned_by_account:
    # pd.concat([]) would raise, so a quiet few days ends the run cleanly instead
    logger.bind(public=True).warning(
        f"No new transactions since {from_date}; nothing to classify or upload"
    )
    emit_summary("completed")
    sys.exit(0)


# estimate costs of LLM use.
all_cleaned_df = pd.concat(cleaned_by_account.values())

# returns dict summary, 0 if using local ollama.
llm_estimate = classify.estimate_llm_run(
    all_cleaned_df, labelled_examples, force_llm, llm_model
)

if llm_estimate["over_call_cap"] or llm_estimate["worst_case_cost"] > max_llm_cost_usd:
    logger.bind(public=True).error(
        f"Aborting before any LLM call: {llm_estimate['calls']} calls, worst case "
        f"${llm_estimate['worst_case_cost']:.4f} (budget ${max_llm_cost_usd:.4f}, "
        f"call cap {classify.claude.DEFAULT_MAX_CALLS_PER_RUN}). Raise MAX_LLM_COST_USD / the cap if this is expected."
    )
    emit_summary("aborted: over budget")
    sys.exit(1)

if dry_run:
    logger.bind(public=True).warning(
        "Dry run: stopping before LLM calls and Supabase uploads (set LLM_DRY_RUN=false to run for real)"
    )
    emit_summary("dry run")
    sys.exit(0)


for account, cleaned_transactions_df in cleaned_by_account.items():
    llm_calls_before = llm_usage["calls"]
    transactions_metadata_df = statements.create_transactions_metadata_df(
        cleaned_transactions_df, labelled_examples, force_llm, llm_model, llm_usage
    )

    common.save_partitioned_dataframe_to_csv(
        transactions_metadata_df,
        transaction_metadata_data_root,
        partition_columns=table_schema._LUNCHFLOW_PARTITION_COLS,
        export_columns=table_schema._TRANSACTIONS_METADATA_DB_COLUMNS,
        filename="transaction_metadata.csv",
        upsert_cols=upsert_cols,
    )

    upsert_transactions_metadata_df_list.append(transactions_metadata_df)
    account_metrics[account] += f", {llm_usage['calls'] - llm_calls_before} LLM calls"


logger.bind(public=True).info(classify.llm_usage_summary(llm_usage, llm_model))

upsert_transactions_df = all_cleaned_df[table_schema._TRANSACTIONS_DB_COLUMNS]
upsert_transactions_metadata_df = pd.concat(upsert_transactions_metadata_df_list)[
    table_schema._TRANSACTIONS_METADATA_DB_COLUMNS
]

transactions_db.upload_transactions_to_db(
    upsert_transactions_df, table_name="transactions"
)

transactions_db.upload_transactions_to_db(
    upsert_transactions_metadata_df,
    table_name="transactions_metadata",
    exclude_columns=[
        "manual_merchant",
        "manual_category",
        "manual_amount",
        "manual_date",
        "hidden",
        "manual_sub_category",
    ],
)
upload_metrics = {
    "transactions": f"{len(upsert_transactions_df)} rows",
    "transactions_metadata": f"{len(upsert_transactions_metadata_df)} rows",
}

emit_summary("completed")
