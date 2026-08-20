import hashlib

def generate_event_id(account_id, date, amount, description):
    raw = f"{account_id}|{date}|{amount}|{description}"

    return hashlib.sha256(raw.encode()).hexdigest()