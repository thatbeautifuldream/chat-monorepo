import {
  DefaultChatTransport,
  generateId,
  isReasoningUIPart,
  isTextUIPart,
  isToolOrDynamicToolUIPart,
  readUIMessageStream,
  type UIMessage,
} from "ai"
import {
  ArrowUp,
  Bot,
  Globe,
  LoaderCircle,
  Sparkles,
  Square,
  User,
  WandSparkles,
} from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"

import type {
  AgentServerCapabilities,
  BrowserToolName,
  BrowserToolRequest,
  BrowserToolResult,
  CurrentTabContext,
  ExtensionRuntimeState,
} from "@workspace/browser-agent"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import {
  browserToolRiskLevels,
  browserToolExamples,
  createFallbackAgentServerState,
  getSupportedToolOptions,
  getToolLabel,
  isRiskyTool,
  resolveApiBaseUrl,
  sendRuntimeCommand,
  supportedBrowserTools,
  type RuntimeCommandResult,
} from "../../lib/runtime.js"

type Status = "ready" | "submitted" | "streaming" | "error"

const apiBaseUrl = resolveApiBaseUrl()

const transport = new DefaultChatTransport<UIMessage>({
  api: `${apiBaseUrl}/chat`,
})

const streamdownPlugins = {
  code,
  mermaid,
  math,
  cjk,
}

function getToolName(type: string, dynamicToolName?: string) {
  if (type === "dynamic-tool") {
    return dynamicToolName ?? "tool"
  }

  return type.replace(/^tool-/, "")
}

function getMessageText(message: UIMessage) {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("")
    .trim()
}

function getReasoningText(message: UIMessage) {
  return message.parts
    .filter(isReasoningUIPart)
    .map((part) => part.text)
    .join("")
    .trim()
}

function getToolSummary(message: UIMessage) {
  const toolParts = message.parts.filter(
    (part) => part.type === "dynamic-tool" || isToolOrDynamicToolUIPart(part)
  )

  if (toolParts.length === 0) {
    return null
  }

  return toolParts.map((part) => ({
    id: part.toolCallId,
    name: getToolName(
      part.type,
      part.type === "dynamic-tool" ? part.toolName : undefined
    ),
    state: part.state,
    input:
      "input" in part && part.input !== undefined
        ? JSON.stringify(part.input, null, 2)
        : null,
    output:
      "output" in part && part.output !== undefined
        ? JSON.stringify(part.output, null, 2)
        : null,
    error:
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : null,
  }))
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function isRuntimeStateResponse(
  response: RuntimeCommandResult
): response is ExtensionRuntimeState {
  return "supportedTools" in response
}

function isBrowserToolResult(
  response: RuntimeCommandResult
): response is BrowserToolResult {
  return "callId" in response && "toolName" in response
}

async function createBridgeSession(agentServer: AgentServerCapabilities) {
  const response = await fetch(agentServer.bridge.sessionEndpoint, {
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(`Bridge session request failed with ${response.status}`)
  }

  const data = (await response.json()) as { ok: boolean; sessionId: string }
  return data.sessionId
}

async function closeBridgeSessionById(
  agentServer: AgentServerCapabilities,
  sessionId: string
) {
  await fetch(`${agentServer.bridge.sessionEndpoint}/${sessionId}`, {
    method: "DELETE",
  }).catch(() => undefined)
}

async function pollBridgeToolCall(
  agentServer: AgentServerCapabilities,
  sessionId: string
) {
  const response = await fetch(
    `${agentServer.bridge.sessionEndpoint}/${sessionId}/tool-call`
  )

  if (response.status === 204) {
    return null
  }

  if (response.status === 404) {
    throw new Error("BRIDGE_SESSION_NOT_FOUND")
  }

  if (!response.ok) {
    throw new Error(`Bridge poll failed with ${response.status}`)
  }

  return (await response.json()) as BrowserToolRequest
}

async function submitBridgeToolResult(
  agentServer: AgentServerCapabilities,
  sessionId: string,
  result: BrowserToolResult
) {
  const response = await fetch(
    `${agentServer.bridge.sessionEndpoint}/${sessionId}/tool-result`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(result),
    }
  )

  if (response.status === 404) {
    throw new Error("BRIDGE_SESSION_NOT_FOUND")
  }

  if (!response.ok) {
    throw new Error(`Tool result submission failed with ${response.status}`)
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function App() {
  const chatIdRef = useRef(generateId())
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const bridgeSessionIdRef = useRef<string | null>(null)
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null)
  const agentServerRef = useRef<AgentServerCapabilities>(
    createFallbackAgentServerState(apiBaseUrl)
  )

  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [error, setError] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState<CurrentTabContext | null>(null)
  const [tabError, setTabError] = useState<string | null>(null)
  const [isRefreshingState, setIsRefreshingState] = useState(false)
  const [agentServer, setAgentServer] = useState<AgentServerCapabilities>(
    createFallbackAgentServerState(apiBaseUrl)
  )
  const [bridgeSessionId, setBridgeSessionId] = useState<string | null>(null)
  const [supportedTools, setSupportedTools] = useState<BrowserToolName[]>(
    supportedBrowserTools
  )
  const [selectedTool, setSelectedTool] = useState<BrowserToolName>(
    "get_page_metadata"
  )
  const [toolInput, setToolInput] = useState(
    formatJson(browserToolExamples.get_page_metadata)
  )
  const [toolResult, setToolResult] = useState<BrowserToolResult | null>(null)
  const [toolError, setToolError] = useState<string | null>(null)
  const [isRunningTool, setIsRunningTool] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<BrowserToolRequest | null>(
    null
  )

  const refreshRuntimeState = useEffectEvent(async () => {
    setIsRefreshingState(true)
    setTabError(null)

    try {
      const response = await sendRuntimeCommand({ type: "get-runtime-state" })

      if (!isRuntimeStateResponse(response)) {
        throw new Error(response.error)
      }

      setCurrentTab(response.currentTab)
      setAgentServer(response.agentServer)
      setSupportedTools(response.supportedTools)
      return response
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not read extension runtime state."

      setCurrentTab(null)
      setTabError(message)
      setAgentServer((previous) => ({
        ...previous,
        available: false,
        error: message,
      }))
      return null
    } finally {
      setIsRefreshingState(false)
    }
  })

  const ensureBridgeSession = useEffectEvent(async () => {
    if (bridgeSessionIdRef.current) {
      return bridgeSessionIdRef.current
    }

    if (!agentServer.available) {
      throw new Error("Agent server is unavailable.")
    }

    const sessionId = await createBridgeSession(agentServer)
    bridgeSessionIdRef.current = sessionId
    setBridgeSessionId(sessionId)
    return sessionId
  })

  const resetBridgeSession = useEffectEvent(async () => {
    const activeSessionId = bridgeSessionIdRef.current

    bridgeSessionIdRef.current = null
    setBridgeSessionId(null)

    if (activeSessionId) {
      await closeBridgeSessionById(agentServerRef.current, activeSessionId)
    }
  })

  const waitForApproval = useEffectEvent((request: BrowserToolRequest) => {
    return new Promise<boolean>((resolve) => {
      approvalResolverRef.current = resolve
      setPendingApproval(request)
    })
  })

  const executeToolRequest = useEffectEvent(
    async (request: BrowserToolRequest): Promise<BrowserToolResult> => {
      if (isRiskyTool(request.riskLevel)) {
        const approved = await waitForApproval(request)

        if (!approved) {
          return {
            callId: request.callId,
            toolName: request.toolName,
            ok: false,
            error: "User rejected the requested browser action.",
            currentTab,
          }
        }
      }

      const response = await sendRuntimeCommand({
        type: "execute-browser-tool",
        request,
      })

      if (isBrowserToolResult(response)) {
        setCurrentTab(response.currentTab ?? currentTab)
        return response
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: false,
        error:
          "error" in response
            ? response.error
            : "Unexpected extension response.",
        currentTab: response.currentTab,
      }
    }
  )

  useEffect(() => {
    agentServerRef.current = agentServer
  }, [agentServer])

  useEffect(() => {
    void refreshRuntimeState()

    const handleFocus = () => {
      void refreshRuntimeState()
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.removeEventListener("focus", handleFocus)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    })
  }, [messages])

  useEffect(() => {
    if (!agentServer.available || bridgeSessionIdRef.current) {
      return
    }

    let isCancelled = false

    void (async () => {
      try {
        const sessionId = await ensureBridgeSession()

        if (isCancelled) {
          await closeBridgeSessionById(agentServer, sessionId)
        }
      } catch (cause) {
        if (!isCancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not create a bridge session."
          )
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [agentServer.available, agentServer.bridge.sessionEndpoint])

  useEffect(() => {
    if (!bridgeSessionId || !agentServer.available) {
      return
    }

    let isCancelled = false

    void (async () => {
      while (!isCancelled) {
        try {
          const request = await pollBridgeToolCall(agentServer, bridgeSessionId)

          if (!request) {
            continue
          }

          const result = await executeToolRequest(request)
          await submitBridgeToolResult(agentServer, bridgeSessionId, result)
        } catch (cause) {
          if (!isCancelled) {
            const message =
              cause instanceof Error ? cause.message : "Bridge polling failed."

            if (message === "BRIDGE_SESSION_NOT_FOUND") {
              await resetBridgeSession()

              try {
                await ensureBridgeSession()
                setError("Bridge session was refreshed after it became invalid.")
              } catch (bridgeError) {
                setError(
                  bridgeError instanceof Error
                    ? bridgeError.message
                    : "Could not recreate the bridge session."
                )
                await delay(1000)
              }

              continue
            }

            setError(message)
            await delay(500)
          }
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [agentServer, bridgeSessionId])

  useEffect(() => {
    return () => {
      const activeSessionId = bridgeSessionIdRef.current

      if (activeSessionId) {
        bridgeSessionIdRef.current = null
        void closeBridgeSessionById(agentServerRef.current, activeSessionId)
      }
    }
  }, [])

  useEffect(() => {
    setToolInput(formatJson(browserToolExamples[selectedTool]))
  }, [selectedTool])

  async function sendMessage() {
    const trimmedInput = input.trim()

    if (!trimmedInput || status === "submitted" || status === "streaming") {
      return
    }

    if (!agentServer.chat.available) {
      setError("Agent server is unavailable. Start the API runtime to enable chat.")
      return
    }

    const runtimeState = await refreshRuntimeState()
    const activeTab = runtimeState?.currentTab ?? currentTab
    const currentBridgeSessionId = await ensureBridgeSession()
    const userMessage: UIMessage = {
      id: generateId(),
      role: "user",
      parts: [{ type: "text", text: trimmedInput }],
    }

    const nextMessages = [...messages, userMessage]
    const abortController = new AbortController()

    abortControllerRef.current = abortController
    setMessages(nextMessages)
    setInput("")
    setError(null)
    setStatus("submitted")

    try {
      const stream = await transport.sendMessages({
        chatId: chatIdRef.current,
        messages: nextMessages,
        abortSignal: abortController.signal,
        trigger: "submit-message",
        messageId: userMessage.id,
        body: {
          context: {
            currentTab: activeTab ?? undefined,
            extension: {
              supportedTools,
              bridgeSessionId: currentBridgeSessionId,
            },
          },
        },
      })

      for await (const message of readUIMessageStream<UIMessage>({ stream })) {
        setStatus("streaming")
        setMessages((currentMessages) => {
          const lastMessage = currentMessages.at(-1)

          if (lastMessage?.id === message.id) {
            return [...currentMessages.slice(0, -1), message]
          }

          return [...currentMessages, message]
        })
      }

      setStatus("ready")
    } catch (cause) {
      if (abortController.signal.aborted) {
        setStatus("ready")
        return
      }

      setStatus("error")
      setInput(trimmedInput)
      setError(
        cause instanceof Error ? cause.message : "Failed to stream response."
      )
    } finally {
      abortControllerRef.current = null
    }
  }

  async function runManualTool() {
    setIsRunningTool(true)
    setToolError(null)
    setToolResult(null)

    try {
      const parsedInput = JSON.parse(toolInput) as Record<string, unknown>
      const response = await executeToolRequest({
        callId: crypto.randomUUID(),
        toolName: selectedTool,
        input: parsedInput,
        riskLevel: browserToolRiskLevels[selectedTool],
        reason: "Manual debug tool execution from the side panel.",
      })

      if (!response.ok) {
        setToolError(response.error ?? "Tool execution failed.")
        return
      }

      setToolResult(response)
    } catch (cause) {
      setToolError(
        cause instanceof Error ? cause.message : "Tool execution failed."
      )
    } finally {
      setIsRunningTool(false)
    }
  }

  function stopStreaming() {
    abortControllerRef.current?.abort()
  }

  function resolveApproval(approved: boolean) {
    const resolver = approvalResolverRef.current

    approvalResolverRef.current = null
    setPendingApproval(null)
    resolver?.(approved)
  }

  const latestMessageId = messages.at(-1)?.id ?? null

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.18),_transparent_42%),linear-gradient(180deg,_#f7f7f3_0%,_#eeece3_100%)] text-sm text-slate-900">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-900/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(245,240,226,0.68))] px-4 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Badge className="w-fit gap-1.5 border-slate-900/10 bg-slate-900 text-white">
                <Sparkles className="size-3" />
                Browser Agent
              </Badge>
              <div>
                <h1 className="font-heading text-[1.1rem] font-semibold tracking-[0.01em]">
                  Sidebar tool loop
                </h1>
                <p className="mt-1 max-w-sm text-xs leading-5 text-slate-600">
                  The API streams the agent, and the extension executes browser tools
                  through background plus content-script message passing.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshRuntimeState()}
              disabled={isRefreshingState}
            >
              {isRefreshingState ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Globe className="size-3.5" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="rounded-[1.35rem] border border-slate-900/10 bg-white/75 p-3 shadow-[0_8px_32px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  Active tab
                </p>
                <Badge
                  variant={
                    tabError
                      ? "destructive"
                      : currentTab?.url
                        ? "success"
                        : "secondary"
                  }
                >
                  {tabError ? "Unavailable" : currentTab?.url ? "Attached" : "Idle"}
                </Badge>
              </div>

              <div className="mt-2 space-y-1">
                <p className="line-clamp-1 font-medium text-slate-900">
                  {currentTab?.title ?? "No active tab metadata yet"}
                </p>
                <p className="line-clamp-2 break-all font-mono text-[11px] leading-5 text-slate-500">
                  {currentTab?.url ?? tabError ?? "Open the side panel from a normal tab to attach."}
                </p>
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-slate-900/10 bg-white/75 p-3 shadow-[0_8px_32px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  Agent server
                </p>
                <Badge variant={agentServer.available ? "success" : "secondary"}>
                  {agentServer.available ? "Connected" : "Offline"}
                </Badge>
              </div>

              <div className="mt-2 space-y-1 text-[12px] leading-5 text-slate-600">
                <p>
                  {agentServer.available
                    ? "Streaming chat and extension-backed browser tools are available."
                    : "The API runtime is offline. Direct manual browser tools still work in the extension."}
                </p>
                <p className="font-mono text-[11px] text-slate-500">
                  {agentServer.endpoint}
                </p>
                {agentServer.error ? (
                  <p className="text-destructive">{agentServer.error}</p>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            {pendingApproval ? (
              <article className="rounded-[1.75rem] border border-amber-900/15 bg-[linear-gradient(180deg,rgba(255,248,235,0.98),rgba(255,241,214,0.95))] p-4 shadow-[0_16px_48px_rgba(146,64,14,0.08)]">
                <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-amber-800 uppercase">
                  <div className="flex size-7 items-center justify-center rounded-full border border-amber-900/10 bg-white text-amber-700">
                    <WandSparkles className="size-3.5" />
                  </div>
                  Approval required
                </div>

                <div className="mt-3 space-y-3">
                  <p className="text-[13px] leading-6 text-slate-800">
                    <span className="font-medium">
                      {getToolLabel(pendingApproval.toolName)}
                    </span>{" "}
                    wants to run on the current page.
                  </p>
                  <p className="text-[12px] leading-5 text-slate-600">
                    {pendingApproval.reason}
                  </p>
                  <pre className="overflow-x-auto rounded-2xl border border-amber-900/10 bg-white px-3 py-2 font-mono text-[11px] leading-5 text-slate-600 whitespace-pre-wrap">
                    {formatJson(pendingApproval.input)}
                  </pre>
                  <div className="flex gap-2">
                    <Button onClick={() => resolveApproval(true)}>Approve</Button>
                    <Button variant="outline" onClick={() => resolveApproval(false)}>
                      Reject
                    </Button>
                  </div>
                </div>
              </article>
            ) : null}

            <article className="rounded-[1.75rem] border border-slate-900/10 bg-white/88 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                <div className="flex size-7 items-center justify-center rounded-full border border-slate-900/10 bg-slate-900 text-white">
                  <WandSparkles className="size-3.5" />
                </div>
                Tool debug panel
              </div>

              <div className="mt-3 grid gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    Tool
                  </span>
                  <select
                    value={selectedTool}
                    onChange={(event) =>
                      setSelectedTool(event.target.value as BrowserToolName)
                    }
                    className="w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-2 text-sm outline-none"
                  >
                    {getSupportedToolOptions().map((toolName) => (
                      <option key={toolName} value={toolName}>
                        {toolName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    Tool input
                  </span>
                  <Textarea
                    value={toolInput}
                    onChange={(event) => setToolInput(event.target.value)}
                    className="min-h-28 resize-none rounded-2xl border border-slate-900/10 bg-white font-mono text-[12px]"
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] leading-5 text-slate-600">
                    Execute a typed browser tool directly through the extension for
                    debugging and page inspection.
                  </p>
                  <Button onClick={() => void runManualTool()} disabled={isRunningTool}>
                    {isRunningTool ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <WandSparkles className="size-3.5" />
                    )}
                    Run
                  </Button>
                </div>

                {toolError ? (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] leading-5 text-destructive">
                    {toolError}
                  </div>
                ) : null}

                {toolResult ? (
                  <pre className="overflow-x-auto rounded-2xl border border-slate-900/10 bg-slate-50 px-3 py-2 font-mono text-[11px] leading-5 text-slate-600 whitespace-pre-wrap">
                    {formatJson(toolResult.data)}
                  </pre>
                ) : null}
              </div>
            </article>

            {messages.length === 0 ? (
              <div className="rounded-[1.75rem] border border-dashed border-slate-900/15 bg-white/70 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
                <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
                  Suggested prompts
                </p>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  <p>Summarize the current page and tell me what it is for.</p>
                  <p>Find all prices on this page and return them as a table.</p>
                  <p>Inspect the form on this page and tell me what fields you can fill.</p>
                </div>
              </div>
            ) : null}

            {messages.map((message) => {
              const text = getMessageText(message)
              const reasoning = getReasoningText(message)
              const tools = getToolSummary(message)
              const shouldAnimateAssistantText =
                message.role === "assistant" &&
                message.id === latestMessageId &&
                (status === "submitted" || status === "streaming")

              return (
                <article
                  key={message.id}
                  className={cn(
                    "rounded-[1.75rem] border p-4 shadow-[0_16px_48px_rgba(15,23,42,0.06)]",
                    message.role === "assistant"
                      ? "border-slate-900/10 bg-white/88"
                      : "ml-8 border-amber-900/10 bg-[linear-gradient(180deg,rgba(255,244,221,0.95),rgba(250,232,198,0.88))]"
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    <div
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full border",
                        message.role === "assistant"
                          ? "border-slate-900/10 bg-slate-900 text-white"
                          : "border-amber-900/10 bg-white text-amber-700"
                      )}
                    >
                      {message.role === "assistant" ? (
                        <Bot className="size-3.5" />
                      ) : (
                        <User className="size-3.5" />
                      )}
                    </div>
                    {message.role === "assistant" ? "Assistant" : "You"}
                  </div>

                  <div className="mt-3 space-y-3">
                    {text ? (
                      message.role === "assistant" ? (
                        <div className="text-[13px] text-slate-800">
                          <Streamdown
                            animated
                            isAnimating={shouldAnimateAssistantText}
                            plugins={streamdownPlugins}
                          >
                            {text}
                          </Streamdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-800">
                          {text}
                        </p>
                      )
                    ) : null}

                    {reasoning ? (
                      <div className="rounded-2xl border border-slate-900/10 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                          Reasoning
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-slate-600">
                          {reasoning}
                        </p>
                      </div>
                    ) : null}

                    {tools?.map((tool) => (
                      <div
                        key={tool.id}
                        className="rounded-2xl border border-slate-900/10 bg-slate-50/90 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-[11px] text-slate-700">
                            {tool.name}
                          </p>
                          <Badge variant="secondary">{tool.state}</Badge>
                        </div>

                        {tool.input ? (
                          <pre className="mt-2 overflow-x-auto rounded-xl bg-white px-3 py-2 font-mono text-[11px] leading-5 text-slate-600 whitespace-pre-wrap">
                            {tool.input}
                          </pre>
                        ) : null}

                        {tool.output ? (
                          <pre className="mt-2 overflow-x-auto rounded-xl bg-white px-3 py-2 font-mono text-[11px] leading-5 text-slate-600 whitespace-pre-wrap">
                            {tool.output}
                          </pre>
                        ) : null}

                        {tool.error ? (
                          <p className="mt-2 text-[12px] leading-5 text-destructive">
                            {tool.error}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </article>
              )
            })}

            <div ref={messagesEndRef} />
          </div>
        </section>

        <footer className="border-t border-slate-900/10 bg-white/75 px-4 py-4 backdrop-blur">
          {error ? (
            <div className="mb-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] leading-5 text-destructive">
              {error}
            </div>
          ) : null}

          {!agentServer.chat.available ? (
            <div className="mb-3 rounded-2xl border border-amber-900/20 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-700">
              Start the API runtime at <span className="font-mono">{apiBaseUrl}</span> to
              enable streamed chat and browser tool looping.
            </div>
          ) : null}

          <div className="rounded-[1.75rem] border border-slate-900/10 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                agentServer.chat.available
                  ? "Ask the sidebar agent to inspect or act on the current page..."
                  : "API runtime offline. Use the tool debug panel above."
              }
              disabled={!agentServer.chat.available}
              className="min-h-28 resize-none border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
            />

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-900/10 pt-3">
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  Chat endpoint
                </p>
                <p className="font-mono text-[11px] leading-5 text-slate-500">
                  {agentServer.chat.endpoint}
                </p>
                <p className="font-mono text-[11px] leading-5 text-slate-500">
                  Bridge: {bridgeSessionId ?? "pending"}
                </p>
              </div>

              {status === "submitted" || status === "streaming" ? (
                <Button variant="outline" onClick={stopStreaming}>
                  <Square className="size-3.5 fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || !agentServer.chat.available}
                >
                  <ArrowUp className="size-3.5" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </main>
  )
}
