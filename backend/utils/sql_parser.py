import pandas as pd
import io
from typing import Optional


def parse_sql_export(content: bytes) -> list[dict]:
    """Parse SQL export from Excel file into list of row dicts"""
    df = pd.read_excel(io.BytesIO(content), sheet_name=0)
    # Convert NaN to None for cleaner JSON
    df = df.where(pd.notnull(df), None)
    return df.to_dict(orient="records")


def parse_sql_export_df(content: bytes) -> pd.DataFrame:
    """Parse SQL export and return DataFrame"""
    df = pd.read_excel(io.BytesIO(content), sheet_name=0)
    return df


def parse_insert_values(values_str: str) -> dict:
    """Parse VALUES(...) string from SQL INSERT statement"""
    fields = [
        "DATE", "LOTID", "PSA_TAPE_PIC",
        "POWER_BOARD_SN", "POWER_BOARD_SN_PIC",
        "POWER_BOARD_PRS", "POWER_BOARD_PRS_PIC", "POWER_BOARD_PSA_PIC",
        "BATTERY_SN", "BATTERY_SN_PIC",
        "BATTERY_PRS", "BATTERY_PRS_PIC", "BATTERY_PSA_PIC",
        "TEMP", "HUMIDITY"
    ]
    
    parts = []
    current = ""
    in_quotes = False
    
    for char in values_str:
        if char == "'" and not in_quotes:
            in_quotes = True
        elif char == "'" and in_quotes:
            in_quotes = False
        elif char == "," and not in_quotes:
            parts.append(current.strip().strip("'"))
            current = ""
        else:
            current += char
    parts.append(current.strip().strip("'"))
    
    return dict(zip(fields, parts))


def row_to_dict(row: pd.Series) -> dict:
    """Convert a DataFrame row to a clean dict"""
    d = row.to_dict()
    # Convert NaN/NaT to None
    for k, v in d.items():
        if pd.isna(v):
            d[k] = None
        elif hasattr(v, 'isoformat'):
            d[k] = v.isoformat()
    return d


def compare_rows(row1: dict, row2: dict, ignore_fields: list[str] = None) -> bool:
    """Check if two rows are effectively identical (ignoring ID)"""
    ignore = set(ignore_fields or ["ID"])
    for key in row1:
        if key in ignore:
            continue
        v1 = row1.get(key)
        v2 = row2.get(key)
        # Normalize None/NaN
        if pd.isna(v1):
            v1 = None
        if pd.isna(v2):
            v2 = None
        if v1 != v2:
            return False
    return True