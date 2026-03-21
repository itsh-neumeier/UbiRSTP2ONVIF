export type Language = "en" | "de";
export type ThemeMode = "light" | "dark";

export type StreamStatus = "healthy" | "error" | "unknown";

export interface ApiUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "viewer";
  locale: Language;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiStream {
  id: string;
  name: string;
  description: string;
  rtspUrl: string;
  active: boolean;
  status: StreamStatus;
  lastError: string | null;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
  recorderNotes: string;
  hasStoredCredentials: boolean;
  onvif: {
    endpoint: string;
    deviceServiceUrl: string;
    mediaServiceUrl: string;
    profileToken: string;
    name: string;
    manufacturer: string;
    model: string;
    hardwareId: string;
    firmwareVersion: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: ApiUser;
}

export interface SystemInfo {
  appName: string;
  version: string;
  githubUrl: string;
  baseUrl: string;
  locale: Language;
  authenticated: boolean;
}
