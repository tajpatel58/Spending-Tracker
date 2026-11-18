from spending_tracker.database import transactions as transactions_db

month_to_delete = "October-26"
transactions_db.delete_transactions_for_month(month=month_to_delete)