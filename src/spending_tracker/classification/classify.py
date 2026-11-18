
import json
import pandas as pd
from pathlib import Path
from spending_tracker.classification import prompts
from spending_tracker.classification.ollama import ollama_chat
from spending_tracker.classification import claude
from spending_tracker.classification.claude import claude_chat


NUMBER = (int, float)
NULLABLE_NUMBER = (int, float, type(None))

def load_llm_schemas():
    schemas_path = Path(__file__).with_name("llm_schemas.json")
    with schemas_path.open() as f:
        llm_schemas = json.load(f)
    return llm_schemas


LLM_SCHEMAS = load_llm_schemas()


def new_llm_usage() -> dict:
    """Empty usage counter to pass as `llm_usage` and add to across LLM calls."""
    return {"calls": 0, "input_tokens": 0, "output_tokens": 0}


def llm_usage_summary(llm_usage: dict, llm_model: str = "ollama") -> str:
    """One-line summary of calls/tokens, with an estimated cost for Claude (Ollama runs locally)."""
    summary = (
        f"LLM ({llm_model}): {llm_usage['calls']} calls, "
        f"{llm_usage['input_tokens']} input / {llm_usage['output_tokens']} output tokens"
    )
    if llm_model == "claude":
        cost = (
            llm_usage["input_tokens"] * claude.INPUT_PRICE_PER_MTOK
            + llm_usage["output_tokens"] * claude.OUTPUT_PRICE_PER_MTOK
        ) / 1_000_000
        summary += f", ~${cost:.4f}"
    return summary


def llm_chat(prompt: str, 
             schema: dict | None = None, 
             llm_model: str = "ollama",
             llm_usage: dict | None = None) -> str:
    """Send a prompt to the chosen LLM and return its reply text.

    If llm_usage is given, its calls/input_tokens/output_tokens are incremented in place.
    """
    if llm_model == "ollama":
        response = ollama_chat(prompt, schema)
        content = response.message.content
        input_tokens = response.prompt_eval_count or 0
        output_tokens = response.eval_count or 0
    elif llm_model == "claude":
        content, input_tokens, output_tokens = claude_chat(prompt, schema)
    else:
        raise ValueError(f"{llm_model} not a valid LLM Model type")

    if llm_usage is not None:
        llm_usage["calls"] += 1
        llm_usage["input_tokens"] += input_tokens
        llm_usage["output_tokens"] += output_tokens

    return content


def check_json_response(content: str, field_types: dict[str, tuple[type, ...] | type]) -> dict:
    """
    Parse an LLM's JSON reply and check each required field has the expected type.

    field_types maps field name -> allowed type(s). Include type(None) to allow null.
    Extra fields in the reply are kept but not checked.
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM returned invalid JSON: {content}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"LLM JSON must be an object, got {type(data).__name__}: {content}")

    missing_fields = field_types.keys() - data.keys()
    if missing_fields:
        raise ValueError(f"LLM response is missing fields: {sorted(missing_fields)}")

    for field, allowed in field_types.items():
        allowed = allowed if isinstance(allowed, tuple) else (allowed,)
        value = data[field]
        # bool is a subclass of int, so `true` would otherwise pass as a number
        if isinstance(value, bool) and bool not in allowed:
            ok = False
        else:
            ok = isinstance(value, allowed)
        if not ok:
            names = " or ".join("null" if t is type(None) else t.__name__ for t in allowed)
            raise ValueError(
                f"Field '{field}' must be {names}, got {type(value).__name__}: {value!r}"
            )

    return data


def llm_classify_transaction(
    merchant: str,
    amount: float,
    examples: list[dict],
    llm_model: str = "ollama",
    llm_usage: dict | None = None,
) -> dict:
    """
    Classify a transaction and clean its merchant name using an LLM

    Parameters
    ----------
    merchant:
        Original/raw merchant name from the bank transaction.

    amount:
        Transaction amount.

    examples:
        Human-labelled transactions used to help classify the
        transaction. Each example should contain:
            merchant
            cleaned_merchant
            amount
            category

    llm_usage:
        Optional usage counter (see new_llm_usage), updated in place.

    Returns
    -------
    dict
        Example:
        {
            "merchant": "Tesco",
            "category": "Groceries",
            "confidence": 0.98
        }
    """

    prompt = prompts.build_transaction_classification_prompt(
        merchant=merchant,
        amount=amount,
        examples=examples,
    )

    content = llm_chat(prompt, 
                       schema=LLM_SCHEMAS["transaction_classification"], 
                       llm_model=llm_model,
                       llm_usage=llm_usage)

    classification = check_json_response(
        content,
        {"merchant": str, "category": str, "confidence": NUMBER},
    )

    if not 0 <= classification["confidence"] <= 1:
        raise ValueError(
            "Confidence must be between 0 and 1."
        )

    return classification


def llm_extract_calendar_event(event: dict,
                               llm_model: str = "ollama",
                               llm_usage: dict | None = None) -> dict:
    prompt = prompts.build_calendar_event_extraction_prompt(event)

    content = llm_chat(prompt, 
                       schema=LLM_SCHEMAS["calendar_event_extraction"], 
                       llm_model=llm_model,
                       llm_usage=llm_usage)

    extraction = check_json_response(
        content,
        {"budget": NULLABLE_NUMBER, "category": str},
    )

    # A missing or unrecognised sub-category is left for "To sort" rather than failing the event
    if extraction.get("sub_category") not in prompts.HOLIDAY_SUB_CATEGORIES:
        extraction["sub_category"] = None

    return extraction


def transactions_apply_to_df(
    transactions_metadata_df: pd.DataFrame,
    examples: list[dict],
    force_llm: bool = False,
    llm_model: str = "ollama",
    llm_usage: dict | None = None,
) -> pd.DataFrame:
    """
    Classify transactions in a DataFrame.

    Adds:
        llm_merchant
        llm_category

    If llm_usage is given, it is updated in place with this run's LLM calls/tokens.
    """

    results = []

    merchant_to_category = {example["merchant"]: example["category"] for example in examples}
    merchant_to_cleaned_merchant = {example["merchant"]: example["cleaned_merchant"] for example in examples}

    for row in transactions_metadata_df.itertuples(index=False):
        if row.merchant in merchant_to_category and not force_llm:
            # fetch cleaned merchant
            cleaned_merchant = merchant_to_cleaned_merchant[row.merchant]

            # Use the pre-classified category
            results.append({
                "merchant": cleaned_merchant,
                "category": merchant_to_category[row.merchant],
                "confidence": 1.0
            })
            continue

        result = llm_classify_transaction(
            merchant=row.merchant,
            amount=row.amount,
            examples=examples,
            llm_model=llm_model,
            llm_usage=llm_usage,
        )

        results.append(result)

    result_df = pd.DataFrame(results, index=transactions_metadata_df.index, columns=["merchant", "category", "confidence"])

    # merge datasets on index to ensure alignment:
    transactions_metadata_with_category_df = pd.DataFrame.copy(transactions_metadata_df)
    transactions_metadata_with_category_df[["llm_merchant", "llm_category"]] = result_df[["merchant", "category"]]

    return transactions_metadata_with_category_df