import pandas as pd
import pdfplumber
from pathlib import Path

def pdf_to_dataframe(pdf_path: str, 
                     columns: list = None,
                     csv_path: str = None) -> pd.DataFrame:
    rows = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            table = page.extract_table()

            if table:
                rows.extend(table)

    if not rows:
        raise ValueError("No tables found in PDF")

    # First row is assumed to be the header
    df = pd.DataFrame(rows, columns=columns)
    if csv_path is not None:
        df.to_csv(csv_path, index=False)

    return df


def find_raw_transaction_partitions(
    raw_transactions_root: Path,
) -> list[tuple[str, str, str, str, str]]:
    """Return (user, bank, account_id, month, extension) for each statement."""
    statements = []

    for statement_path in sorted(raw_transactions_root.rglob("statement.*")):
        relative_parts = statement_path.relative_to(raw_transactions_root).parts
        print(relative_parts)
        if len(relative_parts) != 5:
            raise ValueError(
                "Expected raw files at "
                "<user>/<bank>/<account_id>/<month>/statement.*, "
                f"but found: {statement_path}"
            )

        user, bank, account_id, month, filename = relative_parts
        statements.append((user, bank, account_id, month, filename))

    return statements