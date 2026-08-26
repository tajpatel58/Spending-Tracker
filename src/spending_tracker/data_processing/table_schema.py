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

_TRANSACTIONS_METADATA_DB_COLUMNS = [
    "event_id",
    "llm_merchant",
    "llm_category",
    "manual_merchant",
    "manual_category",
    "manual_amount",
    "hidden",
]

_PARTITION_COLS = ["user", 
                   "bank", 
                   "account_id", 
                   "month"]