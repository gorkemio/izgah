# Security Policy

## Supported versions

Security fixes are made on the latest release and the `main` branch.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository ("Security" tab → "Report a vulnerability"). Include:

- what an attacker can do and under which conditions,
- steps or a proof of concept to reproduce it,
- the affected version or commit.

You can expect an acknowledgement within a few days. Once a fix is released we will credit you in the advisory unless you prefer otherwise.

## Scope notes for self-hosters

Izgah is designed to run behind a reverse proxy that terminates HTTPS. Keep `ORIGIN` set to your public HTTPS address, bind the app port to localhost (as `docker-compose.prod.yml` does), and keep `ADDRESS_HEADER` / `XFF_DEPTH` in line with your proxy setup so per-IP rate limits cannot be bypassed.
