# UbiRSTP2ONVIF

UbiRSTP2ONVIF is a Docker-first web application for managing existing RTSP sources and exposing them through ONVIF-style camera endpoints. The project is designed for recorder environments that expect ONVIF-compatible devices, with an emphasis on stable administration, safe credential handling, and maintainable deployment.

For UniFi Protect, each virtual camera must be reachable on its own dedicated LAN IP. A shared IP with multiple ONVIF streams is not enough, because UniFi does not offer stream selection behind a single camera address.

The current deployment concept therefore treats `go2rtc` as a sidecar that runs in the worker's network namespace. That way the ONVIF endpoints and the local RTSP service share the same worker IP, which matches how UniFi expects third-party cameras to appear.

## Current Scope

- Fastify + TypeScript backend with SQLite persistence
- React + Vite WebUI with English and German language support
- Secure login, session cookies, admin-only user management, and password resets
- Stream CRUD with health checks, last test status, and ONVIF metadata fields
- Minimal ONVIF device/media SOAP endpoints per configured stream
- Optional WS-Discovery responder for active streams on UDP `3702`
- Docker image build, GitHub Actions CI, and GHCR release workflow
- Deployment guidance for a control-plane plus worker model where each UniFi-facing worker owns one IP
- Worker plus `go2rtc` sidecar guidance where ONVIF and local RTSP share the same worker IP

## Important Compatibility Note

This implementation focuses on the control plane and recorder-facing ONVIF service responses. It does not transcode or relay the RTSP media itself by default. Instead, the ONVIF media response returns the configured upstream RTSP URL, optionally enriched with securely stored credentials. Compatibility therefore depends on whether the target recorder accepts:

- the provided ONVIF SOAP responses
- manual or discovered ONVIF service URLs
- direct playback of the upstream RTSP source

Snapshot responses currently use a generated placeholder image endpoint, not a real camera still-image fetch.

If a target NVR requires deeper ONVIF coverage, additional SOAP operations or media proxying may still be needed.

For the UniFi-specific deployment shape, the recommended model is:

- one control-plane instance for auth, persistence, and the Web UI
- one worker instance per virtual camera
- one dedicated LAN IP per worker, preferably via `macvlan` or `ipvlan`
- one `go2rtc` sidecar per worker, sharing the worker network namespace via `network_mode: service:<worker>`
- no shared camera IP for multiple UniFi-adopted streams

If you prefer not to hand-write per-worker YAML, a static compose generator works well: keep a worker template, substitute camera name, worker IP, and upstream RTSP settings, then emit one service per camera.

For worker-side media handling, `go2rtc` is a good fit because it can expose RTSP on `8554` and its API on `1984`. Those ports are assumptions, not hard requirements, so a generator or overlay can change them per worker if needed.

Advanced deployments may also chain `go2rtc` or `ffmpeg` transforms for things like blur masks, fisheye handling, or stream repackaging. That is optional and should stay separate from the basic one-camera-per-IP path.

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
  control-plane:
    image: ghcr.io/itsh-neumeier/ubirstp2onvif:latest
    build:
      context: .
    ports:
      - "8080:8080"
    environment:
      PORT: 8080
      DATA_DIR: /data
      APP_BASE_URL: http://localhost:8080
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change-me-now
      ONVIF_DISCOVERY_ENABLED: "false"
    volumes:
      - ubirstp2onvif-control-plane-data:/data
    restart: unless-stopped

  worker-template:
    image: ghcr.io/itsh-neumeier/ubirstp2onvif:latest
    profiles:
      - workers
    # Replace this placeholder with a dedicated macvlan or ipvlan network.
    # UniFi-facing workers should not share one IP.
    environment:
      PORT: 8080
      DATA_DIR: /data
      APP_BASE_URL: http://192.168.10.201:8080
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change-me-now
      ONVIF_DISCOVERY_ENABLED: "true"
      ONVIF_DISCOVERY_PORT: 3702
    volumes:
      - ubirstp2onvif-worker-data:/data
    restart: unless-stopped

  go2rtc-sidecar:
    image: alexxit/go2rtc:latest
    profiles:
      - workers
    network_mode: service:worker-template
    depends_on:
      - worker-template
    # go2rtc shares the worker network namespace, so it uses the same LAN IP.
    # Keep the ports configurable for compose generators and previews.
    environment:
      GO2RTC_RTSP_PORT: 8554
      GO2RTC_API_PORT: 1984
      GO2RTC_CONFIG: /config/go2rtc.yaml
    volumes:
      - ubirstp2onvif-go2rtc-data:/config
    restart: unless-stopped

volumes:
  ubirstp2onvif-control-plane-data:
  ubirstp2onvif-worker-data:
  ubirstp2onvif-go2rtc-data:
```

### 2. Open the Web UI

- URL: `http://localhost:8080`
- Default admin username: `admin`
- Default password: value from `ADMIN_PASSWORD`

If `ADMIN_PASSWORD` is not provided and the database is empty, the backend generates a random initial password and logs it once during first boot.

You can also start from [`.env.example`](./.env.example) for local configuration.

### 3. Portainer Stack Notes

If you deploy this stack through Portainer, keep the control plane simple first:

- use `http://<host-ip>:8080` in the browser, not `https://...`
- avoid browser-blocked ports such as `10080`
- set `APP_BASE_URL` to the real address users or recorders reach, for example `http://192.168.140.30:8080`
- when you use a published host port, keep `ports` and `PORT` aligned, for example `8080:8080`
- do not keep `build:` in the Portainer stack if you want to run the published GHCR image directly

Minimal Portainer control-plane example:

```yaml
services:
  control-plane:
    image: ghcr.io/itsh-neumeier/ubirstp2onvif:latest
    ports:
      - "8080:8080"
    environment:
      PORT: 8080
      DATA_DIR: /data
      APP_BASE_URL: http://192.168.140.30:8080
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change-me-now
      ONVIF_DISCOVERY_ENABLED: "false"
    volumes:
      - ubirstp2onvif-control-plane-data:/data
    restart: unless-stopped

volumes:
  ubirstp2onvif-control-plane-data:
```

Worker-specific Portainer notes:

- UniFi-facing workers should use their own LAN IP, typically through `macvlan` or `ipvlan`
- for those dedicated-IP workers, `APP_BASE_URL` must point to the worker IP, not the control-plane IP
- workers usually do not need published host ports when the recorder reaches the worker IP directly
- publish `3702/udp` only if that specific worker should answer ONVIF discovery on the host network
- `go2rtc` RTSP on `8554` normally stays inside the worker namespace; only publish it if you explicitly want host-side testing
- the control plane can generate per-camera compose previews, but Portainer still needs one worker service per camera identity

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
| `GO2RTC_RTSP_PORT` | `8554` | go2rtc RTSP listen port in worker sidecars |
| `GO2RTC_API_PORT` | `1984` | go2rtc API listen port in worker sidecars |
| `GO2RTC_CONFIG_PATH` | `/config/go2rtc.yaml` | Path to the worker-local go2rtc config |

UniFi worker notes:

- `APP_BASE_URL` should point at the worker's dedicated LAN IP
- `ONVIF_DISCOVERY_ENABLED` is usually `true` on a worker and `false` on the control plane
- `3702/udp` matters for workers that actively advertise themselves on the network
- `macvlan` or `ipvlan` is the right choice when the worker must appear as a separate camera IP
- `go2rtc` typically listens on `8554` for RTSP and `1984` for its API, but both should stay configurable

## Data and Migrations

- SQLite database file: `${DATA_DIR}/ubirstp2onvif.sqlite`
- Instance secret file: `${DATA_DIR}/instance-secrets.json`
- Schema changes are applied automatically on startup through embedded migrations
- Persistent volumes are intended to remain forward-compatible across releases
- If you split the deployment into control-plane and worker containers, keep one persistent volume per worker so credentials and runtime state stay isolated
- If you add `go2rtc` sidecars, keep one config volume per worker-sidecar pair so the generated relay settings remain isolated too

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
- UniFi deployment guidance for the dedicated-IP worker model
- worker plus `go2rtc` sidecar guidance for shared-IP namespace deployments

## CI and Releases

- CI workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- GHCR release workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

Push a semantic version tag such as `v1.0.0` to trigger a release image build for GHCR.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT. See [LICENSE](./LICENSE).
