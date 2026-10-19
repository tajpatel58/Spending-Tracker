import pandas as pd
from spending_tracker.classification.ollama import llm_classify_transaction
from prefect import flow, task, get_run_logger

@task
def transactions_apply_to_df(
    transactions_metadata_df: pd.DataFrame,
    examples: list[dict],
    force_llm: bool = False,
) -> pd.DataFrame:
    """
    Classify transactions in a DataFrame.

    Adds:
        llm_merchant
        llm_category
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
        )

        results.append(result)

    result_df = pd.DataFrame(results, index=transactions_metadata_df.index)

    # merge datasets on index to ensure alignment:
    transactions_metadata_with_category_df = pd.DataFrame.copy(transactions_metadata_df)
    transactions_metadata_with_category_df[["llm_merchant", "llm_category"]] = result_df[["merchant", "category"]]

    return transactions_metadata_with_category_df