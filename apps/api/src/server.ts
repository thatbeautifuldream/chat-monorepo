import {
  browserToolResultSchema,
  extensionChatContextSchema,
  type ExtensionChatContext,
} from "@workspace/browser-agent"
import { createAgentUIStream, pipeUIMessageStreamToResponse } from "ai"
import express, { type Request, type Response } from "express"
import { networkInterfaces } from "node:os"

import "dotenv/config"
import {
  closeBridgeSession,
  createBridgeSession,
  submitBrowserToolResult,
  waitForPendingToolCall,
} from "./bridge.js"
import { createChatAgent } from "./chat-agent.js"
import { logError, logInfo, logWarn } from "./logger.js"

const app = express()
app.use(express.json())

process.on("unhandledRejection", (reason) => {
  logError("process", "Unhandled promise rejection", reason)
})

process.on("uncaughtException", (error) => {
  logError("process", "Uncaught exception", error)
})

const startedAt = Date.now()
const host = process.env.HOST ?? "0.0.0.0"
const port = Number(process.env.PORT ?? 8080)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

function getNetworkUrl() {
  const interfaces = networkInterfaces()

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return `http://${entry.address}:${port}`
      }
    }
  }

  return null
}

function logServerReady() {
  const networkUrl = getNetworkUrl()
  const readyInMs = Date.now() - startedAt

  console.log("▲ API 0.0.1 (Express)")
  console.log(`- Local:        http://localhost:${port}`)

  if (networkUrl) {
    console.log(`- Network:      ${networkUrl}`)
  }

  console.log("")
  console.log("✓ Starting...")
  console.log(`✓ Ready in ${readyInMs}ms`)
}

function waitForResponseCompletion(response: Response) {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      response.off("finish", onFinish)
      response.off("close", onClose)
    }

    const onFinish = () => {
      cleanup()
      resolve()
    }

    const onClose = () => {
      cleanup()
      resolve()
    }

    response.once("finish", onFinish)
    response.once("close", onClose)
  })
}

function applyCorsHeaders(request: Request, response: Response) {
  const requestOrigin = request.headers.origin
  const allowAnyOrigin = allowedOrigins.includes("*")
  const requestsPrivateNetworkAccess =
    request.headers["access-control-request-private-network"] === "true"

  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  )
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

  if (requestsPrivateNetworkAccess) {
    response.setHeader("Access-Control-Allow-Private-Network", "true")
  }

  if (allowAnyOrigin) {
    if (requestOrigin) {
      response.setHeader("Access-Control-Allow-Origin", requestOrigin)
      response.setHeader("Vary", "Origin")
      return
    }

    response.setHeader("Access-Control-Allow-Origin", "*")
    return
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    response.setHeader("Access-Control-Allow-Origin", requestOrigin)
    response.setHeader("Vary", "Origin")
  }
}

app.use((request: Request, response: Response, next) => {
  const startedAt = Date.now()
  const scope = `http ${request.method} ${request.path}`

  logInfo(scope, "Incoming request", {
    origin: request.headers.origin ?? null,
    contentType: request.headers["content-type"] ?? null,
  })

  response.on("finish", () => {
    logInfo(scope, "Request finished", {
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })

  response.on("close", () => {
    if (!response.writableEnded) {
      logWarn(scope, "Connection closed before response completed", {
        durationMs: Date.now() - startedAt,
      })
    }
  })

  applyCorsHeaders(request, response)

  if (request.method === "OPTIONS") {
    response.status(204).end()
    return
  }

  next()
})

app.get("/health", (_request: Request, response: Response) => {
  response.json({ ok: true })
})

app.get("/capabilities", (_request: Request, response: Response) => {
  response.json({
    available: true,
    endpoint: `http://127.0.0.1:${port}`,
    chat: {
      available: true,
      endpoint: `http://127.0.0.1:${port}/chat`,
    },
    bridge: {
      available: true,
      sessionEndpoint: `http://127.0.0.1:${port}/bridge/session`,
      pollEndpoint: `http://127.0.0.1:${port}/bridge/session/:sessionId/tool-call`,
    },
    automation: {
      supportsStreamingChat: true,
      supportsExtensionToolLoop: true,
      supportsChromeDevtoolsMcp: false,
    },
  })
})

app.post("/bridge/session", (_request: Request, response: Response) => {
  response.json({
    ok: true,
    sessionId: createBridgeSession(),
  })
})

app.get(
  "/bridge/session/:sessionId/tool-call",
  async (request: Request, response: Response) => {
    const sessionId =
      typeof request.params.sessionId === "string"
        ? request.params.sessionId
        : null

    if (!sessionId) {
      response.status(400).json({
        error: "A bridge session id is required.",
      })
      return
    }

    try {
      const toolCall = await waitForPendingToolCall(sessionId)

      if (!toolCall) {
        response.status(204).end()
        return
      }

      response.json(toolCall)
    } catch (error) {
      response.status(404).json({
        error: error instanceof Error ? error.message : "Bridge session not found.",
      })
    }
  }
)

app.post(
  "/bridge/session/:sessionId/tool-result",
  (request: Request, response: Response) => {
    const sessionId =
      typeof request.params.sessionId === "string"
        ? request.params.sessionId
        : null

    if (!sessionId) {
      response.status(400).json({
        error: "A bridge session id is required.",
      })
      return
    }

    const parsedResult = browserToolResultSchema.safeParse(request.body)

    if (!parsedResult.success) {
      response.status(400).json({
        error: "Invalid browser tool result payload.",
      })
      return
    }

    try {
      submitBrowserToolResult(sessionId, parsedResult.data)
      response.json({ ok: true })
    } catch (error) {
      response.status(404).json({
        error:
          error instanceof Error ? error.message : "Could not accept tool result.",
      })
    }
  }
)

app.delete("/bridge/session/:sessionId", (request: Request, response: Response) => {
  const sessionId =
    typeof request.params.sessionId === "string"
      ? request.params.sessionId
      : null

  response.json({
    ok: sessionId ? closeBridgeSession(sessionId) : false,
  })
})

app.post("/chat", async (request: Request, response: Response) => {
  const scope = "chat"

  if (!Array.isArray(request.body?.messages)) {
    logWarn(scope, "Rejected request without messages array")
    response.status(400).json({
      error: "Request body must include a messages array.",
    })
    return
  }

  const abortController = new AbortController()
  let streamCompleted = false
  const messageCount = request.body.messages.length

  const abortStream = (reason: string) => {
    if (abortController.signal.aborted) {
      return
    }

    abortController.abort()
    logWarn(scope, reason, {
      messageCount,
    })
  }

  request.once("aborted", () => {
    abortStream("Request aborted before completion")
  })

  response.once("close", () => {
    if (!streamCompleted) {
      abortStream("Response closed before stream completed")
    }
  })

  const parsedContext = extensionChatContextSchema.safeParse(request.body?.context)

  if (!parsedContext.success) {
    response.status(400).json({
      error: "Request body must include a valid extension chat context.",
    })
    return
  }

  const context: ExtensionChatContext = parsedContext.data

  logInfo(scope, "Starting chat request", {
    messageCount,
    currentTab: context?.currentTab ?? null,
    bridgeSessionId: context.extension.bridgeSessionId,
  })

  try {
    const agentSetup = await createChatAgent(context)

    logInfo(scope, "Streaming response")

    const stream = await createAgentUIStream({
      agent: agentSetup.agent,
      abortSignal: abortController.signal,
      uiMessages: request.body.messages,
    })

    pipeUIMessageStreamToResponse({
      response,
      stream,
    })

    await waitForResponseCompletion(response)

    streamCompleted = true
    logInfo(scope, "Finished streaming response")
  } catch (error) {
    logError(scope, "Failed to handle chat request", error)

    if (!response.headersSent) {
      response.status(500).json({
        error: "Failed to generate chat response.",
      })
    }
  }
})

app.use((_request: Request, response: Response) => {
  response.status(404).json({
    error: "Not found.",
  })
})

app.listen(port, host, () => {
  logInfo("process", "API server listening", {
    host,
    port,
    pid: process.pid,
  })
  logServerReady()
})
