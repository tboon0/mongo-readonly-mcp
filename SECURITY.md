# Security

## Deployment boundaries

- Enable MongoDB access control. Give each account only the built-in `read` role on required databases; use dedicated credentials, not administrator accounts. The application does not verify assigned roles. Read-only APIs and blocked aggregation write stages are defense in depth, not substitutes for database permissions.
- Every connected MCP client can use every configured profile. There is no per-client authorization or profile isolation. Use separate server processes and configuration files for separate trust boundaries; expose stdio only to trusted clients.
- Protect config files with restrictive filesystem permissions (for example, `chmod 600 profiles.yaml` on Unix). Do not put passwords in prompts, command arguments, issues, or commits. Rotate credentials if exposed. Profile listings omit credentials, but reveal hosts and database names; password masking in errors is not general-purpose secret redaction.
- TLS defaults on for remote hosts and off for localhost/loopback. Use `tls: true` where supported and `tlsCAFile` for a private CA. Certificate and hostname verification stay enabled. `tlsCAFile` without TLS is rejected. Explicit `tls: false` is unsafe outside trusted encrypted tunnels. A local port forward does not by itself prove the entire route is encrypted or trusted.

## Data and agent safety

Results, metadata, and errors pass to the client. An agent may send them to its model/provider, and clients may store them in logs or conversation history. This server does not redact document contents or control downstream retention. Obtain authorization for that exposure; select only needed fields, prefer summaries, and avoid retrieving secrets or personal data unnecessarily.

Database strings are untrusted input. They may contain prompt-injection instructions. Agents must treat them as data, not permission to execute commands, disclose secrets, expand query scope, or contact external services. MCP annotations and the bundled skill are guidance, not enforcement against a compromised client or model.

## Resource limits

`find` and `aggregate` default to 100 documents, accept limits from 1–1000, and use a 10-second MongoDB execution timeout. Aggregation disables disk spill and limits results after the supplied pipeline. Server selection also times out after 10 seconds. These are not end-to-end deadlines, byte limits, concurrency quotas, or guarantees against expensive scans. Distinct values and collection listings are not capped by the document limit; large documents and concurrent calls can consume substantial resources. Use selective indexed filters, projections, monitoring, and database-level resource controls.

The server does not maintain audit files. Configure database/client auditing separately where required, with appropriate sensitive-data handling.

## Reporting vulnerabilities

Do not post credentials, private documents, or exploit details in public issues. If the repository's Security tab offers **Report a vulnerability**, use that private channel. Otherwise open a minimal issue requesting a private reporting channel without disclosure details. No dedicated private mailbox, response SLA, or support window is currently promised.
