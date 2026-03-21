# Changelog

All notable changes to this project will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-03-21

### Added
- Added a control-plane and worker deployment model for dedicated per-camera ONVIF worker instances.
- Added worker deployment metadata, compose preview generation, and go2rtc sidecar configuration previews per stream.
- Added worker-mode ONVIF root endpoints for single-camera IP deployments and tests covering worker routing and compose preview output.
- Added go2rtc stream pipeline fields for direct restreams or FFmpeg-based advanced transforms such as blur masks or fisheye correction.

### Changed
- Documented the UniFi-specific one-camera-per-dedicated-IP deployment model.
- Added control-plane, worker, and `go2rtc` sidecar compose examples plus worker-oriented environment hints.
- Documented configurable `go2rtc` ports and optional FFmpeg/go2rtc transform chains for advanced deployments.
- Refined the WebUI with multi-page navigation, compact flag-based language switching, favicon support, and dismissing toast notifications.

## [0.1.2] - 2026-03-21

### Fixed
- Login/session handling now works correctly behind plain HTTP deployments such as Portainer stacks without forcing `Secure` cookies.
- Environment boolean parsing now correctly understands values like `false`, `0`, `no`, and `off`.

## [0.1.1] - 2026-03-21

### Fixed
- CI no longer depends on npm cache metadata that requires a lockfile.
- Backend TypeScript build issues around config parsing and `better-sqlite3` type declarations.
- Public repository and GHCR image references now point to the real GitHub project.

### Changed
- Follow-up release prepared as `v0.1.1` after the initial failed `v0.1.0` automation run.

## [0.1.0] - 2026-03-21

### Added
- Initial backend implementation with Fastify, SQLite persistence, embedded migrations, admin auth, stream management, health checks, ONVIF SOAP endpoints, and CLI commands.
- Initial frontend implementation with React, Vite, German and English language support, light and dark mode, admin-focused WebUI, and API integration.
- Dockerfile, Docker Compose example, GitHub Actions CI, GHCR release workflow, and project documentation.

### Security
- Argon2id password hashing, signed session cookies, encrypted stream credentials, RTSP target validation, and non-root container runtime defaults.
