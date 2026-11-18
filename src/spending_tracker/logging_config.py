"""
One place to configure logging for scripts (local runs and GitHub Actions alike).

Library modules just do `from loguru import logger` and call logger.info/debug/...;
scripts call `setup_logging(...)` once at the start to decide where logs go.

- Console: coloured, one line per event. Level from the LOG_LEVEL env var (default INFO).
- File (local only): logs/<run_name>_<timestamp>.log at DEBUG, so the full detail is
  kept even when the console is quieter. Skipped in CI, where the Actions log is the record.
- `log_run_summary` prints an aligned metrics table and, on GitHub Actions, also writes
  it as Markdown to the run's Summary page.
"""
import os
import sys
from pathlib import Path
from loguru import logger

_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_CONSOLE_FORMAT = (
    "<green>{time:HH:mm:ss}</green> | "
    "<level>{level: <7}</level> | "
    "<cyan>{module: <12}</cyan> | "
    "<level>{message}</level>"
)
_FILE_FORMAT = "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <7} | {name}:{function}:{line} | {message}"


def in_github_actions() -> bool:
    return os.getenv("GITHUB_ACTIONS") == "true"


def setup_logging(run_name: str = "run") -> None:
    """Replace loguru's default handler with our console (+ local file) handlers."""
    logger.remove()
    logger.add(
        sys.stderr,
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format=_CONSOLE_FORMAT,
        colorize=True,  # GitHub's log viewer renders ANSI colours too
    )
    if not in_github_actions():
        logger.add(
            _LOG_DIR / f"{run_name}_{{time:YYYY-MM-DD_HH-mm-ss}}.log",
            level="DEBUG",
            format=_FILE_FORMAT,
            retention=30,  # keep the 30 most recent run logs
        )


def log_run_summary(title: str, sections: dict[str, dict]) -> None:
    """
    Log a readable table of run metrics, e.g.
        {"Accounts": {"Starling": "12 fetched, 10 kept"}, "LLM usage": {"calls": 3, ...}}
    On GitHub Actions, also append it to the job summary as Markdown tables.
    """
    width = max((len(key) for rows in sections.values() for key in rows), default=0)
    lines = [f"── {title} " + "─" * max(0, 50 - len(title))]
    for section, rows in sections.items():
        lines.append(f"  {section}")
        lines.extend(f"    {key:<{width}}  {value}" for key, value in rows.items())
    logger.opt(depth=1).info("\n" + "\n".join(lines))  # depth=1: show the calling script as the source

    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        md = [f"## {title}"]
        for section, rows in sections.items():
            md += [f"### {section}", "| Metric | Value |", "| --- | --- |"]
            md += [f"| {key} | {value} |" for key, value in rows.items()]
        with open(summary_path, "a") as f:
            f.write("\n".join(md) + "\n")
