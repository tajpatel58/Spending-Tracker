import os
import json
from datetime import datetime
from pathlib import Path
import pandas as pd
import requests
from prefect import flow, task, get_run_logger
from spending_tracker.database.supabase_client import load_env_variables
from spending_tracker.data_processing import common
from spending_tracker.data_processing import table_schema

_ACCOUNT_COLUMNS = ["id", "connection_id", "name", "institution_name", "institution_logo", "provider", "status"]

@task(retries=3, retry_delay_seconds=30)
def get_accounts() -> pd.DataFrame:
  """Fetch the connected lunchflow accounts as a dataframe, one row per account."""
  load_env_variables()
  url = "https://www.lunchflow.app/api/v1/accounts"
  response = requests.request("GET", url, headers = {
    "x-api-key": os.environ["LUNCHFLOW_API_KEY"]
  })
  response.raise_for_status()
  accounts = response.json()["accounts"]

  # reindex so an empty response still has the expected columns
  accounts_df = pd.DataFrame(accounts).reindex(columns=_ACCOUNT_COLUMNS)

  # id as string to match lunchflow_account_id in the account mapping
  accounts_df["id"] = accounts_df["id"].astype(str)
  return accounts_df


@task(retries=3, retry_delay_seconds=30, task_run_name="get-transactions-{account_id}")
def get_transactions(account_id: str, 
                     from_date: str = None,
                     month: str = None) -> dict:
  """Fetch transactions from `from_date` (e.g. "2026-10-01") or the start of
  `month` (e.g. "October-26") onwards. Exactly one of the two must be given."""
  if (from_date is None) == (month is None):
    raise ValueError("Specify exactly one of `from_date` or `month`.")

  load_env_variables()

  url = f"https://www.lunchflow.app/api/v1/accounts/{account_id}/transactions"

  # reformat to align with api format
  if month is not None:
    from_date = datetime.strptime(month.strip(), "%B-%y").strftime("%Y-%m-%d")

  response = requests.request("GET", url, headers = {
    "x-api-key": os.environ["LUNCHFLOW_API_KEY"]
  }, params = {"from": from_date})
  response.raise_for_status()
  return response.text


_TRANSACTION_COLUMNS = ["id", "accountId", "date", "merchant", "description", "amount", "currency", "isPending"]

@task
def transactions_to_dataframe(transactions_response: str) -> pd.DataFrame:
  """Parse the raw transactions API response into a dataframe, one row per transaction."""
  transactions = json.loads(transactions_response)["transactions"]
  get_run_logger().info(f"Fetched {len(transactions)} transactions")

  # reindex so an empty response still has the expected columns
  df = pd.DataFrame(transactions).reindex(columns=_TRANSACTION_COLUMNS)
  return df


@task
def load_lunchflow_account_mapping(lunchflow_account_ids: list = []) -> pd.DataFrame:
  """
  Load the lunchflow account id -> {user, bank, account_id} mapping from accounts.csv as a dataframe,
  one row per lunchflow account with columns lunchflow_account_id, user, bank, account_id.
  """
  ACCOUNTS_FILE = Path(__file__).parents[3] / "data" / "accounts" / "accounts.csv"
  accounts_df = pd.read_csv(ACCOUNTS_FILE, dtype=str)
  accounts_df = accounts_df.rename(columns={"account_name": "bank"})

  if lunchflow_account_ids:
    accounts_df = accounts_df.loc[accounts_df["lunchflow_account_id"].isin(lunchflow_account_ids)]
  return accounts_df[["lunchflow_account_id", "user", "bank", "account_id"]].reset_index(drop=True)


@task
def clean_lunchflow_transactions_df(lunchflow_transactions_df: pd.DataFrame,
                                    user: str,
                                    bank: str,
                                    account_id: str) -> pd.DataFrame:
  """Standardise the raw lunchflow transactions dataframe to the cleaned transactions format."""

  # pending transactions can change id/amount once settled, so only keep settled ones
  lunchflow_transactions_df = lunchflow_transactions_df[~lunchflow_transactions_df["isPending"].astype(bool)]
  lunchflow_transactions_df = lunchflow_transactions_df[lunchflow_transactions_df["merchant"] != 'Round-up']

  lunchflow_transactions_df["lunchflow_account_id"] = lunchflow_transactions_df["accountId"].astype(str)
  lunchflow_transactions_df["user"] = user
  lunchflow_transactions_df["bank"] = bank
  lunchflow_transactions_df["account_id"] = account_id

  # Convert 'date' column to datetime and add month column for partitioning
  lunchflow_transactions_df["date"] = pd.to_datetime(lunchflow_transactions_df["date"], format="%Y-%m-%d")
  lunchflow_transactions_df["processing_month"] = lunchflow_transactions_df["date"].dt.strftime("%B-%y")

  # nationwide dates come through a day late, so shift them back before deriving the month
  if bank == "Nationwide":
    lunchflow_transactions_df["date"] = lunchflow_transactions_df["date"] - pd.Timedelta(days=1)

  lunchflow_transactions_df["month"] = lunchflow_transactions_df["date"].dt.strftime("%B-%y")
  lunchflow_transactions_df["date"] = lunchflow_transactions_df["date"].dt.strftime("%Y-%m-%d")
  lunchflow_transactions_df["other_details"] = lunchflow_transactions_df["merchant"]
  lunchflow_transactions_df["merchant"] = lunchflow_transactions_df["description"]
  lunchflow_transactions_df["type"] = None

  # lunchflow ids are stable per transaction, so hash them for the event_id
  lunchflow_transactions_df["event_id"] = lunchflow_transactions_df.apply(
    lambda row: common.generate_event_id(row["lunchflow_account_id"], 
                                         row["id"],
                                         row["user"],
                                         row["bank"],
                                         row["account_id"]),
    axis=1
  )

  lunchflow_transactions_df = lunchflow_transactions_df[table_schema._TRANSACTIONS_COLUMNS]
  return lunchflow_transactions_df