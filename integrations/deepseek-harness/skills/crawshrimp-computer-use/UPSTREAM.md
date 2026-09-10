# Upstream

Source: https://github.com/howtimeschange/crawshrimp-computer-use (private)
Revision: 5085999fab956c9ede896b66c707c41dea9d222f
Vendored from the clean local checkout, matching remote HEAD on 2026-09-10.

Harness stages the native macOS helper at build time and supplies Windows dependencies in its Python runtime. Desktop tasks use this skill; webpage tasks continue to use crawshrimp-skill.

Local adaptation: macOS AX traversal depth is 32 (upstream 12) for nested Electron content; the 500-node/time bounds and truncated-tree write refusal remain.

Harness adds read-only automation-status, native Apple Events preflight/request, and a user-triggered desktop permission panel. Request is not exposed by the agent CLI; the host rechecks after the system response.
