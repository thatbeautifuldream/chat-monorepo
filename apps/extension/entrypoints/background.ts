import type {
  AgentServerCapabilities,
  BrowserToolRequest,
  BrowserToolResult,
  CurrentTabContext,
  ExtensionRuntimeState,
  RuntimeCommand,
  RuntimeCommandError,
  RuntimeCommandResult,
} from "@workspace/browser-agent"
import { supportedBrowserTools } from "@workspace/browser-agent"
import { defineBackground } from "wxt/utils/define-background"

import {
  createFallbackAgentServerState,
  resolveApiBaseUrl,
} from "../lib/runtime.js"

const apiBaseUrl = resolveApiBaseUrl()

type ContentScriptCommand = {
  type: "browser-tool-request"
  request: BrowserToolRequest
}

function isRestrictedTabUrl(url?: string) {
  if (!url) {
    return true
  }

  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  )
}

function createCommandError(
  error: string,
  currentTab: CurrentTabContext | null,
  agentServer: AgentServerCapabilities
): RuntimeCommandError {
  return {
    ok: false,
    error,
    currentTab,
    agentServer,
  }
}

async function getCurrentTabContext(): Promise<CurrentTabContext | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })

  if (!tab) {
    return null
  }

  return {
    id: tab.id,
    title: tab.title ?? undefined,
    url: tab.url ?? undefined,
  }
}

async function getAgentServerCapabilities(): Promise<AgentServerCapabilities> {
  try {
    const response = await fetch(`${apiBaseUrl}/capabilities`)

    if (!response.ok) {
      throw new Error(`Capability request failed with ${response.status}`)
    }

    return (await response.json()) as AgentServerCapabilities
  } catch (error) {
    return {
      ...createFallbackAgentServerState(apiBaseUrl),
      error:
        error instanceof Error
          ? error.message
          : "Agent server is unavailable.",
    }
  }
}

async function getRuntimeState(): Promise<ExtensionRuntimeState> {
  const [currentTab, agentServer] = await Promise.all([
    getCurrentTabContext(),
    getAgentServerCapabilities(),
  ])

  return {
    ok: true,
    currentTab,
    agentServer,
    supportedTools: supportedBrowserTools,
  }
}

async function requireActiveTab() {
  const currentTab = await getCurrentTabContext()

  if (!currentTab?.id) {
    throw new Error("No active tab is available.")
  }

  if (isRestrictedTabUrl(currentTab.url)) {
    throw new Error("This page is restricted and cannot be controlled by the extension.")
  }

  return currentTab
}

async function forwardToolToContentScript(
  tabId: number,
  request: BrowserToolRequest
): Promise<BrowserToolResult> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: "browser-tool-request",
        request,
      } satisfies ContentScriptCommand,
      (response: BrowserToolResult | undefined) => {
        const runtimeError = chrome.runtime.lastError

        if (runtimeError) {
          reject(new Error(runtimeError.message))
          return
        }

        if (!response) {
          reject(new Error("Content script did not return a tool result."))
          return
        }

        resolve(response)
      }
    )
  })
}

async function navigateTab(url: string): Promise<RuntimeCommandResult> {
  const runtimeState = await getRuntimeState()

  if (!url.trim()) {
    return createCommandError(
      "A URL is required.",
      runtimeState.currentTab,
      runtimeState.agentServer
    )
  }

  if (runtimeState.currentTab?.id) {
    await chrome.tabs.update(runtimeState.currentTab.id, { url })
  } else {
    await chrome.tabs.create({ url })
  }

  const nextState = await getRuntimeState()

  return {
    callId: crypto.randomUUID(),
    toolName: "navigate_tab",
    ok: true,
    data: {
      navigatedTo: url,
    },
    currentTab: nextState.currentTab,
  }
}

async function executeBrowserTool(
  request: BrowserToolRequest
): Promise<RuntimeCommandResult> {
  const runtimeState = await getRuntimeState()

  try {
    if (request.toolName === "navigate_tab") {
      const url =
        typeof request.input.url === "string" ? request.input.url : undefined

      if (!url) {
        throw new Error("navigate_tab requires a URL.")
      }

      const result = await navigateTab(url)

      if ("ok" in result && result.ok === false) {
        return result
      }

      return {
        ...(result as BrowserToolResult),
        callId: request.callId,
        toolName: request.toolName,
      }
    }

    const currentTab = await requireActiveTab()
    const result = await forwardToolToContentScript(currentTab.id!, request)

    return {
      ...result,
      currentTab,
    }
  } catch (error) {
    return {
      callId: request.callId,
      toolName: request.toolName,
      ok: false,
      error:
        error instanceof Error ? error.message : "Browser tool execution failed.",
      currentTab: runtimeState.currentTab,
    }
  }
}

export default defineBackground(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => {
        console.error("Failed to enable side panel action behavior", error)
      })
  }

  chrome.runtime.onMessage.addListener(
    (
      command: RuntimeCommand,
      _sender,
      sendResponse: (response: RuntimeCommandResult) => void
    ) => {
      void (async () => {
        try {
          switch (command.type) {
            case "get-runtime-state":
              sendResponse(await getRuntimeState())
              break

            case "navigate-tab":
              sendResponse(await navigateTab(command.url))
              break

            case "execute-browser-tool":
              sendResponse(await executeBrowserTool(command.request))
              break

            default: {
              const state = await getRuntimeState()
              sendResponse(
                createCommandError(
                  "Unsupported extension command.",
                  state.currentTab,
                  state.agentServer
                )
              )
            }
          }
        } catch (error) {
          const state = await getRuntimeState()
          sendResponse(
            createCommandError(
              error instanceof Error ? error.message : "Extension command failed.",
              state.currentTab,
              state.agentServer
            )
          )
        }
      })()

      return true
    }
  )
})
