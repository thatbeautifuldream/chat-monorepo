import { pipeAgentUIStreamToResponse } from "ai"
import express, { type Request, type Response } from "express"
import { networkInterfaces } from "node:os"

import "dotenv/config"
import { chatAgent } from "./chat-agent.js"

const app = express()
app.use(express.json())

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

function applyCorsHeaders(request: Request, response: Response) {
  const requestOrigin = request.headers.origin
  const allowAnyOrigin = allowedOrigins.includes("*")

  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  )
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

  if (allowAnyOrigin) {
    response.setHeader("Access-Control-Allow-Origin", "*")
    return
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    response.setHeader("Access-Control-Allow-Origin", requestOrigin)
    response.setHeader("Vary", "Origin")
  }
}

app.use((request: Request, response: Response, next) => {
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

app.post("/chat", async (request: Request, response: Response) => {
  if (!Array.isArray(request.body?.messages)) {
    response.status(400).json({
      error: "Request body must include a messages array.",
    })
    return
  }

  const abortController = new AbortController()
  request.on("close", () => {
    abortController.abort()
  })

  await pipeAgentUIStreamToResponse({
    agent: chatAgent,
    abortSignal: abortController.signal,
    response,
    uiMessages: request.body.messages,
  })
})

app.use((_request: Request, response: Response) => {
  response.status(404).json({
    error: "Not found.",
  })
})

app.listen(port, host, () => {
  logServerReady()
})
