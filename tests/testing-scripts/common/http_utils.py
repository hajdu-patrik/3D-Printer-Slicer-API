from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Mapping


def parse_curl_output(output: str) -> tuple[int, dict | str | None]:
    if "HTTP_STATUS:" in output:
        body_text, status_text = output.rsplit("HTTP_STATUS:", 1)
        status = int((status_text or "").strip() or "0")
        body_text = body_text.strip()
    else:
        status = 0
        body_text = output.strip()

    if not body_text:
        return status, None

    try:
        return status, json.loads(body_text)
    except json.JSONDecodeError:
        return status, body_text


def curl_json(
    *,
    method: str,
    base_url: str,
    endpoint: str,
    json_body: dict | None = None,
    api_key: str | None = None,
) -> tuple[int, dict | str | None]:
    cmd = [
        "curl",
        "-sS",
        "-X",
        method,
        f"{base_url}{endpoint}",
        "-w",
        "\nHTTP_STATUS:%{http_code}\n",
    ]

    if json_body is not None:
        cmd.extend(["-H", "Content-Type: application/json", "--data", json.dumps(json_body)])

    if api_key:
        cmd.extend(["-H", f"x-api-key: {api_key}"])

    completed = subprocess.run(cmd, capture_output=True, text=True)
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip() or "curl request failed"
        return 0, {"error": stderr}

    return parse_curl_output(completed.stdout.strip())


def curl_multipart_slice(
    *,
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    extra_fields: Mapping[str, str | int | float | bool] | None = None,
) -> tuple[int, dict | str | None, float]:
    cmd = [
        "curl",
        "-sS",
        "-X",
        "POST",
        f"{base_url}{endpoint}",
        "-F",
        f"choosenFile=@{file_path}",
        "-F",
        f"layerHeight={layer_height}",
        "-F",
        f"material={material}",
    ]

    if extra_fields:
        for key, value in extra_fields.items():
            if isinstance(value, bool):
                normalized = "true" if value else "false"
            else:
                normalized = str(value)
            cmd.extend(["-F", f"{key}={normalized}"])

    cmd.extend([
        "-w",
        "\nHTTP_STATUS:%{http_code}\n",
    ])

    import time

    started = time.perf_counter()
    completed = subprocess.run(cmd, capture_output=True, text=True)
    duration = time.perf_counter() - started

    status, body = parse_curl_output(completed.stdout.strip())
    return status, body, duration
