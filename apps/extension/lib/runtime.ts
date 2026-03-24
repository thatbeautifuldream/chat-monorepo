import type {
  AgentServerCapabilities,
  BrowserToolName,
  BrowserToolRequest,
  BrowserToolResult,
  RuntimeCommand,
  RuntimeCommandResult,
} from "@workspace/browser-agent"
import {
  browserToolRiskLevels,
  isRiskyTool,
  supportedBrowserTools,
} from "@workspace/browser-agent"

export type {
  AgentServerCapabilities,
  BrowserToolName,
  BrowserToolRequest,
  BrowserToolResult,
  CurrentTabContext,
  ExtensionChatContext,
  ExtensionRuntimeState,
  RuntimeCommand,
  RuntimeCommandError,
  RuntimeCommandResult,
  ToolRiskLevel,
} from "@workspace/browser-agent"

export { browserToolRiskLevels, isRiskyTool, supportedBrowserTools }

export function resolveApiBaseUrl() {
  const configuredUrl =
    import.meta.env.WXT_API_BASE_URL?.trim() || "http://127.0.0.1:8080"

  try {
    const url = new URL(configuredUrl)

    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1"
    }

    return url.toString().replace(/\/$/, "")
  } catch {
    return configuredUrl.replace(/\/$/, "")
  }
}

export function createFallbackAgentServerState(
  endpoint = resolveApiBaseUrl()
): AgentServerCapabilities {
  return {
    available: false,
    endpoint,
    chat: {
      available: false,
      endpoint: `${endpoint}/chat`,
    },
    bridge: {
      available: false,
      sessionEndpoint: `${endpoint}/bridge/session`,
      pollEndpoint: `${endpoint}/bridge/session/:sessionId/tool-call`,
    },
    automation: {
      supportsStreamingChat: false,
      supportsExtensionToolLoop: false,
      supportsChromeDevtoolsMcp: false,
    },
  }
}

export async function sendRuntimeCommand(
  command: RuntimeCommand
): Promise<RuntimeCommandResult> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(command, (response: RuntimeCommandResult) => {
      const runtimeError = chrome.runtime.lastError

      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }

      resolve(response)
    })
  })
}

export const browserToolExamples: Record<BrowserToolName, Record<string, unknown>> = {
  get_page_metadata: {},
  get_page_structure: { filter: "interactive", limit: 30 },
  get_element_info: { selector: "main h1" },
  scrape_elements: { selector: "main a", limit: 5 },
  get_visible_text: { selector: "main", maxLength: 1500 },
  find_links: { selector: "main a", limit: 10 },
  find_images_missing_alt: { limit: 10 },
  find_prices: { selector: "body", limit: 10 },
  click_element: { selector: "button, a[role='button']", nth: 0 },
  enter_text: { selector: "input[type='email']", text: "user@example.com" },
  type_text: {
    selector: "textarea",
    text: "Hello from the sidebar agent",
    clearFirst: false,
  },
  press_key: { key: "Enter", modifiers: [] },
  select_option: { selector: "select", label: "India" },
  check_element: { selector: "input[type='checkbox']", checked: true },
  scroll_to: { direction: "down", amount: 600, behavior: "smooth" },
  wait_for_element: { selector: "main", timeoutMs: 5000, visible: true },
  navigate_tab: { url: "https://example.com" },
  highlight_element: { selector: "main h1", durationMs: 3000 },
  set_element_style: { selector: "main h1", styles: { color: "#1d4ed8" } },
  inject_stylesheet: { cssText: "main { line-height: 1.7; }" },
  enable_reading_mode: {},
  mask_sensitive_data: { maskEmails: true, maskPhones: true },
  extract_structured_data: {
    containerSelector: "article, .product-card",
    limit: 5,
    fields: [
      { name: "title", selector: "h1, h2, h3, .title", type: "text" },
      { name: "price", selector: ".price, [data-price]", type: "text" },
    ],
  },
  inspect_form: {},
  inspect_headings_and_landmarks: {},
}

export function createManualToolRequest(
  toolName: BrowserToolName,
  input: Record<string, unknown>
): BrowserToolRequest {
  return {
    callId: crypto.randomUUID(),
    toolName,
    input,
    riskLevel: "read",
    reason: "Manual debug tool execution from the side panel.",
  }
}

export function withResultTab(
  result: BrowserToolResult,
  currentTab: BrowserToolResult["currentTab"]
) {
  return {
    ...result,
    currentTab: result.currentTab ?? currentTab,
  }
}

export function getToolLabel(toolName: BrowserToolName) {
  return toolName.replaceAll("_", " ")
}

export function getSupportedToolOptions() {
  return supportedBrowserTools
}
