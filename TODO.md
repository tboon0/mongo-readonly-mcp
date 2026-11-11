# TODO

- [ ] Verify deployed read-only credentials on every configured MongoDB instance. Exercise profile listing, collection listing, and bounded reads through CLI and MCP; do not test writes against production.
- [x] Publish version 0.1.0 and verify its registry integrity, installed CLI, and MCP tool discovery.
- [x] Verify remote skill installation from the public repository. Installation does not confirm a skills.sh website listing.
- [x] Enable GitHub private vulnerability reporting.

## Out of scope

- Write operations, write-enabling flags, snapshots, audit files, and retention.
- Cross-server joins and distributed snapshots.
- Port forwarding and infrastructure-specific connection setup; manage them outside this project.
