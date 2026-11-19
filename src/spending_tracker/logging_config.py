"""
One place to configure logging for scripts (local runs and GitHub Actions alike).

Library modules just do `from loguru import logger` and call logger.info/debug/...;
scripts call `setup_logging(...)` once at the start to decide where logs go.

- Console: coloured, one line per event. Level from the LOG_LEVEL env var (default INFO).
- File (local only): logs/<run_name>_<timestamp>.log at DEBUG, so the full detail is
  kept even when the console is quieter. Skipped in CI, where the Actions log is the record.
  When the run ends, `finalise_log_file(status)` moves it into a folder for that status
  (logs/completed, logs/dry_run, logs/aborted, logs/failed) and keeps the newest
  _LOGS_KEPT_PER_STATUS there. A crash (uncaught exception) is logged and filed as failed.
- `log_run_summary` prints an aligned metrics table and, on GitHub Actions, also writes
  it as Markdown to the run's Summary page.
"""
import atexit
import os
import sys
from datetime import datetime
from pathlib import Path
from loguru import logger

_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_LOGS_KEPT_PER_STATUS = 10  # newest run logs kept in each status folder

# The current run's log file, so finalise_log_file can close and move it.
_file_handler_id: int | None = None
_log_path: Path | None = None
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
    global _file_handler_id, _log_path
    logger.remove()
    logger.add(
        sys.stderr,
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format=_CONSOLE_FORMAT,
        colorize=True,  # GitHub's log viewer renders ANSI colours too
    )
    # Uncaught errors go through loguru, so the traceback is in the log file too
    sys.excepthook = lambda exc_type, exc, tb: logger.opt(exception=(exc_type, exc, tb)).critical("Run failed")

    if not in_github_actions():
        _log_path = _LOG_DIR / f"{run_name}_{datetime.now():%Y-%m-%d_%H-%M-%S}.log"
        _file_handler_id = logger.add(_log_path, level="DEBUG", format=_FILE_FORMAT)
        # If the script ends without calling finalise_log_file (i.e. it crashed), file it as failed
        atexit.register(finalise_log_file, "failed")


def _status_folder(status: str) -> str:
    """'completed (no new transactions)' -> completed, 'dry run' -> dry_run, 'aborted: ...' -> aborted."""
    for prefix, folder in (("completed", "completed"), ("dry run", "dry_run"), ("aborted", "aborted")):
        if status.startswith(prefix):
            return folder
    return "failed"


def finalise_log_file(status: str) -> Path | None:
    """Close this run's log file and move it to logs/<status folder>/, keeping the newest
    _LOGS_KEPT_PER_STATUS there. Safe to call more than once; only the first call acts."""
    global _file_handler_id, _log_path
    if _file_handler_id is None or _log_path is None:
        return None  # no file logging (CI), or already finalised

    logger.remove(_file_handler_id)  # closes the file so it can be moved
    folder = _LOG_DIR / _status_folder(status)
    folder.mkdir(parents=True, exist_ok=True)
    destination = _log_path.replace(folder / _log_path.name)
    _file_handler_id = _log_path = None

    # retention per status folder: names are timestamped, so sorting puts the oldest first
    run_prefix = destination.name.rsplit("_", 2)[0]
    old_logs = sorted(folder.glob(f"{run_prefix}_*.log"))[:-_LOGS_KEPT_PER_STATUS]
    for old_log in old_logs:
        old_log.unlink()

    logger.info(f"Log saved to {destination.relative_to(_LOG_DIR.parent)}")
    return destination


def log_run_summary(title: str, sections: dict[str, dict], depth: int = 1) -> None:
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
    # depth: how many frames up to report as the source, so the log shows the calling script
    logger.opt(depth=depth).info("\n" + "\n".join(lines))

    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        md = [f"## {title}"]
        for section, rows in sections.items():
            md += [f"### {section}", "| Metric | Value |", "| --- | --- |"]
            md += [f"| {key} | {value} |" for key, value in rows.items()]
        with open(summary_path, "a") as f:
            f.write("\n".join(md) + "\n")


def log_pipeline_summary(
    status: str,
    *,
    llm_model: str,
    from_date: str,
    labelled_examples_count: int,
    duration_seconds: float,
    account_metrics: dict[str, str],
    llm_estimate: dict,
    max_llm_cost_usd: float,
    llm_usage: dict,
    llm_cost: float | None,
    upload_metrics: dict[str, str],
) -> None:
    """
    The daily pipeline's end-of-run table, built from its metrics and passed to log_run_summary.
    `llm_estimate` is classify.estimate_llm_run's dict ({} if the run stopped before the pre-flight);
    `llm_cost` is None for local models.
    """
    sections = {
        "Run": {
            "Status": status,
            "LLM model": llm_model,
            "Transactions from": from_date,
            "Labelled examples": labelled_examples_count,
            "Duration": f"{duration_seconds:.1f}s",
        },
        "Accounts": account_metrics or {"(none)": "no accounts mapped"},
    }
    if llm_estimate:
        sections["LLM estimate (pre-flight)"] = {
            "calls": f"{llm_estimate['calls']:,}",
            "input_tokens (counted)": f"{llm_estimate['input_tokens']:,}",
            "output_tokens (typical)": f"{llm_estimate['est_output_tokens']:,}",
            "est. cost": f"${llm_estimate['est_cost']:.4f}",
            "worst case": f"${llm_estimate['worst_case_cost']:.4f}",
            "budget": f"${max_llm_cost_usd:.4f}",
        }
    # Per-call averages over the whole run (calibrate TYPICAL_OUTPUT_TOKENS from the output one)
    calls = llm_usage["calls"]
    sections["LLM usage (actual)"] = {
        **{key: f"{value:,}" for key, value in llm_usage.items()},
        "input tokens per call": f"{llm_usage['input_tokens'] / calls:,.0f}" if calls else "n/a (no calls)",
        "output tokens per call": f"{llm_usage['output_tokens'] / calls:,.0f}" if calls else "n/a (no calls)",
        "cost": f"${llm_cost:.4f}" if llm_cost is not None else "n/a (local)",
        "cost per request": (f"${llm_cost / calls:.6f}" if calls else "n/a (no calls)")
                            if llm_cost is not None else "n/a (local)",
    }
    sections["Supabase upserts"] = upload_metrics or {"(none)": "nothing uploaded"}
    log_run_summary("Daily pipeline summary", sections, depth=2)
