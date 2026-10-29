_TRANSACTIONS_DB_COLUMNS = ["event_id", 
                            "date", 
                            "month", 
                            "account_id", 
                            "user",
                            "bank",
                            "merchant", 
                            "other_details", 
                            "type",
                            "amount"]

_TRANSACTIONS_COLUMNS = ["event_id", 
                            "date", 
                            "month", 
                            "processing_month",
                            "account_id", 
                            "user",
                            "bank",
                            "merchant", 
                            "other_details", 
                            "type",
                            "amount"]

_TRANSACTIONS_METADATA_DB_COLUMNS = [
    "event_id",
    "llm_merchant",
    "llm_category",
    "manual_merchant",
    "manual_category",
    "manual_sub_category",
    "manual_amount",
    "manual_date",
    "hidden",
]

_PARTITION_COLS = ["user", 
                   "bank", 
                   "account_id", 
                   "month"]

_LUNCHFLOW_PARTITION_COLS = ["user", 
                   "bank", 
                   "account_id", 
                   "processing_month"]