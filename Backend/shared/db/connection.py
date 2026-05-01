from pathlib import Path
import psycopg


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def _load_env_file():
    env = {}
    if not ENV_PATH.exists():
        return env
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def get_db_connection():
    env = _load_env_file()
    sslmode = "require" if env.get("DB_SSL", "false").lower() == "true" else "disable"
    return psycopg.connect(
        host=env.get("DB_HOST"),
        port=env.get("DB_PORT", "5432"),
        dbname=env.get("DB_NAME", "postgres"),
        user=env.get("DB_USER"),
        password=env.get("DB_PASSWORD"),
        sslmode=sslmode,
    )
