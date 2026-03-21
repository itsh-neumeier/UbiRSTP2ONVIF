import type { ApiStream, ApiUser, AuthResponse, SystemInfo } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function getSystemInfo() {
  return request<SystemInfo>("/api/system/info");
}

export function getSession() {
  return request<AuthResponse>("/api/auth/me");
}

export function login(username: string, password: string) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function logout() {
  return request<void>("/api/auth/logout", {
    method: "POST"
  });
}

export function getStreams() {
  return request<{ streams: ApiStream[] }>("/api/streams");
}

export function createStream(payload: Record<string, unknown>) {
  return request<{ stream: ApiStream }>("/api/streams", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateStream(streamId: string, payload: Record<string, unknown>) {
  return request<{ stream: ApiStream }>(`/api/streams/${streamId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function testStream(streamId: string) {
  return request<{ stream: ApiStream }>(`/api/streams/${streamId}/test`, {
    method: "POST"
  });
}

export function deleteStream(streamId: string) {
  return request<void>(`/api/streams/${streamId}`, {
    method: "DELETE"
  });
}

export function startStream(streamId: string) {
  return request<{ stream: ApiStream }>(`/api/streams/${streamId}/start`, {
    method: "POST"
  });
}

export function stopStream(streamId: string) {
  return request<{ stream: ApiStream }>(`/api/streams/${streamId}/stop`, {
    method: "POST"
  });
}

export function getUsers() {
  return request<{ users: ApiUser[] }>("/api/users");
}

export function createUser(payload: {
  username: string;
  displayName: string;
  password: string;
  role: "admin" | "viewer";
  locale: "en" | "de";
}) {
  return request<{ user: ApiUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateUser(userId: string, payload: Record<string, unknown>) {
  return request<{ user: ApiUser }>(`/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function resetPassword(userId: string, password: string) {
  return request<void>(`/api/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}
