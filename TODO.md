# TODO

- [ ] Verify deployed read-only credentials on every configured MongoDB instance. Exercise profile listing, collection listing, and bounded reads through CLI and MCP; do not test writes against production.
- [ ] Complete release checks and verify the npm package contents before publication. Registry installation instructions remain pending publication.
- [ ] After the public repository is available, verify remote skill discovery with `npx skills add tboon0/mongo-readonly-mcp --list`. Local compatibility does not confirm a skills.sh listing.
- [ ] Enable a private vulnerability-reporting channel before inviting sensitive reports.

## Out of scope

- Write operations, write-enabling flags, snapshots, audit files, and retention.
- Cross-server joins and distributed snapshots.
- Port forwarding and infrastructure-specific connection setup; manage them outside this project.
