# UbiRSTP2ONVIF

UbiRSTP2ONVIF ist eine Docker-first Webanwendung zur Verwaltung bestehender RTSP-Quellen und zur Bereitstellung dieser Quellen ueber ONVIF-artige Kamera-Endpunkte. Der Fokus liegt auf einer stabilen Admin-Oberflaeche, sicherer Behandlung sensibler Daten und einer wartbaren Bereitstellung.

## Aktueller Umfang

- Fastify- und TypeScript-Backend mit SQLite-Persistenz
- React- und Vite-WebUI mit Deutsch und Englisch
- Login, sichere Session-Cookies, Admin-Benutzerverwaltung und Passwort-Reset
- Stream-CRUD mit Health-Checks, letztem Teststatus und ONVIF-Metadaten
- Minimale ONVIF-Device- und Media-SOAP-Endpunkte pro Stream
- Optionaler WS-Discovery-Responder fuer aktive Streams auf UDP `3702`
- Docker-Build, GitHub-Actions-CI und GHCR-Release-Workflow

## Wichtiger Kompatibilitaetshinweis

Die aktuelle Implementierung konzentriert sich auf die Verwaltungs- und ONVIF-Steuerungsebene. Der RTSP-Medienstrom wird standardmaessig nicht transkodiert oder lokal relayed. Stattdessen liefert die ONVIF-Media-Antwort die konfigurierte Upstream-RTSP-URL, optional mit sicher gespeicherten Zugangsdaten.

Die Kompatibilitaet haengt daher davon ab, ob der Ziel-Recorder:

- die bereitgestellten ONVIF-SOAP-Antworten akzeptiert
- manuelle oder entdeckte ONVIF-Service-URLs verarbeiten kann
- den eigentlichen Upstream-RTSP-Stream direkt abspielen darf

Snapshot-Antworten liefern aktuell nur ein generiertes Platzhalterbild und noch keinen echten Kamera-Snapshot.

Falls ein Ziel-NVR weitergehende ONVIF-Funktionen benoetigt, muessen zusaetzliche SOAP-Operationen oder ein echter Medien-Proxy ergaenzt werden.

## Repository-Struktur

```text
.github/workflows/   CI- und GHCR-Release-Automation
apps/backend/        API, Auth, Speicherung, Migrationen, ONVIF, CLI
apps/web/            WebUI, i18n, Themes, Tests
Dockerfile           Multi-Stage-Produktionsbuild
docker-compose.yml   Beispielbereitstellung
CHANGELOG.md         Changelog-Struktur
```

## Sicherheitsmerkmale

- Passwoerter werden mit Argon2id gehasht
- Stream-Zugangsdaten werden im persistenten Volume verschluesselt gespeichert
- Session-Cookies sind `HttpOnly` und signiert
- RTSP-Ziele werden validiert und `localhost`/Loopback wird abgelehnt
- Sensible Werte werden nicht im Klartext geloggt
- Der Produktionscontainer laeuft als Non-Root-User

## Schnellstart

### 1. Mit Docker Compose starten

```yaml
services:
  ubirstp2onvif:
    image: ghcr.io/your-org/ubirstp2onvif:latest
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

### 2. WebUI aufrufen

- URL: `http://localhost:8080`
- Standard-Admin: `admin`
- Passwort: Wert aus `ADMIN_PASSWORD`

Wenn `ADMIN_PASSWORD` nicht gesetzt ist und noch keine Datenbank existiert, erzeugt die Anwendung beim ersten Start ein zufaelliges Initialpasswort und protokolliert es einmalig.

Fuer die lokale Konfiguration kannst du auch bei [`.env.example`](./.env.example) starten.

## Konfiguration

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `8080` | HTTP-Port |
| `DATA_DIR` | `/data` in Docker | Persistentes Datenverzeichnis |
| `APP_BASE_URL` | `http://localhost:8080` | Oeffentliche Basis-URL fuer ONVIF-Antworten |
| `ADMIN_USERNAME` | `admin` | Name des ersten Admin-Benutzers |
| `ADMIN_PASSWORD` | keiner | Passwort des ersten Admin-Benutzers |
| `SESSION_TTL_HOURS` | `24` | Session-Lebensdauer |
| `HEALTHCHECK_INTERVAL_SECONDS` | `120` | Intervall fuer automatische Stream-Tests |
| `ONVIF_DISCOVERY_ENABLED` | `true` | WS-Discovery aktivieren |
| `ONVIF_DISCOVERY_PORT` | `3702` | UDP-Port fuer Discovery |
| `GITHUB_URL` | Platzhalter | GitHub-Link im Footer |

## Datenhaltung und Migrationen

- SQLite-Datei: `${DATA_DIR}/ubirstp2onvif.sqlite`
- Instanz-Geheimnisse: `${DATA_DIR}/instance-secrets.json`
- Schema-Aenderungen werden beim Start automatisch ueber eingebettete Migrationen angewendet
- Persistente Volumes sollen release-uebergreifend kompatibel bleiben

## Admin-CLI

Im Container:

```bash
node apps/backend/dist/cli.js users:list
node apps/backend/dist/cli.js users:reset-password <userId> <newPassword>
```

## Entwicklung

Das Repository verwendet npm-Workspaces.

```bash
npm install
npm test
npm run build
```

Fuer die Frontend-Entwicklung proxyt der Vite-Dev-Server `/api` und `/onvif` an `http://localhost:8080`.

## Tests

Enthaltene Tests pruefen:

- Login- und Session-Verhalten
- Admin-Benutzeranlage
- ONVIF-Stream-URI-Antworten
- Frontend-Login, Sprach-/Theme-Umschaltung und Stream-Editor

## CI und Releases

- CI-Workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- GHCR-Release-Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

Ein semantischer Versions-Tag wie `v1.0.0` startet den GHCR-Image-Build.

## Changelog

Siehe [CHANGELOG.md](./CHANGELOG.md).

## Lizenz

MIT. Siehe [LICENSE](./LICENSE).
