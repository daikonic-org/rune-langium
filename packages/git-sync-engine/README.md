# @rune-langium/git-sync-engine

A generic, framework/FS/remote-agnostic two-way git sync engine built over [isomorphic-git](https://isomorphic-git.org/). It implements a debounced commit → fetch → fast-forward-or-merge → push loop with a pluggable conflict policy, so any host environment (browser OPFS, Node.js `fs`, or a virtual in-memory FS) can wire in its own storage, HTTP transport, and conflict resolution strategy without taking a hard dependency on any particular runtime or UI framework.


Hosts can set `autoSync: false` to keep working-copy Save separate from Git
publication. In this mode `notifyDirty()` publishes an uncommitted-change status
without scheduling a commit or network request. An explicit `syncNow()` performs
the existing commit/fetch/merge/push operation. Changes arriving during it remain
marked dirty for the next explicit operation. Studio uses this mode and exposes
**Commit and push** in Git / Sync.
