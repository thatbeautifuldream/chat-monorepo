import { randomUUID } from "node:crypto"

import type {
  BrowserToolName,
  BrowserToolRequest,
  BrowserToolResult,
  ToolRiskLevel,
} from "@workspace/browser-agent"

type PendingToolCall = {
  request: BrowserToolRequest
  delivered: boolean
  resolve: (result: BrowserToolResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type BridgeSession = {
  id: string
  queue: PendingToolCall[]
  waiters: Set<() => void>
  updatedAt: number
}

const sessions = new Map<string, BridgeSession>()

const TOOL_RESULT_TIMEOUT_MS = 120_000
const TOOL_POLL_TIMEOUT_MS = 25_000
const SESSION_TTL_MS = 15 * 60_000

function touchSession(session: BridgeSession) {
  session.updatedAt = Date.now()
}

function notifyWaiters(session: BridgeSession) {
  for (const waiter of session.waiters) {
    waiter()
  }
}

function rejectPendingCall(pending: PendingToolCall, message: string) {
  clearTimeout(pending.timeout)
  pending.reject(new Error(message))
}

function cleanupExpiredSessions() {
  const now = Date.now()

  for (const [sessionId, session] of sessions) {
    if (now - session.updatedAt <= SESSION_TTL_MS) {
      continue
    }

    for (const pending of session.queue) {
      rejectPendingCall(pending, "Bridge session expired before tool execution completed.")
    }

    sessions.delete(sessionId)
  }
}

function getSession(sessionId: string) {
  cleanupExpiredSessions()
  return sessions.get(sessionId) ?? null
}

export function createBridgeSession() {
  const sessionId = randomUUID()

  sessions.set(sessionId, {
    id: sessionId,
    queue: [],
    waiters: new Set(),
    updatedAt: Date.now(),
  })

  return sessionId
}

export function closeBridgeSession(sessionId: string) {
  const session = sessions.get(sessionId)

  if (!session) {
    return false
  }

  for (const pending of session.queue) {
    rejectPendingCall(
      pending,
      "Bridge session was closed before tool execution completed."
    )
  }

  sessions.delete(sessionId)
  return true
}

export async function requestBrowserTool(args: {
  sessionId: string
  toolName: BrowserToolName
  input: Record<string, unknown>
  riskLevel: ToolRiskLevel
  reason: string
}) {
  const session = getSession(args.sessionId)

  if (!session) {
    throw new Error("Bridge session not found.")
  }

  touchSession(session)

  return new Promise<BrowserToolResult>((resolve, reject) => {
    const request: BrowserToolRequest = {
      callId: randomUUID(),
      toolName: args.toolName,
      input: args.input,
      riskLevel: args.riskLevel,
      reason: args.reason,
    }

    const pending: PendingToolCall = {
      request,
      delivered: false,
      resolve: (result) => {
        clearTimeout(pending.timeout)
        resolve(result)
      },
      reject: (error) => {
        clearTimeout(pending.timeout)
        reject(error)
      },
      timeout: setTimeout(() => {
        const activeSession = sessions.get(args.sessionId)

        if (!activeSession) {
          reject(new Error("Bridge session not found."))
          return
        }

        activeSession.queue = activeSession.queue.filter(
          (item) => item.request.callId !== request.callId
        )
        reject(
          new Error(
            `Timed out waiting for extension tool result for ${request.toolName}.`
          )
        )
      }, TOOL_RESULT_TIMEOUT_MS),
    }

    session.queue.push(pending)
    notifyWaiters(session)
  })
}

export async function waitForPendingToolCall(sessionId: string) {
  const session = getSession(sessionId)

  if (!session) {
    throw new Error("Bridge session not found.")
  }

  touchSession(session)

  const getPendingRequest = () => {
    const nextPending = session.queue.find((item) => !item.delivered)

    if (!nextPending) {
      return null
    }

    nextPending.delivered = true
    return nextPending.request
  }

  const immediate = getPendingRequest()

  if (immediate) {
    return immediate
  }

  return new Promise<BrowserToolRequest | null>((resolve) => {
    const timeout = setTimeout(() => {
      session.waiters.delete(onWake)
      resolve(null)
    }, TOOL_POLL_TIMEOUT_MS)

    const onWake = () => {
      const pendingRequest = getPendingRequest()

      if (!pendingRequest) {
        return
      }

      clearTimeout(timeout)
      session.waiters.delete(onWake)
      resolve(pendingRequest)
    }

    session.waiters.add(onWake)
  })
}

export function submitBrowserToolResult(
  sessionId: string,
  result: BrowserToolResult
) {
  const session = getSession(sessionId)

  if (!session) {
    throw new Error("Bridge session not found.")
  }

  touchSession(session)

  const pending = session.queue.find(
    (item) => item.request.callId === result.callId
  )

  if (!pending) {
    throw new Error("No matching pending tool call was found.")
  }

  session.queue = session.queue.filter(
    (item) => item.request.callId !== result.callId
  )
  pending.resolve(result)
}
