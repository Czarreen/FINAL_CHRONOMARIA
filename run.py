import argparse
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "Frontend"
BACKEND_DIR = ROOT / "Backend" / "node-api"

# Override these with env vars if needed.
DEFAULT_FRONTEND_CMD = "npm run dev"
DEFAULT_BACKEND_CMD = "npm run dev"


def stream_output(name: str, process: subprocess.Popen) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        print(f"[{name}] {line.rstrip()}")


def start_process(name: str, command: str, cwd: Path) -> subprocess.Popen:
    if not cwd.exists():
        raise FileNotFoundError(f"{name} directory not found: {cwd}")

    popen_kwargs = {
        "cwd": str(cwd),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
    }

    # On Windows, many dev commands (e.g. npm) are .cmd shims.
    # shell=True ensures they are resolved consistently.
    if os.name == "nt":
        return subprocess.Popen(command, shell=True, **popen_kwargs)

    return subprocess.Popen(shlex.split(command), shell=False, **popen_kwargs)


def terminate_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run backend and frontend dev servers together."
    )
    parser.add_argument(
        "--frontend-cmd",
        default=os.getenv("FRONTEND_DEV_CMD", DEFAULT_FRONTEND_CMD),
        help="Frontend command (default: npm run dev)",
    )
    parser.add_argument(
        "--backend-cmd",
        default=os.getenv("BACKEND_DEV_CMD", DEFAULT_BACKEND_CMD),
        help="Backend command (override with BACKEND_DEV_CMD)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands and exit without starting processes.",
    )
    args = parser.parse_args()

    if args.dry_run:
        print(f"Backend dir : {BACKEND_DIR}")
        print(f"Backend cmd : {args.backend_cmd}")
        print(f"Frontend dir: {FRONTEND_DIR}")
        print(f"Frontend cmd: {args.frontend_cmd}")
        return 0

    processes: list[subprocess.Popen] = []

    def shutdown(*_: object) -> None:
        print("\nShutting down dev servers...")
        for p in processes:
            terminate_process(p)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        backend = start_process("backend", args.backend_cmd, BACKEND_DIR)
        processes.append(backend)
    except Exception as exc:
        print(f"Failed to start backend command: {args.backend_cmd}")
        print(f"Reason: {exc}")
        return 1

    try:
        frontend = start_process("frontend", args.frontend_cmd, FRONTEND_DIR)
        processes.append(frontend)
    except Exception as exc:
        print(f"Failed to start frontend command: {args.frontend_cmd}")
        print(f"Reason: {exc}")
        terminate_process(backend)
        return 1

    threads = [
        threading.Thread(target=stream_output, args=("backend", backend), daemon=True),
        threading.Thread(target=stream_output, args=("frontend", frontend), daemon=True),
    ]
    for thread in threads:
        thread.start()

    while True:
        for name, proc in (("backend", backend), ("frontend", frontend)):
            code = proc.poll()
            if code is not None:
                print(f"{name} exited with code {code}. Stopping both servers.")
                shutdown()
        time.sleep(1)


if __name__ == "__main__":
    raise SystemExit(main())
