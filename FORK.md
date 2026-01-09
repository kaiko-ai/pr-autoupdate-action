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

- Fixed Dockerfile to explicitly target `linux/amd64` platform

## Versioning

Tags follow the pattern: `v1.patch{n}`

- `v1.patch2` - Standard Node.js action (recommended)
- `v1.patch1` - Initial kaiko release with Dockerfile fixes

## Usage

```yaml
uses: kaiko-ai/pr-autoupdate-action@v1.patch2
```

## Why This Fork Exists

This fork was created to convert the action to a standard Node.js GitHub Action that doesn't require a container, making it faster and easier to use.