
import json
from ollama import chat
from spending_tracker.classification import prompts


MODEL = "qwen3:8b"

# Raise context window for OLLAMA
NUM_CTX = 16384
CONTEXT_HEADROOM = 256


def _chat_json(prompt: str):
    response = chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        format="json",
        think=False,
        options={"num_ctx": NUM_CTX},
    )

    # Ollama truncates without warning, so fail loudly before that can happen again
    if response.prompt_eval_count and response.prompt_eval_count >= NUM_CTX - CONTEXT_HEADROOM:
        raise ValueError(
            f"Prompt used {response.prompt_eval_count} of {NUM_CTX} context tokens; "
            "raise NUM_CTX so the start of the prompt isn't cut off."
        )

    return response


def llm_classify_transaction(
    merchant: str,
    amount: float,
    examples: list[dict],
) -> dict:
    """
    Classify a transaction and clean its merchant name using
    the local Qwen3 model running through Ollama.

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

    response = _chat_json(prompt)

    content = response.message.content

    try:
        classification = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Qwen returned invalid JSON: {content}"
        ) from exc

    # Validate required fields
    required_fields = {
        "merchant",
        "category",
        "confidence",
    }

    missing_fields = required_fields - classification.keys()

    if missing_fields:
        raise ValueError(
            f"Qwen response is missing fields: {missing_fields}"
        )

    # Validate merchant
    if not isinstance(classification["merchant"], str):
        raise ValueError(
            "Merchant must be a string."
        )

    # Validate category
    if not isinstance(classification["category"], str):
        raise ValueError(
            "Category must be a string."
        )

    # Validate confidence
    if not isinstance(classification["confidence"], (int, float)):
        raise ValueError(
            "Confidence must be a number."
        )

    if not 0 <= classification["confidence"] <= 1:
        raise ValueError(
            "Confidence must be between 0 and 1."
        )

    return classification


def llm_extract_calendar_event(event: dict) -> dict:
    prompt = prompts.build_calendar_event_extraction_prompt(event)

    response = _chat_json(prompt)

    content = response.message.content

    try:
        extraction = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Qwen returned invalid JSON: {content}"
        ) from exc

    # Validate required fields
    required_fields = {
        "budget",
        "category",
    }

    missing_fields = required_fields - extraction.keys()

    if missing_fields:
        raise ValueError(
            f"Qwen response is missing fields: {missing_fields}"
        )

    # Validate budget
    if extraction["budget"] is not None and not isinstance(extraction["budget"], (int, float)):
        raise ValueError(
            "Budget must be a number or null."
        )

    # Validate category
    if not isinstance(extraction["category"], str):
        raise ValueError(
            "Category must be a string."
        )

    # A missing or unrecognised sub-category is left for "To sort" rather than failing the event
    if extraction.get("sub_category") not in prompts.HOLIDAY_SUB_CATEGORIES:
        extraction["sub_category"] = None

    return extraction