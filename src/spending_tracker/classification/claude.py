import os
import anthropic
from spending_tracker.database.supabase_client import load_env_variables

MODEL = "claude-haiku-5-5"
MAX_TOKENS = 512

# $ per million tokens for prompts up to 100k tokens (ours are ~5k)
INPUT_PRICE_PER_MTOK = 0.10
OUTPUT_PRICE_PER_MTOK = 0.50

# Hard stop on calls per run, so a bug (or a huge backfill) can't run up a bill.
DEFAULT_MAX_CALLS_PER_RUN = 20

_client = None
# Calls made this run, for the hard stop above. Token/cost totals live in classify.llm_usage.
_calls_this_run = 0


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        # Load .env ourselves rather than relying on Supabase having been called first.
        # Skipped when the key is already in the environment (e.g. CI with no .env file).
        if not os.getenv("ANTHROPIC_API_KEY"):
            load_env_variables()
        _client = anthropic.Anthropic()
    return _client


def claude_chat(prompt: str, schema: dict | None = None) -> tuple[str, int, int]:
    """Send a prompt to Claude and return (reply_text, input_tokens, output_tokens).
    - No schema: the reply is plain text.
    - With schema: the reply is a JSON string constrained to the schema."""
    global _calls_this_run
    max_calls = DEFAULT_MAX_CALLS_PER_RUN
    if _calls_this_run >= max_calls:
        raise RuntimeError(
            f"Reached DEFAULT_MAX_CALLS_PER_RUN={max_calls}; stopping before making more Claude calls."
        )
    _calls_this_run += 1

    output_config = {"effort": "low"}
    if schema is not None:
        output_config["format"] = {"type": "json_schema", "schema": schema}

    response = _get_client().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking={"type": "disabled"},
        output_config=output_config,
        messages=[{"role": "user", "content": prompt}],
    )

    if response.stop_reason == "refusal":
        raise ValueError(f"Claude declined the request: {response.stop_details}")
    if response.stop_reason == "max_tokens":
        raise ValueError("Claude hit max_tokens before finishing its reply.")

    text = "".join(block.text for block in response.content if block.type == "text")
    if not text:
        raise ValueError("Claude returned no text content.")
    return text, response.usage.input_tokens, response.usage.output_tokens
