# UbiRSTP2ONVIF

UbiRSTP2ONVIF is a Docker-first web application for managing existing RTSP sources and exposing them through ONVIF-style camera endpoints. The project is designed for recorder environments that expect ONVIF-compatible devices, with an emphasis on stable administration, safe credential handling, and maintainable deployment.

## Current Scope

- Fastify + TypeScript backend with SQLite persistence
- React + Vite WebUI with English and German language support
- Secure login, session cookies, admin-only user management, and password resets
- Stream CRUD with health checks, last test status, and ONVIF metadata fields
- Minimal ONVIF device/media SOAP endpoints per configured stream
- Optional WS-Discovery responder for active streams on UDP `3702`
- Docker image build, GitHub Actions CI, and GHCR release workflow

## Important Compatibility Note

This implementation focuses on the control plane and recorder-facing ONVIF service responses. It does not transcode or relay the RTSP media itself by default. Instead, the ONVIF media response returns the configured upstream RTSP URL, optionally enriched with securely stored credentials. Compatibility therefore depends on whether the target recorder accepts:

- the provided ONVIF SOAP responses
- manual or discovered ONVIF service URLs
- direct playback of the upstream RTSP source

Snapshot responses currently use a generated placeholder image endpoint, not a real camera still-image fetch.

If a target NVR requires deeper ONVIF coverage, additional SOAP operations or media proxying may still be needed.

## Repository Layout

```text
.github/workflows/   CI and GHCR release automation
apps/backend/        API, auth, storage, migrations, ONVIF responses, CLI
apps/web/            Web UI, i18n, theming, tests
Dockerfile           Multi-stage production container build
docker-compose.yml   Example deployment
CHANGELOG.md         Keep a Changelog structure
```

## Security Highlights

- Passwords are hashed with Argon2id
- Stream credentials are encrypted at rest with an application key stored in the persistent data volume
- Session cookies are `HttpOnly` and signed
- RTSP targets are validated and reject loopback/localhost values
- Sensitive values are not logged in plaintext
- The production container runs as a non-root user

## Quick Start

### 1. Run with Docker Compose

```yaml
services:
  ubirstp2onvif:
    image: ghcr.io/itsh-neumeier/ubirstp2onvif:latest
    build:
      context: .
    ports:
      - "8080:8080"
      - "3702:3702/udp"
    environment:
      PORT: 8080
      DATA_DIR: /data
      APP_BASE_URL: http://localhost:8080
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change-me-now
      ONVIF_DISCOVERY_ENABLED: "true"
    volumes:
      - ubirstp2onvif-data:/data
    restart: unless-stopped

volumes:
  ubirstp2onvif-data:
```

### 2. Open the Web UI

- URL: `http://localhost:8080`
- Default admin username: `admin`
- Default password: value from `ADMIN_PASSWORD`

If `ADMIN_PASSWORD` is not provided and the database is empty, the backend generates a random initial password and logs it once during first boot.

You can also start from [`.env.example`](./.env.example) for local configuration.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `/data` in Docker | Persistent storage directory |
| `APP_BASE_URL` | `http://localhost:8080` | Public base URL used in ONVIF responses |
| `ADMIN_USERNAME` | `admin` | First-run admin account name |
| `ADMIN_PASSWORD` | none | First-run admin password |
| `SESSION_TTL_HOURS` | `24` | Session lifetime |
| `HEALTHCHECK_INTERVAL_SECONDS` | `120` | Automatic stream test interval |
| `ONVIF_DISCOVERY_ENABLED` | `true` | Enable WS-Discovery responder |
| `ONVIF_DISCOVERY_PORT` | `3702` | UDP discovery port |
| `GITHUB_URL` | placeholder | GitHub link shown in the UI footer |

## Data and Migrations

- SQLite database file: `${DATA_DIR}/ubirstp2onvif.sqlite`
- Instance secret file: `${DATA_DIR}/instance-secrets.json`
- Schema changes are applied automatically on startup through embedded migrations
- Persistent volumes are intended to remain forward-compatible across releases

## Admin CLI

Inside the container:

```bash
node apps/backend/dist/cli.js users:list
node apps/backend/dist/cli.js users:reset-password <userId> <newPassword>
```

## Development

The repository uses npm workspaces.

```bash
npm install
npm test
npm run build
```

For frontend development the Vite dev server proxies `/api` and `/onvif` to `http://localhost:8080`.

## Tests

Included tests cover:

- login/session behavior
- admin user creation
- ONVIF stream URI responses
- frontend login flow, language/theme toggle, and stream editor loading

## CI and Releases

- CI workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- GHCR release workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

Push a semantic version tag such as `v1.0.0` to trigger a release image build for GHCR.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT. See [LICENSE](./LICENSE).
