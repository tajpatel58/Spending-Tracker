import pandas as pd
import pdfplumber
from pathlib import Path


def parse_pdf_to_dataframe(pdf_path: str, 
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

def chase_pdf_to_dataframe(pdf_path: str, csv_path: str = None) -> pd.DataFrame:
    columns = ["date", "transaction_details", "amount", "balance"]
    return parse_pdf_to_dataframe(pdf_path, columns=columns, csv_path=csv_path)