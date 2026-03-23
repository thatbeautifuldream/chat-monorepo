import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

type HealthResponse = {
  ok?: boolean
}

type Status = "loading" | "success" | "error"

const apiBaseUrl =
  import.meta.env.WXT_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8080"

export function App() {
  const [status, setStatus] = useState<Status>("loading")
  const [payload, setPayload] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const endpoint = `${apiBaseUrl}/health`

  async function loadHealth() {
    setStatus("loading")
    setError(null)

    try {
      const response = await fetch(endpoint)

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const data: HealthResponse = await response.json()
      setPayload(data)
      setStatus("success")
    } catch (cause) {
      setPayload(null)
      setError(cause instanceof Error ? cause.message : "Unknown error")
      setStatus("error")
    }
  }

  useEffect(() => {
    void loadHealth()
    // The endpoint is the only input to the initial health check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint])

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.05),_transparent_55%),linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--background),var(--muted)_45%))] p-4 text-sm">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col justify-between rounded-3xl border border-border/80 bg-background/90 p-4 shadow-sm backdrop-blur">
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
              Side Panel
            </p>
            <h1 className="text-xl font-semibold">Backend connection</h1>
            <p className="text-sm text-muted-foreground">
              This extension is using the shared workspace UI package and
              calling the API app health endpoint.
            </p>
          </div>

          <section className="rounded-2xl border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              API endpoint
            </p>
            <p className="mt-2 font-mono text-xs break-all">{endpoint}</p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Health status
                </p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    status === "success" && "text-foreground",
                    status === "loading" && "text-muted-foreground",
                    status === "error" && "text-destructive"
                  )}
                >
                  {status === "loading" && "Checking backend..."}
                  {status === "success" &&
                    (payload?.ok ? "Healthy" : "Unexpected response")}
                  {status === "error" && "Request failed"}
                </p>
              </div>

              <div
                className={cn(
                  "size-3 rounded-full border",
                  status === "loading" && "border-border bg-muted",
                  status === "success" &&
                    "border-emerald-600/30 bg-emerald-500",
                  status === "error" && "border-destructive/30 bg-destructive"
                )}
              />
            </div>

            <div className="mt-4 rounded-xl bg-muted/50 p-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Response
              </p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-5 whitespace-pre-wrap">
                {status === "success"
                  ? JSON.stringify(payload, null, 2)
                  : status === "error"
                    ? error
                    : "Waiting for response..."}
              </pre>
            </div>
          </section>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Configure with <code>WXT_API_BASE_URL</code>.
          </p>
          <Button onClick={() => void loadHealth()}>Retry</Button>
        </div>
      </div>
    </main>
  )
}
