import { createSocket, type Socket } from "node:dgram";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { getStreamById, listStreams } from "../../db/database.js";
import { getPlaybackUrl, serializeStream } from "../streams/service.js";

function soapEnvelope(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

function getOperation(body: string): string {
  const operations = [
    "GetDeviceInformation",
    "GetServices",
    "GetCapabilities",
    "GetScopes",
    "GetServiceCapabilities",
    "GetProfiles",
    "GetVideoSources",
    "GetStreamUri",
    "GetSnapshotUri"
  ];
  return operations.find((operation) => new RegExp(`<\\/?(?:\\w+:)?${operation}\\b`).test(body)) ?? "Unknown";
}

function discoveryXml(app: FastifyInstance, streamId: string, relatesTo: string) {
  const endpoint = `${app.config.baseUrl}/onvif/${streamId}/device_service`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>urn:uuid:${randomUUID()}</w:MessageID>
    <w:RelatesTo>${relatesTo}</w:RelatesTo>
    <w:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</w:Action>
  </e:Header>
  <e:Body>
    <d:ProbeMatches>
      <d:ProbeMatch>
        <w:EndpointReference>
          <w:Address>urn:uuid:${streamId}</w:Address>
        </w:EndpointReference>
        <d:Types>dn:NetworkVideoTransmitter</d:Types>
        <d:Scopes>onvif://www.onvif.org/name/${streamId}</d:Scopes>
        <d:XAddrs>${endpoint}</d:XAddrs>
        <d:MetadataVersion>1</d:MetadataVersion>
      </d:ProbeMatch>
    </d:ProbeMatches>
  </e:Body>
</e:Envelope>`;
}

export async function registerOnvifRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/onvif/endpoints", async (request, reply) => {
    if (!request.currentUser) {
      reply.code(401).send({ error: "Authentication required." });
      return;
    }
    reply.send({
      endpoints: listStreams(app.db).map((stream) => ({
        id: stream.id,
        active: Boolean(stream.active),
        ...serializeStream(stream, app.config).onvif
      }))
    });
  });

  const handleSoap = async (streamId: string, body: string, type: "device" | "media") => {
    const stream = getStreamById(app.db, streamId);
    if (!stream) {
      return {
        code: 404,
        payload: soapEnvelope("<s:Fault><s:Reason><s:Text>Stream not found.</s:Text></s:Reason></s:Fault>")
      };
    }

    const streamView = serializeStream(stream, app.config);
    const playbackUrl = getPlaybackUrl(stream, app.config);
    const operation = getOperation(body);

    if (type === "device") {
      switch (operation) {
        case "GetDeviceInformation":
          return {
            code: 200,
            payload: soapEnvelope(`
              <tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
                <tds:Manufacturer>${streamView.onvif.manufacturer}</tds:Manufacturer>
                <tds:Model>${streamView.onvif.model}</tds:Model>
                <tds:FirmwareVersion>${streamView.onvif.firmwareVersion}</tds:FirmwareVersion>
                <tds:SerialNumber>${stream.id}</tds:SerialNumber>
                <tds:HardwareId>${streamView.onvif.hardwareId}</tds:HardwareId>
              </tds:GetDeviceInformationResponse>
            `)
          };
        case "GetServices":
          return {
            code: 200,
            payload: soapEnvelope(`
              <tds:GetServicesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                <tds:Service>
                  <tds:Namespace>http://www.onvif.org/ver10/device/wsdl</tds:Namespace>
                  <tds:XAddr>${app.config.baseUrl}/onvif/${stream.id}/device_service</tds:XAddr>
                  <tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version>
                </tds:Service>
                <tds:Service>
                  <tds:Namespace>http://www.onvif.org/ver10/media/wsdl</tds:Namespace>
                  <tds:XAddr>${app.config.baseUrl}/onvif/${stream.id}/media_service</tds:XAddr>
                  <tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version>
                </tds:Service>
              </tds:GetServicesResponse>
            `)
          };
        case "GetCapabilities":
          return {
            code: 200,
            payload: soapEnvelope(`
              <tds:GetCapabilitiesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                <tds:Capabilities>
                  <tt:Media XAddr="${app.config.baseUrl}/onvif/${stream.id}/media_service" />
                  <tt:Device XAddr="${app.config.baseUrl}/onvif/${stream.id}/device_service" />
                </tds:Capabilities>
              </tds:GetCapabilitiesResponse>
            `)
          };
        case "GetScopes":
          return {
            code: 200,
            payload: soapEnvelope(`
              <tds:GetScopesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
                <tds:Scopes>
                  <tt:ScopeDef xmlns:tt="http://www.onvif.org/ver10/schema">Fixed</tt:ScopeDef>
                  <tds:ScopeItem>onvif://www.onvif.org/name/${streamView.onvif.name}</tds:ScopeItem>
                </tds:Scopes>
                <tds:Scopes>
                  <tt:ScopeDef xmlns:tt="http://www.onvif.org/ver10/schema">Fixed</tt:ScopeDef>
                  <tds:ScopeItem>onvif://www.onvif.org/hardware/${streamView.onvif.hardwareId}</tds:ScopeItem>
                </tds:Scopes>
              </tds:GetScopesResponse>
            `)
          };
        case "GetServiceCapabilities":
          return {
            code: 200,
            payload: soapEnvelope(`
              <tds:GetServiceCapabilitiesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
                <tds:Capabilities />
              </tds:GetServiceCapabilitiesResponse>
            `)
          };
      }
    }

    if (type === "media") {
      switch (operation) {
        case "GetServiceCapabilities":
          return {
            code: 200,
            payload: soapEnvelope(`
              <trt:GetServiceCapabilitiesResponse xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
                <trt:Capabilities SnapshotUri="false" Rotation="false" VideoSourceMode="false" />
              </trt:GetServiceCapabilitiesResponse>
            `)
          };
        case "GetProfiles":
          return {
            code: 200,
            payload: soapEnvelope(`
              <trt:GetProfilesResponse xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                <trt:Profiles token="main" fixed="true">
                  <tt:Name>${streamView.onvif.name}</tt:Name>
                </trt:Profiles>
              </trt:GetProfilesResponse>
            `)
          };
        case "GetVideoSources":
          return {
            code: 200,
            payload: soapEnvelope(`
              <trt:GetVideoSourcesResponse xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                <trt:VideoSources token="source-${stream.id}">
                  <tt:Framerate>25</tt:Framerate>
                  <tt:Resolution>
                    <tt:Width>1920</tt:Width>
                    <tt:Height>1080</tt:Height>
                  </tt:Resolution>
                </trt:VideoSources>
              </trt:GetVideoSourcesResponse>
            `)
          };
        case "GetStreamUri":
          return {
            code: 200,
            payload: soapEnvelope(`
              <trt:GetStreamUriResponse xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                <trt:MediaUri>
                  <tt:Uri>${playbackUrl}</tt:Uri>
                  <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
                  <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
                  <tt:Timeout>PT60S</tt:Timeout>
                </trt:MediaUri>
              </trt:GetStreamUriResponse>
            `)
          };
        case "GetSnapshotUri":
          return {
            code: 200,
            payload: soapEnvelope(`
              <trt:GetSnapshotUriResponse xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                <trt:MediaUri>
                  <tt:Uri>${app.config.baseUrl}/onvif/${stream.id}/snapshot</tt:Uri>
                  <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
                  <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
                  <tt:Timeout>PT5S</tt:Timeout>
                </trt:MediaUri>
              </trt:GetSnapshotUriResponse>
            `)
          };
      }
    }

    return {
      code: 500,
      payload: soapEnvelope("<s:Fault><s:Reason><s:Text>Unsupported ONVIF action.</s:Text></s:Reason></s:Fault>")
    };
  };

  app.post("/onvif/:streamId/device_service", async (request, reply) => {
    const params = request.params as { streamId: string };
    const body = typeof request.body === "string" ? request.body : String(request.body ?? "");
    const result = await handleSoap(params.streamId, body, "device");
    reply.type("application/soap+xml; charset=utf-8").code(result.code).send(result.payload);
  });

  app.post("/onvif/:streamId/media_service", async (request, reply) => {
    const params = request.params as { streamId: string };
    const body = typeof request.body === "string" ? request.body : String(request.body ?? "");
    const result = await handleSoap(params.streamId, body, "media");
    reply.type("application/soap+xml; charset=utf-8").code(result.code).send(result.payload);
  });

  app.get("/onvif/:streamId/snapshot", async (request, reply) => {
    const params = request.params as { streamId: string };
    const stream = getStreamById(app.db, params.streamId);
    if (!stream) {
      reply.code(404).type("text/plain; charset=utf-8").send("Snapshot not available.");
      return;
    }

    reply
      .type("image/svg+xml; charset=utf-8")
      .send(`
        <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
          <rect width="1280" height="720" fill="#0f172a"/>
          <rect x="40" y="40" width="1200" height="640" rx="28" fill="#111c30" stroke="#334155" stroke-width="4"/>
          <text x="80" y="140" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="44">UbiRSTP2ONVIF</text>
          <text x="80" y="210" fill="#93c5fd" font-family="Arial, sans-serif" font-size="30">${stream.name}</text>
          <text x="80" y="280" fill="#94a3b8" font-family="Arial, sans-serif" font-size="24">Snapshot placeholder</text>
          <text x="80" y="330" fill="#64748b" font-family="Arial, sans-serif" font-size="20">Configure a real snapshot proxy if your recorder requires still-image fetches.</text>
        </svg>
      `);
  });
}

export function startOnvifDiscovery(app: FastifyInstance): Socket | null {
  if (!app.config.onvifDiscoveryEnabled) {
    return null;
  }

  const socket = createSocket({ type: "udp4", reuseAddr: true });
  socket.on("error", (error) => {
    app.log.warn({ error }, "ONVIF discovery socket error");
  });

  socket.on("message", (message, remote) => {
    const xml = message.toString("utf8");
    if (!xml.includes("Probe")) {
      return;
    }
    const relatesTo = xml.match(/<\w*:MessageID>(.*?)<\/\w*:MessageID>/)?.[1] ?? `urn:uuid:${randomUUID()}`;
    const streams = listStreams(app.db).filter((stream) => Boolean(stream.active));
    for (const stream of streams) {
      socket.send(discoveryXml(app, stream.id, relatesTo), remote.port, remote.address);
    }
  });

  socket.bind(app.config.onvifDiscoveryPort, () => {
    try {
      socket.addMembership("239.255.255.250");
    } catch (error) {
      app.log.warn({ error }, "Unable to join ONVIF multicast group");
    }
    app.log.info({ port: app.config.onvifDiscoveryPort }, "ONVIF discovery listener started");
  });

  return socket;
}
