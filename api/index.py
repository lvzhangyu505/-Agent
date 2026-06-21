#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vercel Python Function entrypoint."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web_app import Handler as handler  # noqa: E402
