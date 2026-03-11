# Changelog

Changelog for File Last Modified.

## [0.3.3] 2026-03-11

- Replace the Marketplace preview image with the updated hover screenshot

## [0.3.2] 2026-03-11

- Publish the updated icon and preview assets

## [0.3.1] 2026-03-11

- Use the packaged local preview image in the README so the extension details page shows the intended screenshot

## [0.3.0] 2026-03-11

- Publish the current File Last Modified experience as the 0.3.0 release

## [0.2.15] 2026-03-11

- Remove the GitHub timestamp line from the hover tooltip so it shows only local and local Git timestamps

## [0.2.14] 2026-03-11

- Restore GitHub commit timestamp lookups for the active-file status bar and hover tooltip
- Show Local, Git, and GitHub timestamps together in the hover so users can compare the two external sources against the file timestamp
- Keep Explorer decorations on local-only data so the file tree stays responsive

## [0.2.13] 2026-03-11

- Remove `Refresh Last Modified` from the Explorer title bar and file context menu so refresh is driven by the status bar item instead

## [0.2.12] 2026-03-11

- Enable both `explorer.decorations.badges` and `explorer.decorations.colors` so Explorer filename tinting actually appears
- Update the prompt and command messaging to refer to Explorer decorations as badges plus colors

## [0.2.11] 2026-03-11

- Rename the refresh command to `Refresh Last Modified` so the status bar hover matches the UI language
- Add an explicit tooltip hint that clicking the `Last Modified` status bar item refreshes it directly

## [0.2.10] 2026-03-11

- Enable Explorer filename tinting by default so file age colors are visible without extra setup
- Bump the extension version so updated packaged assets, including the icon, are delivered in a fresh release

## [0.2.9] 2026-03-11

- Add `fileLastUpdated.colorizeExplorerLabels` to optionally tint Explorer filename labels by file age

## [0.2.8] - 2026-03-10

- Remove GitHub timestamp lookups and rely on local file metadata plus local Git history
- Add an opt-in command to enable Explorer badge decorations
- Prompt once on activation when required Explorer badge settings are disabled
- Stop setting `FileDecoration.color` because VS Code applies it to the full filename label


## [0.2.7] - 2026-03-10

- Ugh

## [0.2.6] - 2026-03-10

- Tweaks...

## [0.2.5] - 2026-03-10

- Bugs and refresh command

## [0.2.4] - 2026-03-10

- Added color warnings, more hover info and file explorer data

## [0.2.3] - 2026-03-10

- Update preview image on listing again

## [0.2.2] - 2026-03-10

- Update preview image on listing
## [0.2.1] - 2026-03-10

- Update Marketplace category to Visualization
- Refresh listing description with the repo-cleanup origin story
- Update listing preview image and Marketplace search phrasing

## [0.1.0] - 2026-03-10

- Compare local file modified time, local git commit time, and GitHub commit time
- Fix local git fallback so it works even when the repository is not hosted on GitHub
- Add a manual refresh command from the status bar
- Add configuration for enabling GitHub lookups, setting a GitHub token, and controlling request timeout
- Add timeout handling and cache invalidation on configuration changes

## [0.0.1] - 2026-03-10

- Initial release
