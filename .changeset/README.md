# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to manage versioning and releases.

## Creating a Changeset

When you make changes to one or more packages, generate a changeset file:

```bash
pnpm changeset
```

Follow the prompts to select affected packages, choose semver bump types (`major`, `minor`, `patch`), and write a release note summary.

## Versioning & Releasing

To consume changesets and bump package versions along with updating CHANGELOGs:

```bash
pnpm version-packages
```

To build and publish packages to npm:

```bash
pnpm release
```
