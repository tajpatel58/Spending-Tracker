import os
from pathlib import Path
from supabase import create_client
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
    key = os.getenv("SUPABASE_ANON_KEY")
    
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in the .env file.")
    
    return create_client(url, key)