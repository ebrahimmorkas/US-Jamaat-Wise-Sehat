"""Create a copy of the tracker with dummy dropdown values, ready to import into Google Sheets.

Usage: python tools/make_dummy.py <source.xlsx> <output.xlsx>

- Fills dropdown columns E..M of every Jamiat sheet with random allowed values.
- Fills a few dummy remarks in column N.
- Removes 'Sheet1' (it contains names / mobile numbers and must not be in a link-shared sheet).
"""
import random
import sys

import openpyxl

SKIP_SHEETS = {"SAHEBO DASHBOARD", "Sheet1"}
STATUS_COLS = {  # column letter -> (values, weights)
    "E": (["Completed", "Pending", "In Progress", "Not Applicable"], [50, 25, 15, 10]),
    "F": (["Completed", "Pending", "In Progress", "Not Applicable"], [50, 25, 15, 10]),
    "G": (["Completed", "Pending", "In Progress", "Not Applicable"], [50, 25, 15, 10]),
    "M": (["Completed", "Pending", "In Progress", "Not Applicable"], [50, 25, 15, 10]),
    "H": (["Yes", "No", "Pending", "Not Applicable"], [50, 15, 25, 10]),
    "I": (["Yes", "No", "Pending", "Not Applicable"], [50, 15, 25, 10]),
    "J": (["Yes", "No", "Pending", "Not Applicable"], [50, 15, 25, 10]),
    "K": (["Yes", "No", "Pending", "Not Applicable"], [50, 15, 25, 10]),
    "L": (["Yes", "No", "Pending", "Not Applicable"], [50, 15, 25, 10]),
}
REMARKS = [
    "Follow up next week",
    "Awaiting reply from coordinator",
    "Visit scheduled",
    "Documents pending",
    "Call again on Friday",
]
FIRST_DATA_ROW = 6


def main(src, dst):
    random.seed(42)
    wb = openpyxl.load_workbook(src)
    if "Sheet1" in wb.sheetnames:
        del wb["Sheet1"]

    for ws in wb.worksheets:
        if ws.title in SKIP_SHEETS:
            continue
        row = FIRST_DATA_ROW
        while ws[f"A{row}"].value not in (None, ""):
            for col, (values, weights) in STATUS_COLS.items():
                ws[f"{col}{row}"] = random.choices(values, weights)[0]
            if random.random() < 0.2:
                ws[f"N{row}"] = random.choice(REMARKS)
            row += 1
        print(f"{ws.title}: {row - FIRST_DATA_ROW} jamaats filled")

    wb.save(dst)
    print("Saved", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
