import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../app";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
  });

  it("renders login and allows sign in", async () => {
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          appName: "UbiRSTP2ONVIF",
          version: "0.2.0",
          githubUrl: "https://github.com/itsh-neumeier/UbiRSTP2ONVIF",
          baseUrl: "http://localhost:8080",
          locale: "en",
          authenticated: false
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          user: {
            id: "1",
            username: "admin",
            displayName: "Admin",
            role: "admin",
            locale: "en",
            disabled: false,
            createdAt: "",
            updatedAt: ""
          }
        })
      )
      .mockImplementationOnce(() => jsonResponse({ streams: [] }))
      .mockImplementationOnce(() => jsonResponse({ users: [] }));

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("switches language and theme in login view", async () => {
    fetchMock.mockImplementationOnce(() =>
      jsonResponse({
        appName: "UbiRSTP2ONVIF",
        version: "0.2.0",
        githubUrl: "https://github.com/itsh-neumeier/UbiRSTP2ONVIF",
        baseUrl: "http://localhost:8080",
        locale: "en",
        authenticated: false
      })
    );

    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/language/i), "de");
    expect(screen.getByRole("heading", { name: /anmelden/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dark|light/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("shows error toasts temporarily on failed login", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockImplementationOnce(() =>
          jsonResponse({
            appName: "UbiRSTP2ONVIF",
            version: "0.2.0",
            githubUrl: "https://github.com/itsh-neumeier/UbiRSTP2ONVIF",
            baseUrl: "http://localhost:8080",
            locale: "en",
            authenticated: false
          })
        )
        .mockImplementationOnce(() => jsonResponse({ error: "Authentication required." }, 401));

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App />);

      await user.click(await screen.findByRole("button", { name: /sign in/i }));
      expect(await screen.findByText("Authentication required.")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(3300);

      await waitFor(() => {
        expect(screen.queryByText("Authentication required.")).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the stream editor with API data", async () => {
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          appName: "UbiRSTP2ONVIF",
          version: "0.2.0",
          githubUrl: "https://github.com/itsh-neumeier/UbiRSTP2ONVIF",
          baseUrl: "http://localhost:8080",
          locale: "en",
          authenticated: false
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          user: {
            id: "1",
            username: "admin",
            displayName: "Admin",
            role: "admin",
            locale: "en",
            disabled: false,
            createdAt: "",
            updatedAt: ""
          }
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          streams: [
            {
              id: "garage",
              name: "Garage",
              description: "Wide-angle",
              rtspUrl: "rtsp://camera.local/garage",
              active: true,
              status: "healthy",
              lastError: null,
              lastCheckAt: "2026-03-21T12:00:00.000Z",
              lastLatencyMs: 25,
              recorderNotes: "",
              hasStoredCredentials: false,
              onvif: {
                endpoint: "/onvif/garage/device_service",
                deviceServiceUrl: "http://localhost:8080/onvif/garage/device_service",
                mediaServiceUrl: "http://localhost:8080/onvif/garage/media_service",
                profileToken: "main",
                name: "Garage",
                manufacturer: "UbiRSTP2ONVIF",
                model: "Virtual RTSP Bridge",
                hardwareId: "virtual-bridge",
                firmwareVersion: "0.2.0"
              },
              createdAt: "",
              updatedAt: ""
            }
          ]
        })
      )
      .mockImplementationOnce(() => jsonResponse({ users: [] }));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("heading", { name: "Garage" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("rtsp://camera.local/garage")).toBeInTheDocument();
  });
});
