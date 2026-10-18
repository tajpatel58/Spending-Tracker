CATEGORIES = [
    "groceries",
    "dining",
    "transport",
    "housing",
    "holiday",
    "subscriptions",
    "fixed_expense",
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
    Build the prompt used to tidy a transaction's merchant name and categorise it.

    The merchant is tidied, not rewritten: payment-method noise and reference
    codes are removed, well-known abbreviations are expanded (TFL -> Transport
    for London) and transfers are labelled as such. Past categorised examples
    are only used when they match the same merchant.
    """

    # dedupe so repeated transactions at the same merchant don't flood the prompt
    unique_examples = {}
    for example in examples:
        unique_examples.setdefault((example["merchant"], example["category"]), example["amount"])

    example_text = "\n".join(
        f"- {example_merchant} | £{example_amount:.2f} -> {category}"
        for (example_merchant, category), example_amount in unique_examples.items()
    ) or "- (none)"

    categories = ", ".join(CATEGORIES)

    prompt = f"""
You tidy up and categorise UK bank transactions. Amounts are in GBP: negative = money going out, positive = money coming in.

For the transaction at the end, return:
- merchant: a short, readable name for WHERE the money went (the shop, business or person), as the user would say it.
- category: exactly one of: {categories}
- confidence: how sure you are of the category, 0.0 to 1.0.


## The user's past transactions (raw text | amount -> category)

If the transaction is the SAME merchant as one of these, use that category. Ignore unrelated merchants.
{example_text}


## Tidying the merchant

1. Remove noise only: payment-method words (Contactless, Contactless payment, Apple Pay, APPLEPAY, Google Pay, Card payment, POS, Direct debit, DD), store and reference numbers, codes, dates, payment prefixes ("SQ *", "SUMUP *", "PAYPAL *", "Stripe Re"), town names, "GB", "LTD", "PLC", web addresses.
2. Keep every word that says what the place is ("Climbing Centre", "Petrol", "Coffee House"). If unsure whether a word is noise, keep it.
3. Expand known abbreviations and cut-off words: TFL -> Transport for London, WM MORRISONS -> Morrisons, SAINSBURYS S/MKT -> Sainsbury's, AMZN MKTP -> Amazon, AMERICAN EXP -> American Express, "Cent" -> "Centre".
4. Use Title Case, or the brand's own styling (McDonald's, IKEA, PureGym, M&S).
5. Transfers: if money is going to or from a person or another account rather than a business (text starts with "To", "From", "FPI", "FPO", "BGC", "SO", "Transfer", or is just a person's name), write "Transfer to <name>" (negative amount) or "Transfer from <name>" (positive amount). Keep a meaningful reference word in brackets.
6. Never invent a business you don't recognise and never return an empty name.


## Choosing the category

- groceries: supermarkets (Tesco, Sainsbury's, Asda, Aldi, Lidl, Morrisons, Waitrose, M&S Food, Co-op, Iceland, Ocado). Supermarkets are groceries, never shopping.
- dining: restaurants, cafes, coffee shops, bakeries (Greggs), pubs, bars, takeaways, Deliveroo, Uber Eats.
- transport: Transport for London, trains, buses, Uber, taxis, fuel, parking.
- housing: rent, mortgage, council tax, energy (Octopus, British Gas), water, home repairs, furniture.
- subscriptions: streaming, music, apps, software, mobile phone, broadband, gyms, Amazon Prime.
- holiday: flights, hotels, Airbnb, travel bookings, spending abroad.
- shopping: clothes, electronics, homeware, Amazon, general retail.
- health: pharmacies (Boots), doctors, dentists, opticians.
- birthday/gifts: gifts, flowers, cards.
- activities: cinema, theatre, gigs, climbing and sports sessions, attractions, tickets.
- salary: wages paid in by an employer (positive amounts only).
- interest: interest paid in by a bank (positive amounts only).
- refund: money returned by a shop or service (positive amounts only).
- fixed_expense: ONLY when a past transaction above for the same kind of merchant is fixed_expense.
- other: LAST RESORT only: plain transfers with no stated purpose, credit card repayments, cash withdrawals and bank fees.

Always prefer a real category over other. If you don't recognise the merchant, make your best guess from the name (e.g. a name that sounds like a restaurant -> dining) and give it a low confidence instead of choosing other. Insurance goes with what it covers (car -> transport, home -> housing, travel -> holiday, pet or health -> health). A transfer whose reference says what it was for takes that category (e.g. "(Dinner)" -> dining, "(Rent)" -> housing).

Check the sign first: a POSITIVE amount from a shop or service (e.g. Amazon, Tesco) is a refund, not the shop's usual category. Never use salary, interest or refund for a negative amount.

Use your knowledge of UK businesses and keywords in the text (GYM, CAFE, BAKERY, PHARMACY, PARKING, HOTEL, TICKETS). A recognised business or clear keyword deserves confidence 0.9 or more; use below 0.5 only when guessing. Only use the categories listed, never make up a new one.


## Examples

"TESCO STORE 5620 5620TE LONDON" | -3.85 -> {{"merchant": "Tesco", "category": "groceries", "confidence": 0.95}}
"WM MORRISONS STORES - Q LONDON" | -5.00 -> {{"merchant": "Morrisons", "category": "groceries", "confidence": 0.95}}
"TFL TRAVEL CH" | -2.80 -> {{"merchant": "Transport for London", "category": "transport", "confidence": 0.95}}
"APPLEPAY 6855 GREGGS" | -1.00 -> {{"merchant": "Greggs", "category": "dining", "confidence": 0.95}}
"Lakeland Climbing Cent" | -13.00 -> {{"merchant": "Lakeland Climbing Centre", "category": "activities", "confidence": 0.9}}
"OCTOPUS ENERGY LTD DD" | -85.00 -> {{"merchant": "Octopus Energy", "category": "housing", "confidence": 0.9}}
"AMZN MKTP UK*AB1234" | 17.99 -> {{"merchant": "Amazon", "category": "refund", "confidence": 0.9}}
"Interest earned" | 19.16 -> {{"merchant": "Interest Earned", "category": "interest", "confidence": 0.95}}
"To AMERICAN EXP 3773 - PB860096750797074" | -808.07 -> {{"merchant": "Transfer to American Express", "category": "other", "confidence": 0.9}}
"FPI J SMITH REF RENT" | 450.00 -> {{"merchant": "Transfer from J Smith (Rent)", "category": "housing", "confidence": 0.7}}
"FPO K JONES" | -20.00 -> {{"merchant": "Transfer to K Jones", "category": "other", "confidence": 0.6}}
"SQ *MARIAS KITCHEN 4471XK2" | -9.50 -> {{"merchant": "Marias Kitchen", "category": "dining", "confidence": 0.9}}


## Transaction

"{merchant}" | {amount:.2f} ->

Return JSON only, no explanation: {{"merchant": "...", "category": "...", "confidence": 0.0}}
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
