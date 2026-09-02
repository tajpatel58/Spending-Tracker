import pandas as pd
from spending_tracker.classification.ollama import llm_classify_transaction


def apply_to_df(
    transactions_metadata_df: pd.DataFrame,
    examples: list[dict],
) -> pd.DataFrame:
    """
    Classify transactions in a DataFrame.

    Adds:
        llm_merchant
        llm_category
        llm_confidence
    """

    results = []

    merchant_to_category = {example["merchant"]: example["category"] for example in examples}

    for row in transactions_metadata_df.itertuples(index=False):
        if row.merchant in merchant_to_category:
            # Use the pre-classified category
            results.append({
                "merchant": row.merchant,
                "category": merchant_to_category[row.merchant],
            })
            continue

        result = llm_classify_transaction(
            merchant=row.merchant,
            amount=row.amount,
            examples=examples,
        )

        results.append(result)

    result_df = pd.DataFrame(results, index=transactions_metadata_df.index)

    # merge datasets on index to ensure alignment:
    transactions_metadata_with_category_df = pd.DataFrame.copy(transactions_metadata_df)
    transactions_metadata_with_category_df[["llm_merchant", "llm_category"]] = result_df[["merchant", "category"]]

    return transactions_metadata_with_category_df