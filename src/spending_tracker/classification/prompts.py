CATEGORIES = [
    "groceries",
    "dining",
    "transport",
    "housing",
    "holiday",
    "subscriptions",
    "shopping",
    "health",
    "birthday/gifts",
    "activities",
    "salary",
    "interest",
    "refund",
    "other",
]


def build_transaction_classification_prompt(
    merchant: str,
    amount: float,
    examples: list[dict],
) -> str:
    """
    Build the prompt used to classify and tidy a transaction.

    The historical examples are human-labelled and should be used
    primarily as guidance for category classification.

    Merchant tidying is based on the model's own knowledge. The model
    should only change the merchant when it is confident about the
    underlying business/merchant.
    """

    example_text = "\n".join(
        f"- {example['merchant']} | £{example['amount']:.2f} "
        f"-> {example['category']}"
        for example in examples
    )

    categories = "\n".join(
        f"- {category}"
        for category in CATEGORIES
    )

    prompt = f"""
                You are a personal finance transaction classifier and merchant cleaner.

                Your task is to:
                1. Classify the transaction into exactly ONE allowed category.
                2. Clean up the merchant name where you can confidently identify the
                underlying merchant or business.

                Allowed categories:
                {categories}


                ## CATEGORY CLASSIFICATION

                Use the human-labelled historical transactions below as examples.

                These examples have been manually classified and should be treated as
                reliable guidance when determining the category.

                Human-labelled examples:
                {example_text}

                Consider:
                - The merchant name
                - The transaction amount
                - Patterns in the human-labelled examples
                - The likely nature of the purchase

                Do not invent a category. The category MUST be one of the allowed
                categories above. 

                Also note that the amount being negative means its an expense, and positive means its an income.

                ## MERCHANT CLEANING

                The original merchant name may contain:
                - Store numbers
                - Location codes
                - Terminal IDs
                - Payment processor information
                - Extra reference numbers
                - Unnecessary abbreviations
                - Other bank-specific formatting

                Try to turn it into a clean, recognisable merchant/business name.

                For example:

                "TESCO STORES 0238" -> "Tesco"
                "AMZN MKTP UK*AB1234" -> "Amazon"
                "SPOTIFY P123456789" -> "Spotify"
                "UBER *TRIP" -> "Uber"

                You may use your own general knowledge to identify merchants.

                IMPORTANT:
                - Only change the merchant when you are reasonably confident that
                you know what the merchant is.
                - Do NOT guess.
                - Do NOT invent a business name.
                - Do NOT infer a specific merchant purely from the transaction amount.
                - If the merchant cannot be confidently identified, return the
                original merchant name unchanged.
                - Preserve the original merchant when in doubt.
                - Do not use the historical examples as labelled merchant data;
                they are provided for category classification only.
                - The cleaned merchant should normally be a short, human-readable
                business or merchant name.
                - Salary is likely to be a positive amount paid in and should be classified as "salary". 
                - Use "activities" for leisure activities and experiences, e.g. cinema,
                theatre, concerts, gigs, events, sports and activity bookings, museums,
                attractions and day trips.


                Transaction to classify:
                Merchant: {merchant}
                Amount: £{amount:.2f}


                Return JSON only in exactly this format:

                {{
                    "merchant": "cleaned merchant name or original merchant if unsure",
                    "category": "one of the allowed categories",
                }}

                The confidence value represents your confidence in the CATEGORY
                classification and must be a number between 0 and 1.

                Do not return any explanation or additional fields.
                """.strip()
    return prompt


def build_calendar_event_extraction_prompt(event: dict) -> str:
    categories = "\n".join(
    f"- {category}"
    for category in CATEGORIES
    )


    prompt = f"""You are extracting structured spending information from a Google Calendar event.
        Valid Categories:
        {categories}

        <event>
        <title>{event["title"]}</title>
        <description>{event["description"] or ""}</description>
        </event>

        Your task:
        1. Find the budget for this event. The budget is the amount of money planned or expected to be spent. It is usually in the description but may appear in the title. 
        - Return it as a plain number (e.g. 45.50), with no currency symbols or commas.
        - If a range is given (e.g. "£40-60"), use the upper value.
        - If several amounts are listed and labelled as a total, use the total. Otherwise, sum the amounts that clearly belong to this event.
        - If there is no budget, assume budget is £0. Do not guess or estimate one.
        2. Choose exactly one category from the <categories> list that best describes what the money is being spent on. 
        - You must use a category exactly as written in the list, with the same spelling and capitalisation.
        - Base the choice on what the event is, using both the title and description.
        - If nothing fits well, choose the closest match and set "confidence" to "low".

        Respond with only a JSON object, with no preamble, explanation, or markdown fences:
        {{"budget": <number>, "category": <string from the list>}}
        """
    return prompt