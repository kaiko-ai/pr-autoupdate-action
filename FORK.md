# Fork Status

This is a kaiko-ai fork of [chinthakagodawita/autoupdate-action](https://github.com/chinthakagodawita/autoupdate-action).

## Upstream Base

- **Repository**: `chinthakagodawita/autoupdate-action`
- **Version**: v1.7.0 (master branch)
- **Last synced**: 2024-12-24

## Kaiko Modifications

### v1.patch2

- Converted to standard Node.js GitHub Action (no longer requires container)

### v1.patch1

- Added `pull_request_target` event support in `src/router.ts`
- Added corresponding test in `test/router.test.ts`
- Updated `README.md` to list `pull_request_target` as supported event
- Fixed Dockerfile to explicitly target `linux/amd64` platform

## Versioning

Tags follow the pattern: `v1.patch{n}`

- `v1.patch2` - Standard Node.js action (recommended)
- `v1.patch1` - Initial kaiko release with `pull_request_target` support

## Usage

```yaml
uses: kaiko-ai/pr-autoupdate-action@v1.patch2
```

## Why This Fork Exists

The upstream action does not support the `pull_request_target` event type, which is required for secure workflows that need to run with elevated permissions on PRs from forks or when auto-merge is enabled.

See upstream issue: https://github.com/chinthakagodawita/autoupdate-action/issues/296