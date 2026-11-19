import atexit
import os
import sys
from datetime import datetime
from pathlib import Path
from loguru import logger
from spending_tracker.database import supabase_client

_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_LOGS_KEPT_PER_STATUS = 10  # newest run logs kept in each status folder (local and in Supabase)
_LOG_BUCKET = "pipeline-logs"  # private Supabase Storage bucket for GitHub runs' logs

# The current run's log file, so finalise_log_file can close, move and upload it.
_file_handler_id: int | None = None
_log_path: Path | None = None
_CONSOLE_FORMAT = (
    "<green>{time:HH:mm:ss}</green> | "
    "<level>{level: <7}</level> | "
    "<cyan>{module: <12}</cyan> | "
    "<level>{message}</level>"
)
_FILE_FORMAT = "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <7} | {name}:{function}:{line} | {message}"


def on_github_actions() -> bool:
    return os.getenv("GITHUB_ACTIONS") == "true"


def _is_public(record) -> bool:
    return record["extra"].get("public", False)


def _log_uncaught_exception(exc_type, exc, tb) -> None:
    """sys.excepthook: full traceback to the log file; on GitHub only the error type is shown."""
    logger.opt(exception=(exc_type, exc, tb)).critical("Run failed")
    if on_github_actions():
        logger.bind(public=True).critical(
            f"Run failed ({exc_type.__name__}) - full traceback in the run's log in Supabase")


def setup_logging(run_name: str = "run") -> None:
    """Replace loguru's default handler with our console + file handlers."""
    global _file_handler_id, _log_path
    logger.remove()
    logger.add(
        sys.stderr,
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format=_CONSOLE_FORMAT,
        colorize=True,  # GitHub's log viewer renders ANSI colours too
        filter=_is_public if on_github_actions() else None,  # public repo: safe lines only
    )
    # Uncaught errors go through loguru, so the traceback is in the log file too
    sys.excepthook = _log_uncaught_exception

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


def _run_prefix(log_name: str) -> str:
    """'daily_pipeline_2026-11-19_11-24-37.log' -> 'daily_pipeline' (drops the date + time parts)."""
    return log_name.rsplit("_", 2)[0]


def _upload_log_to_supabase(log_file: Path, folder: str) -> str:
    """Upload to <bucket>/<folder>/<file>, then keep the newest _LOGS_KEPT_PER_STATUS for this
    run name in that folder. Returns the stored path."""

    bucket = supabase_client.load_bucket(_LOG_BUCKET)
    remote_path = f"{folder}/{log_file.name}"
    bucket.upload(remote_path, log_file.read_bytes(), {"content-type": "text/plain; charset=utf-8"})

    prefix = _run_prefix(log_file.name)
    stored = sorted(name for name in supabase_client.list_files(folder, bucket)
                    if name.startswith(prefix + "_"))
    old_logs = stored[:-_LOGS_KEPT_PER_STATUS]
    if old_logs:
        bucket.remove([f"{folder}/{name}" for name in old_logs])
    return remote_path


def finalise_log_file(status: str) -> Path | None:
    """Close this run's log file, move it to logs/<status folder>/ (keeping the newest
    _LOGS_KEPT_PER_STATUS there) and, on GitHub Actions, upload it to Supabase.
    Safe to call more than once; only the first call acts."""
    global _file_handler_id, _log_path
    if _file_handler_id is None or _log_path is None:
        return None  # already finalised

    logger.remove(_file_handler_id)  # closes the file so it can be moved
    folder_name = _status_folder(status)
    folder = _LOG_DIR / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    destination = _log_path.replace(folder / _log_path.name)
    _file_handler_id = _log_path = None

    # retention per status folder: names are timestamped, so sorting puts the oldest first
    old_logs = sorted(folder.glob(f"{_run_prefix(destination.name)}_*.log"))[:-_LOGS_KEPT_PER_STATUS]
    for old_log in old_logs:
        old_log.unlink()

    if not on_github_actions():
        logger.info(f"Log saved to {destination.relative_to(_LOG_DIR.parent)}")
        return destination

    # On GitHub the runner is thrown away, so Supabase is where the log lives.
    # A failed upload must never change the run's outcome or hide the original error.
    try:
        remote_path = _upload_log_to_supabase(destination, folder_name)
        logger.bind(public=True).info(f"Log saved to Supabase: {_LOG_BUCKET}/{remote_path}")
    except Exception as exc:  # noqa: BLE001 - deliberately broad: logging must not crash the run
        logger.bind(public=True).warning(
            f"Couldn't upload the log to Supabase ({type(exc).__name__}); this run's full log is lost")
    return destination


def log_run_summary(title: str, sections: dict[str, dict], depth: int = 1, public: bool = False) -> None:
    """
    Log a readable table of run metrics, e.g.
        {"Accounts": {"Starling": "12 fetched, 10 kept"}, "LLM usage": {"calls": 3, ...}}
    public=True shows it in the GitHub console and writes it to the run's Summary page,
    so only pass sections that are safe to publish.
    """
    width = max((len(key) for rows in sections.values() for key in rows), default=0)
    lines = [f"── {title} " + "─" * max(0, 50 - len(title))]
    for section, rows in sections.items():
        lines.append(f"  {section}")
        lines.extend(f"    {key:<{width}}  {value}" for key, value in rows.items())
    # depth: how many frames up to report as the source, so the log shows the calling script
    logger.opt(depth=depth).bind(public=public).info("\n" + "\n".join(lines))

    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if public and summary_path:
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
    totals: dict[str, int],
    llm_estimate: dict,
    max_llm_cost_usd: float,
    llm_usage: dict,
    llm_cost: float | None,
    upload_metrics: dict[str, str],
) -> None:
    """
    The daily pipeline's end-of-run table, built from its metrics and passed to log_run_summary.
    `totals` holds the run-wide counts (accounts, accounts_with_transactions, fetched, kept).
    `llm_estimate` is classify.estimate_llm_run's dict ({} if the run stopped before the pre-flight);
    `llm_cost` is None for local models.

    Locally: one full table. On GitHub: the full table (per-account lines) goes to the log
    file only, and a totals-only table goes to the console and the run's Summary page.
    """
    run = {
        "Status": status,
        "LLM model": llm_model,
        "Transactions from": from_date,
        "Labelled examples": labelled_examples_count,
        "Duration": f"{duration_seconds:.1f}s",
    }
    run_totals = {
        "Accounts": f"{totals['accounts']} ({totals['accounts_with_transactions']} with new transactions)",
        "Transactions fetched": f"{totals['fetched']:,}",
        "Transactions kept (settled)": f"{totals['kept']:,}",
    }
    estimate = {}
    if llm_estimate:
        estimate = {
            "calls": f"{llm_estimate['calls']:,}",
            "input_tokens (counted)": f"{llm_estimate['input_tokens']:,}",
            "output_tokens (typical)": f"{llm_estimate['est_output_tokens']:,}",
            "est. cost": f"${llm_estimate['est_cost']:.4f}",
            "worst case": f"${llm_estimate['worst_case_cost']:.4f}",
            "budget": f"${max_llm_cost_usd:.4f}",
        }
    # Per-call averages over the whole run (calibrate TYPICAL_OUTPUT_TOKENS from the output one)
    calls = llm_usage["calls"]
    usage = {
        **{key: f"{value:,}" for key, value in llm_usage.items()},
        "input tokens per call": f"{llm_usage['input_tokens'] / calls:,.0f}" if calls else "n/a (no calls)",
        "output tokens per call": f"{llm_usage['output_tokens'] / calls:,.0f}" if calls else "n/a (no calls)",
        "cost": f"${llm_cost:.4f}" if llm_cost is not None else "n/a (local)",
        "cost per request": (f"${llm_cost / calls:.6f}" if calls else "n/a (no calls)")
                            if llm_cost is not None else "n/a (local)",
    }
    upserts = upload_metrics or {"(none)": "nothing uploaded"}

    def build(include_accounts: bool) -> dict:
        sections = {"Run": run, "Totals": run_totals}
        if include_accounts:
            sections["Accounts"] = account_metrics or {"(none)": "no accounts mapped"}
        if estimate:
            sections["LLM estimate (pre-flight)"] = estimate
        sections["LLM usage (actual)"] = usage
        sections["Supabase upserts"] = upserts
        return sections

    if on_github_actions():
        log_run_summary("Daily pipeline summary", build(include_accounts=True), depth=2)  # file only
        log_run_summary("Daily pipeline summary", build(include_accounts=False), depth=2, public=True)
    else:
        log_run_summary("Daily pipeline summary", build(include_accounts=True), depth=2)
