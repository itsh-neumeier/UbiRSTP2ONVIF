import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createStream,
  createUser,
  deleteStream,
  getSession,
  getStreams,
  getSystemInfo,
  getUsers,
  login,
  logout,
  resetPassword,
  startStream,
  stopStream,
  testStream,
  updateStream,
  updateUser
} from "./api";
import { translate } from "./i18n";
import type { ApiStream, ApiUser, Language, ThemeMode } from "./types";

type StreamFormState = {
  name: string;
  description: string;
  rtspUrl: string;
  active: boolean;
  recorderNotes: string;
  onvifName: string;
  onvifManufacturer: string;
  onvifModel: string;
  onvifHardwareId: string;
  onvifFirmwareVersion: string;
  username: string;
  password: string;
};

function getInitialTheme(): ThemeMode {
  return localStorage.getItem("ubirstp2onvif-theme") === "dark" ? "dark" : "light";
}

function getInitialLanguage(): Language {
  return localStorage.getItem("ubirstp2onvif-lang") === "de" ? "de" : "en";
}

function emptyStreamForm(): StreamFormState {
  return {
    name: "",
    description: "",
    rtspUrl: "rtsp://camera.local/stream",
    active: true,
    recorderNotes: "",
    onvifName: "",
    onvifManufacturer: "",
    onvifModel: "",
    onvifHardwareId: "",
    onvifFirmwareVersion: "",
    username: "",
    password: ""
  };
}

function ThemeIcon({ theme }: { theme: ThemeMode }) {
  return <span>{theme === "dark" ? "Light" : "Dark"}</span>;
}

function formatTimestamp(value: string | null, language: Language) {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusClass(status: ApiStream["status"]) {
  return `status ${status}`;
}

function statusLabel(language: Language, status: ApiStream["status"]) {
  return {
    healthy: translate(language, "statusHealthy"),
    error: translate(language, "statusError"),
    unknown: translate(language, "statusUnknown")
  }[status];
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const [version, setVersion] = useState("0.1.1");
  const [githubUrl, setGithubUrl] = useState("https://github.com/itsh-neumeier/UbiRSTP2ONVIF");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [streams, setStreams] = useState<ApiStream[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });
  const [streamForm, setStreamForm] = useState<StreamFormState>(emptyStreamForm);
  const [newUserForm, setNewUserForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "viewer" as const,
    locale: "en" as Language
  });
  const [passwordReset, setPasswordReset] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ubirstp2onvif-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("ubirstp2onvif-lang", language);
  }, [language]);

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === selectedStreamId) ?? null,
    [selectedStreamId, streams]
  );

  useEffect(() => {
    if (!selectedStream) {
      setStreamForm(emptyStreamForm());
      return;
    }

    setStreamForm({
      name: selectedStream.name,
      description: selectedStream.description,
      rtspUrl: selectedStream.rtspUrl,
      active: selectedStream.active,
      recorderNotes: selectedStream.recorderNotes,
      onvifName: selectedStream.onvif.name,
      onvifManufacturer: selectedStream.onvif.manufacturer,
      onvifModel: selectedStream.onvif.model,
      onvifHardwareId: selectedStream.onvif.hardwareId,
      onvifFirmwareVersion: selectedStream.onvif.firmwareVersion,
      username: "",
      password: ""
    });
  }, [selectedStream]);

  async function refreshData(admin = currentUser?.role === "admin") {
    const [streamData, userData] = await Promise.all([
      getStreams(),
      admin ? getUsers() : Promise.resolve({ users: [] })
    ]);

    startTransition(() => {
      setStreams(streamData.streams);
      setUsers(userData.users);
      if (streamData.streams.length > 0) {
        setSelectedStreamId((current) =>
          current && streamData.streams.some((stream) => stream.id === current) ? current : streamData.streams[0].id
        );
      } else {
        setSelectedStreamId(null);
      }
    });
  }

  useEffect(() => {
    let active = true;

    const boot = async () => {
      try {
        const info = await getSystemInfo();
        if (!active) {
          return;
        }
        setVersion(info.version);
        setGithubUrl(info.githubUrl);
        setLanguage(info.locale);

        if (!info.authenticated) {
          setAuthenticated(false);
          return;
        }

        const session = await getSession();
        if (!active) {
          return;
        }

        setCurrentUser(session.user);
        setAuthenticated(true);
        await refreshData(session.user.role === "admin");
      } catch (bootError) {
        if (active) {
          setError(bootError instanceof Error ? bootError.message : translate(language, "loadFailed"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void boot();

    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const activeStreams = streams.filter((stream) => stream.active);
    const healthyStreams = streams.filter((stream) => stream.status === "healthy");
    const averageLatency =
      healthyStreams.length === 0
        ? 0
        : Math.round(
            healthyStreams.reduce((sum, stream) => sum + (stream.lastLatencyMs ?? 0), 0) / healthyStreams.length
          );

    return [
      { label: translate(language, "activeStreams"), value: String(activeStreams.length) },
      {
        label: translate(language, "health"),
        value: streams.length === 0 ? "0%" : `${Math.round((healthyStreams.length / streams.length) * 100)}%`
      },
      { label: translate(language, "latency"), value: `${averageLatency} ms` },
      { label: translate(language, "uptime"), value: currentUser?.role ?? "viewer" }
    ];
  }, [currentUser?.role, language, streams]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const auth = await login(loginForm.username, loginForm.password);
      setCurrentUser(auth.user);
      setAuthenticated(true);
      await refreshData(auth.user.role === "admin");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
      setAuthenticated(false);
      setCurrentUser(null);
      setStreams([]);
      setUsers([]);
      setSelectedStreamId(null);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveStream() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: streamForm.name,
        description: streamForm.description,
        rtspUrl: streamForm.rtspUrl,
        active: streamForm.active,
        recorderNotes: streamForm.recorderNotes,
        onvifName: streamForm.onvifName,
        onvifManufacturer: streamForm.onvifManufacturer,
        onvifModel: streamForm.onvifModel,
        onvifHardwareId: streamForm.onvifHardwareId,
        onvifFirmwareVersion: streamForm.onvifFirmwareVersion
      };
      if (streamForm.username) {
        payload.username = streamForm.username;
      }
      if (streamForm.password) {
        payload.password = streamForm.password;
      }

      if (selectedStream) {
        await updateStream(selectedStream.id, payload);
      } else {
        const created = await createStream(payload);
        setSelectedStreamId(created.stream.id);
      }
      await refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save stream.");
    } finally {
      setBusy(false);
    }
  }

  async function onTestStream() {
    if (!selectedStream) {
      return;
    }
    setBusy(true);
    try {
      await testStream(selectedStream.id);
      await refreshData();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Could not test stream.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStream() {
    if (!selectedStream) {
      return;
    }
    setBusy(true);
    try {
      if (selectedStream.active) {
        await stopStream(selectedStream.id);
      } else {
        await startStream(selectedStream.id);
      }
      await refreshData();
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteStream() {
    if (!selectedStream || !window.confirm(`Delete stream "${selectedStream.name}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteStream(selectedStream.id);
      setSelectedStreamId(null);
      await refreshData();
    } finally {
      setBusy(false);
    }
  }

  async function onCreateUser() {
    setBusy(true);
    setError(null);
    try {
      await createUser(newUserForm);
      setNewUserForm({ username: "", displayName: "", password: "", role: "viewer", locale: language });
      await refreshData(true);
    } catch (userError) {
      setError(userError instanceof Error ? userError.message : "Could not create user.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleUser(user: ApiUser) {
    setBusy(true);
    try {
      await updateUser(user.id, { disabled: !user.disabled });
      await refreshData(true);
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword(userId: string) {
    if (!passwordReset) {
      setError(translate(language, "passwordResetHint"));
      return;
    }
    setBusy(true);
    try {
      await resetPassword(userId, passwordReset);
      setPasswordReset("");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="shell auth-shell">Loading...</div>;
  }

  if (!authenticated) {
    return (
      <div className="shell auth-shell">
        <main className="auth-card">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">{translate(language, "appName")}</p>
          <h1>{translate(language, "loginTitle")}</h1>
          <p className="muted">{translate(language, "loginSubtitle")}</p>

          <form className="auth-form" onSubmit={onLogin}>
            <label>
              <span>{translate(language, "username")}</span>
              <input
                name="username"
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
              />
            </label>
            <label>
              <span>{translate(language, "password")}</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            {error ? <p className="banner error-banner">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {translate(language, "signIn")}
            </button>
          </form>

          <div className="inline-actions">
            <button className="text-button" type="button" onClick={() => setLanguage(language === "en" ? "de" : "en")}>
              {language === "en" ? "DE" : "EN"}
            </button>
            <button className="text-button" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              <ThemeIcon theme={theme} />
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark compact" aria-hidden="true">
            <span />
          </div>
          <div>
            <strong>{translate(language, "appName")}</strong>
            <p>{translate(language, "tagline")}</p>
          </div>
        </div>

        <nav className="nav">
          <a href="#dashboard">{translate(language, "dashboard")}</a>
          <a href="#streams">{translate(language, "streams")}</a>
          <a href="#users">{translate(language, "users")}</a>
          <a href="#settings">{translate(language, "settings")}</a>
        </nav>

        <div className="sidebar-panel">
          <p className="eyebrow">{translate(language, "overview")}</p>
          <strong>{currentUser?.displayName}</strong>
          <p className="muted">{currentUser?.role}</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{translate(language, "appName")}</p>
            <h1>{translate(language, "dashboard")}</h1>
          </div>
          <div className="topbar-actions">
            <button className="pill" type="button" onClick={() => setLanguage(language === "en" ? "de" : "en")}>
              {language === "en" ? "DE" : "EN"}
            </button>
            <button className="pill" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              <ThemeIcon theme={theme} />
            </button>
            <button className="pill" type="button" onClick={() => void onLogout()}>
              {translate(language, "signOut")}
            </button>
          </div>
        </header>

        {error ? <p className="banner error-banner">{error}</p> : null}

        <section className="stats-grid" id="dashboard" aria-label="Dashboard statistics">
          {stats.map((stat) => (
            <article key={stat.label} className="stat-card">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="panel panel-large" id="streams">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{translate(language, "streamList")}</p>
                <h2>{translate(language, "streams")}</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => setSelectedStreamId(null)}>
                {translate(language, "createStream")}
              </button>
            </div>

            <div className="stream-list">
              {streams.length === 0 ? <p className="muted">{translate(language, "noStreams")}</p> : null}
              {streams.map((stream) => (
                <button
                  key={stream.id}
                  className={`stream-row ${stream.id === selectedStreamId ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedStreamId(stream.id)}
                >
                  <div>
                    <strong>{stream.name}</strong>
                    <p>{stream.description}</p>
                  </div>
                  <div className="stream-meta">
                    <span className={statusClass(stream.status)}>{statusLabel(language, stream.status)}</span>
                    <small>{stream.active ? translate(language, "enabled") : translate(language, "disabled")}</small>
                  </div>
                </button>
              ))}
            </div>
          </article>

          <article className="panel panel-large">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{translate(language, "streamEditor")}</p>
                <h2>{selectedStream?.name ?? translate(language, "createStream")}</h2>
              </div>
              <span className={selectedStream ? statusClass(selectedStream.status) : "status unknown"}>
                {selectedStream ? formatTimestamp(selectedStream.lastCheckAt, language) : translate(language, "noSelection")}
              </span>
            </div>

            <form
              className="editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveStream();
              }}
            >
              <label>
                <span>Name</span>
                <input value={streamForm.name} onChange={(event) => setStreamForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  value={streamForm.description}
                  rows={3}
                  onChange={(event) => setStreamForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
              <label>
                <span>RTSP URL</span>
                <input value={streamForm.rtspUrl} onChange={(event) => setStreamForm((current) => ({ ...current, rtspUrl: event.target.value }))} />
              </label>
              <label>
                <span>{translate(language, "recorderNotes")}</span>
                <textarea
                  value={streamForm.recorderNotes}
                  rows={2}
                  onChange={(event) => setStreamForm((current) => ({ ...current, recorderNotes: event.target.value }))}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={streamForm.active}
                  onChange={(event) => setStreamForm((current) => ({ ...current, active: event.target.checked }))}
                />
                <span>{translate(language, "enabled")}</span>
              </label>

              <div className="split-grid">
                <label>
                  <span>{translate(language, "username")}</span>
                  <input value={streamForm.username} onChange={(event) => setStreamForm((current) => ({ ...current, username: event.target.value }))} />
                </label>
                <label>
                  <span>{translate(language, "password")}</span>
                  <input
                    type="password"
                    value={streamForm.password}
                    onChange={(event) => setStreamForm((current) => ({ ...current, password: event.target.value }))}
                  />
                </label>
              </div>

              <div className="split-grid">
                <label>
                  <span>ONVIF Name</span>
                  <input value={streamForm.onvifName} onChange={(event) => setStreamForm((current) => ({ ...current, onvifName: event.target.value }))} />
                </label>
                <label>
                  <span>ONVIF Model</span>
                  <input value={streamForm.onvifModel} onChange={(event) => setStreamForm((current) => ({ ...current, onvifModel: event.target.value }))} />
                </label>
              </div>

              <div className="editor-footer">
                <div>
                  <p className="eyebrow">{translate(language, "onvifEndpoint")}</p>
                  <strong>{selectedStream?.onvif.deviceServiceUrl ?? "/onvif/<stream>/device_service"}</strong>
                </div>
                <div className="button-row">
                  <button className="ghost-button" type="button" disabled={!selectedStream || busy} onClick={() => void onTestStream()}>
                    {translate(language, "testConnection")}
                  </button>
                  <button className="ghost-button" type="button" disabled={!selectedStream || busy} onClick={() => void onToggleStream()}>
                    {selectedStream?.active ? translate(language, "disabled") : translate(language, "enabled")}
                  </button>
                  <button className="ghost-button" type="button" disabled={!selectedStream || busy} onClick={() => void onDeleteStream()}>
                    {translate(language, "deleteStream")}
                  </button>
                  <button className="primary-button" type="submit" disabled={busy}>
                    {translate(language, "saveChanges")}
                  </button>
                </div>
              </div>
            </form>
          </article>
        </section>

        <section className="content-grid bottom-grid">
          <article className="panel" id="users">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{translate(language, "users")}</p>
                <h2>{translate(language, "adminAccess")}</h2>
              </div>
            </div>

            {currentUser?.role !== "admin" ? (
              <p className="muted">Read-only account.</p>
            ) : (
              <>
                <div className="user-list">
                  {users.length === 0 ? <p className="muted">{translate(language, "noUsers")}</p> : null}
                  {users.map((user) => (
                    <div key={user.id} className="user-row">
                      <div>
                        <strong>{user.displayName}</strong>
                        <p>{user.username}</p>
                      </div>
                      <div className="user-meta">
                        <span>{user.role}</span>
                        <small>{user.disabled ? translate(language, "disabled") : translate(language, "enabled")}</small>
                        <button className="text-button" type="button" onClick={() => void onToggleUser(user)}>
                          {user.disabled ? translate(language, "enabled") : translate(language, "disabled")}
                        </button>
                        <button className="text-button" type="button" onClick={() => void onResetPassword(user.id)}>
                          {translate(language, "resetPassword")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="stack-card">
                  <div className="split-grid">
                    <label>
                      <span>{translate(language, "username")}</span>
                      <input
                        value={newUserForm.username}
                        onChange={(event) => setNewUserForm((current) => ({ ...current, username: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{translate(language, "displayName")}</span>
                      <input
                        value={newUserForm.displayName}
                        onChange={(event) => setNewUserForm((current) => ({ ...current, displayName: event.target.value }))}
                      />
                    </label>
                  </div>

                  <div className="split-grid">
                    <label>
                      <span>{translate(language, "password")}</span>
                      <input
                        type="password"
                        value={newUserForm.password}
                        onChange={(event) => setNewUserForm((current) => ({ ...current, password: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{translate(language, "role")}</span>
                      <select
                        value={newUserForm.role}
                        onChange={(event) =>
                          setNewUserForm((current) => ({ ...current, role: event.target.value as "admin" | "viewer" }))
                        }
                      >
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                    </label>
                  </div>

                  <label>
                    <span>{translate(language, "language")}</span>
                    <select
                      value={newUserForm.locale}
                      onChange={(event) => setNewUserForm((current) => ({ ...current, locale: event.target.value as Language }))}
                    >
                      <option value="en">English</option>
                      <option value="de">Deutsch</option>
                    </select>
                  </label>

                  <label>
                    <span>{translate(language, "resetPassword")}</span>
                    <input value={passwordReset} onChange={(event) => setPasswordReset(event.target.value)} />
                  </label>

                  <button className="primary-button" type="button" onClick={() => void onCreateUser()} disabled={busy}>
                    {translate(language, "createUser")}
                  </button>
                </div>
              </>
            )}
          </article>

          <article className="panel" id="settings">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{translate(language, "settings")}</p>
                <h2>{translate(language, "system")}</h2>
              </div>
            </div>
            <div className="settings-card">
              <p>{translate(language, "footer")}</p>
              <p>
                {translate(language, "footerGitHub")}: <a href={githubUrl}>{githubUrl}</a>
              </p>
              <p>Version: {version}</p>
            </div>
          </article>
        </section>

        <footer className="footer">
          <span>{translate(language, "appName")}</span>
          <span>Copyright 2026</span>
          <a href={githubUrl}>GitHub</a>
          <span>v{version}</span>
        </footer>
      </main>
    </div>
  );
}
