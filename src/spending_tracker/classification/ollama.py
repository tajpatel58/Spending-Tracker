
import json
from ollama import chat
from spending_tracker.classification.prompts import build_classification_prompt


MODEL = "qwen3:8b"


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

    prompt = build_classification_prompt(
        merchant=merchant,
        amount=amount,
        examples=examples,
    )

    response = chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        format="json",
        think=False
    )

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