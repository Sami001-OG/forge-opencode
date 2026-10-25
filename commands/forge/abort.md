---
description: Forge: abort the active loop (keeps .forge/ state; the Forge gate goes quiet).
agent: build
---

Run `node "{{FORGE_ROOT}}/scripts/forge.mjs" abort`, then show its one-line result. Do not continue any build work after that unless the user asks.
