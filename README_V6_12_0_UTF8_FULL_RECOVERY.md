# HukaTech Platform v6.12.0 UTF-8 Full Recovery

## Problem

A previous Windows PowerShell script read UTF-8 HTML files with the legacy
system code page and wrote the incorrectly decoded text back as UTF-8.
This corrupted Turkish characters across admin.html, login.html, and
reset-password.html.

## Recovery

- Restores the clean backups created immediately before the faulty version fix.
- Preserves the current corrupted files as timestamped safety copies.
- Reads and writes all HTML explicitly as UTF-8 without BOM.
- Applies only the v6.12.0 initial/fallback version updates.
- Uses ASCII-safe HTML entities for the new Turkish version labels.
- Updates development and production copies.
- Rebuilds Backend and Nginx.
- Verifies health, UTF-8 metadata, version title, and common mojibake markers.

This package contains no password, API key, Cloudflare token, tunnel credential,
or production environment file.
