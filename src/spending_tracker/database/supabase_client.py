import os
from pathlib import Path
from supabase import create_client
from storage3.exceptions import StorageApiError
from dotenv import load_dotenv


def load_env_variables():
    """
    Load environment variables from a .env file.
    """
    env_path = Path(__file__).parents[3]/ ".env"
    if not env_path.exists():
        raise FileNotFoundError(f".env file not found at {env_path}")
    
    load_dotenv(dotenv_path=env_path)
    return None


def load_supabase_client():
    """
    Load the Supabase client using environment variables.
    """
    load_env_variables()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the .env file.")
    
    return create_client(url, key)


def load_bucket(bucket_name: str):
    """
    Load the Supabase storage bucket for the spending tracker.
    """
    client = load_supabase_client()
    try:
        client.storage.get_bucket(bucket_name)
    except StorageApiError as e:
        raise ValueError(f"Supabase storage bucket '{bucket_name}' not found.") from e

    return client.storage.from_(bucket_name)


def list_all(path: Path, bucket):
    """List every entry in a folder, handling pagination."""
    items, offset = [], 0
    while True:
        page = bucket.list(path, {"limit": 100, "offset": offset})
        items += page
        if len(page) < 100:
            return items
        offset += 100


def list_folders(path: Path, bucket):
    return [e["name"] for e in list_all(path, bucket) if e.get("id") is None]


def list_files(path: Path, bucket):
    return [e["name"] for e in list_all(path, bucket)
            if e.get("id") is not None and not e["name"].startswith(".")]