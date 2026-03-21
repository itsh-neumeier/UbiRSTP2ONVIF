# Changelog

All notable changes to this project will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

### Added
- Initial backend implementation with Fastify, SQLite persistence, embedded migrations, admin auth, stream management, health checks, ONVIF SOAP endpoints, and CLI commands.
- Initial frontend implementation with React, Vite, German and English language support, light and dark mode, admin-focused WebUI, and API integration.
- Dockerfile, Docker Compose example, GitHub Actions CI, GHCR release workflow, and project documentation.

### Security
- Argon2id password hashing, signed session cookies, encrypted stream credentials, RTSP target validation, and non-root container runtime defaults.
