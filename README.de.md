# UbiRSTP2ONVIF

UbiRSTP2ONVIF ist eine Docker-first Webanwendung zur Verwaltung bestehender RTSP-Quellen und zur Bereitstellung dieser Quellen ueber ONVIF-artige Kamera-Endpunkte. Der Fokus liegt auf einer stabilen Admin-Oberflaeche, sicherer Behandlung sensibler Daten und einer wartbaren Bereitstellung.

Fuer UniFi Protect gilt eine wichtige Einschraenkung: Jede virtuelle Kamera muss unter einer eigenen dedizierten LAN-IP erreichbar sein. Eine gemeinsame IP mit mehreren ONVIF-Streams reicht nicht, weil UniFi hinter einer Kameraadresse keine Stream-Auswahl anbietet.

Das aktuelle Deployment-Konzept denkt deshalb `go2rtc` als Sidecar mit, der im Netzwerk-Namespace des Workers laeuft. So teilen sich ONVIF-Endpunkte und lokaler RTSP-Dienst dieselbe Worker-IP, was genau zu der Art passt, wie UniFi Drittanbieter-Kameras erwartet.

## Aktueller Umfang

- Fastify- und TypeScript-Backend mit SQLite-Persistenz
- React- und Vite-WebUI mit Deutsch und Englisch
- Login, sichere Session-Cookies, Admin-Benutzerverwaltung und Passwort-Reset
- Stream-CRUD mit Health-Checks, letztem Teststatus und ONVIF-Metadaten
- Minimale ONVIF-Device- und Media-SOAP-Endpunkte pro Stream
- Optionaler WS-Discovery-Responder fuer aktive Streams auf UDP `3702`
- Docker-Build, GitHub-Actions-CI und GHCR-Release-Workflow
- Bereitstellungshinweise fuer ein Control-Plane- und Worker-Modell, bei dem jeder UniFi-Worker eine eigene IP besitzt
- Worker- und `go2rtc`-Sidecar-Hinweise, bei denen ONVIF und lokaler RTSP dieselbe Worker-IP teilen

## Wichtiger Kompatibilitaetshinweis

Die aktuelle Implementierung konzentriert sich auf die Verwaltungs- und ONVIF-Steuerungsebene. Der RTSP-Medienstrom wird standardmaessig nicht transkodiert oder lokal relayed. Stattdessen liefert die ONVIF-Media-Antwort die konfigurierte Upstream-RTSP-URL, optional mit sicher gespeicherten Zugangsdaten.

Die Kompatibilitaet haengt daher davon ab, ob der Ziel-Recorder:

- die bereitgestellten ONVIF-SOAP-Antworten akzeptiert
- manuelle oder entdeckte ONVIF-Service-URLs verarbeiten kann
- den eigentlichen Upstream-RTSP-Stream direkt abspielen darf

Snapshot-Antworten liefern aktuell nur ein generiertes Platzhalterbild und noch keinen echten Kamera-Snapshot.

Falls ein Ziel-NVR weitergehende ONVIF-Funktionen benoetigt, muessen zusaetzliche SOAP-Operationen oder ein echter Medien-Proxy ergaenzt werden.

Fuer die UniFi-spezifische Bereitstellung ist folgendes Modell empfehlenswert:

- eine Control-Plane-Instanz fuer Authentifizierung, Persistenz und WebUI
- eine Worker-Instanz pro virtueller Kamera
- eine dedizierte LAN-IP pro Worker, bevorzugt via `macvlan` oder `ipvlan`
- ein `go2rtc`-Sidecar pro Worker, der per `network_mode: service:<worker>` im selben Netzwerk-Namespace laeuft
- keine geteilte Kamera-IP fuer mehrere UniFi-adoptierte Streams

Wenn du kein YAML von Hand pflegen willst, funktioniert ein statischer Compose-Generator gut: Worker-Template behalten, Kameraname, Worker-IP und Upstream-RTSP-Werte einsetzen und daraus einen Service pro Kamera erzeugen.

Fuer die Medienseite ist `go2rtc` passend, weil es RTSP auf `8554` und die API auf `1984` bereitstellen kann. Diese Ports sind Annahmen und sollen bewusst konfigurierbar bleiben, damit Generatoren oder Overlays sie pro Worker anpassen koennen.

Fuer fortgeschrittene Setups sind auch Transformationsketten mit `go2rtc` oder `ffmpeg` denkbar, zum Beispiel fuer Blurmasken, Fisheye-Aufbereitung oder das Umverpacken von Streams. Das sollte aber als Advanced-Thema getrennt von der Grundarchitektur bleiben.

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
    # Dieses Platzhalter-Setup sollte vor produktivem Einsatz auf ein
    # dediziertes macvlan- oder ipvlan-Netz umgestellt werden.
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
    # go2rtc teilt sich den Netzwerk-Namespace des Workers und nutzt daher
    # dieselbe LAN-IP. Die Ports bleiben fuer Generatoren frei konfigurierbar.
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

### 2. WebUI aufrufen

- URL: `http://localhost:8080`
- Standard-Admin: `admin`
- Passwort: Wert aus `ADMIN_PASSWORD`

Wenn `ADMIN_PASSWORD` nicht gesetzt ist und noch keine Datenbank existiert, erzeugt die Anwendung beim ersten Start ein zufaelliges Initialpasswort und protokolliert es einmalig.

Fuer die lokale Konfiguration kannst du auch bei [`.env.example`](./.env.example) starten.

### 3. Hinweise fuer Portainer-Stacks

Wenn du den Stack ueber Portainer ausrollst, starte zuerst mit einer einfachen Control Plane:

- im Browser `http://<host-ip>:8080` verwenden, nicht `https://...`
- keine browsergesperrten Ports wie `10080` verwenden
- `APP_BASE_URL` muss auf die echte von Benutzern oder Recordern erreichbare Adresse zeigen, zum Beispiel `http://192.168.140.30:8080`
- wenn du einen Host-Port veroeffentlichst, muessen `ports` und `PORT` zusammenpassen, zum Beispiel `8080:8080`
- `build:` im Portainer-Stack weglassen, wenn direkt das veroeffentlichte GHCR-Image genutzt werden soll

Minimales Portainer-Beispiel fuer die Control Plane:

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

Worker-spezifische Hinweise fuer Portainer:

- UniFi-seitige Worker sollten eine eigene LAN-IP bekommen, typischerweise ueber `macvlan` oder `ipvlan`
- bei solchen dedizierten Workern muss `APP_BASE_URL` auf die Worker-IP zeigen, nicht auf die IP der Control Plane
- Worker brauchen normalerweise keine veroeffentlichten Host-Ports, wenn der Recorder die Worker-IP direkt erreicht
- `3702/udp` nur dann veroeffentlichen, wenn genau dieser Worker ONVIF-Discovery ueber das Host-Netz beantworten soll
- `go2rtc` auf `8554` bleibt im Normalfall im Namespace des Workers; nur fuer explizite Host-Tests muss dieser Port nach aussen freigegeben werden
- die Control Plane kann pro Kamera Compose-Vorschauen erzeugen, aber in Portainer bleibt weiterhin ein eigener Worker-Service pro Kameraidentitaet noetig

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
| `GO2RTC_RTSP_PORT` | `8554` | RTSP-Listen-Port von go2rtc im Worker-Sidecar |
| `GO2RTC_API_PORT` | `1984` | API-Listen-Port von go2rtc im Worker-Sidecar |
| `GO2RTC_CONFIG_PATH` | `/config/go2rtc.yaml` | Pfad zur workerlokalen go2rtc-Konfiguration |

Hinweise fuer UniFi-Worker:

- `APP_BASE_URL` sollte auf die dedizierte LAN-IP des Workers zeigen
- `ONVIF_DISCOVERY_ENABLED` ist typischerweise auf dem Worker `true` und auf der Control Plane `false`
- `3702/udp` ist nur fuer Worker mit aktiver Netzwerkankuendigung relevant
- `macvlan` oder `ipvlan` ist die richtige Wahl, wenn der Worker als eigene Kamera-IP erscheinen soll
- `go2rtc` arbeitet haeufig mit `8554` fuer RTSP und `1984` fuer die API, beide Ports sollten aber konfigurierbar bleiben

## Datenhaltung und Migrationen

- SQLite-Datei: `${DATA_DIR}/ubirstp2onvif.sqlite`
- Instanz-Geheimnisse: `${DATA_DIR}/instance-secrets.json`
- Schema-Aenderungen werden beim Start automatisch ueber eingebettete Migrationen angewendet
- Persistente Volumes sollen release-uebergreifend kompatibel bleiben
- Wenn du Control Plane und Worker trennst, verwende pro Worker ein eigenes Volume, damit Zugangsdaten und Laufzeitstatus isoliert bleiben
- Wenn du `go2rtc`-Sidecars ergaenzst, verwende pro Worker-Sidecar-Paar ein eigenes Konfigurationsvolume, damit die Relay-Einstellungen getrennt bleiben

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
- UniFi-Hinweise fuer das dedizierte-IP-Worker-Modell
- Worker- plus `go2rtc`-Sidecar-Hinweise fuer Deployments mit gemeinsamem Netzwerk-Namespace

## CI und Releases

- CI-Workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- GHCR-Release-Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

Ein semantischer Versions-Tag wie `v1.0.0` startet den GHCR-Image-Build.

## Changelog

Siehe [CHANGELOG.md](./CHANGELOG.md).

## Lizenz

MIT. Siehe [LICENSE](./LICENSE).
