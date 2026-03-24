import { z } from "zod"

export const currentTabContextSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
})

export type CurrentTabContext = z.infer<typeof currentTabContextSchema>

export const toolRiskLevelSchema = z.enum(["read", "style", "write", "navigation"])
export type ToolRiskLevel = z.infer<typeof toolRiskLevelSchema>

export const browserToolNameSchema = z.enum([
  "get_page_metadata",
  "get_page_structure",
  "get_element_info",
  "scrape_elements",
  "get_visible_text",
  "find_links",
  "find_images_missing_alt",
  "find_prices",
  "click_element",
  "enter_text",
  "type_text",
  "press_key",
  "select_option",
  "check_element",
  "scroll_to",
  "wait_for_element",
  "navigate_tab",
  "highlight_element",
  "set_element_style",
  "inject_stylesheet",
  "enable_reading_mode",
  "mask_sensitive_data",
  "extract_structured_data",
  "inspect_form",
  "inspect_headings_and_landmarks",
])

export type BrowserToolName = z.infer<typeof browserToolNameSchema>

const selectorSchema = z.string().min(1).max(500)
const positiveLimitSchema = z.number().int().min(1).max(100).optional()

export const browserToolInputSchemas = {
  get_page_metadata: z.object({}),
  get_page_structure: z.object({
    filter: z
      .enum(["interactive", "inputs", "links", "buttons", "all"])
      .default("interactive"),
    limit: positiveLimitSchema.default(80),
  }),
  get_element_info: z.object({
    selector: selectorSchema,
  }),
  scrape_elements: z.object({
    selector: selectorSchema,
    limit: positiveLimitSchema.default(10),
  }),
  get_visible_text: z.object({
    selector: selectorSchema.optional(),
    maxLength: z.number().int().min(100).max(50_000).default(5_000),
  }),
  find_links: z.object({
    selector: selectorSchema.optional(),
    limit: positiveLimitSchema.default(25),
  }),
  find_images_missing_alt: z.object({
    selector: selectorSchema.optional(),
    limit: positiveLimitSchema.default(25),
  }),
  find_prices: z.object({
    selector: selectorSchema.optional(),
    limit: positiveLimitSchema.default(25),
  }),
  click_element: z
    .object({
      selector: selectorSchema.optional(),
      text: z.string().min(1).max(500).optional(),
      nth: z.number().int().min(0).max(50).default(0),
    })
    .refine(
      (value) => value.selector !== undefined || value.text !== undefined,
      "Provide selector or text."
    ),
  enter_text: z.object({
    selector: selectorSchema,
    text: z.string().max(10_000),
  }),
  type_text: z.object({
    selector: selectorSchema,
    text: z.string().max(10_000),
    clearFirst: z.boolean().default(false),
  }),
  press_key: z.object({
    key: z.string().min(1).max(100),
    modifiers: z
      .array(z.enum(["ctrl", "shift", "alt", "meta"]))
      .max(4)
      .default([]),
    selector: selectorSchema.optional(),
  }),
  select_option: z
    .object({
      selector: selectorSchema,
      value: z.string().optional(),
      label: z.string().optional(),
      index: z.number().int().min(0).optional(),
    })
    .refine(
      (value) =>
        value.value !== undefined ||
        value.label !== undefined ||
        value.index !== undefined,
      "Provide value, label, or index."
    ),
  check_element: z.object({
    selector: selectorSchema,
    checked: z.boolean().default(true),
  }),
  scroll_to: z.object({
    selector: selectorSchema.optional(),
    top: z.number().optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    amount: z.number().int().min(1).max(10_000).optional(),
    toPercent: z.number().min(0).max(100).optional(),
    behavior: z.enum(["auto", "smooth"]).default("smooth"),
  }),
  wait_for_element: z.object({
    selector: selectorSchema,
    timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
    visible: z.boolean().default(true),
  }),
  navigate_tab: z.object({
    url: z.string().url(),
  }),
  highlight_element: z.object({
    selector: selectorSchema,
    durationMs: z.number().int().min(500).max(20_000).default(3_000),
  }),
  set_element_style: z.object({
    selector: selectorSchema,
    styles: z.record(z.string(), z.string()).refine(
      (value) => Object.keys(value).length > 0,
      "At least one style is required."
    ),
  }),
  inject_stylesheet: z.object({
    cssText: z.string().min(1).max(20_000),
  }),
  enable_reading_mode: z.object({
    articleSelector: selectorSchema.optional(),
  }),
  mask_sensitive_data: z.object({
    selector: selectorSchema.optional(),
    maskEmails: z.boolean().default(true),
    maskPhones: z.boolean().default(true),
  }),
  extract_structured_data: z.object({
    containerSelector: selectorSchema,
    limit: positiveLimitSchema.default(20),
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          selector: selectorSchema,
          type: z.enum(["text", "html", "attribute"]).default("text"),
          attributeName: z.string().optional(),
        })
      )
      .min(1)
      .max(20),
  }),
  inspect_form: z.object({
    selector: selectorSchema.optional(),
  }),
  inspect_headings_and_landmarks: z.object({}),
} as const

export type BrowserToolInputMap = {
  [K in keyof typeof browserToolInputSchemas]: z.infer<
    (typeof browserToolInputSchemas)[K]
  >
}

export type BrowserToolInput<K extends BrowserToolName = BrowserToolName> =
  BrowserToolInputMap[K]

export const browserToolRiskLevels: Record<BrowserToolName, ToolRiskLevel> = {
  get_page_metadata: "read",
  get_page_structure: "read",
  get_element_info: "read",
  scrape_elements: "read",
  get_visible_text: "read",
  find_links: "read",
  find_images_missing_alt: "read",
  find_prices: "read",
  click_element: "write",
  enter_text: "write",
  type_text: "write",
  press_key: "write",
  select_option: "write",
  check_element: "write",
  scroll_to: "read",
  wait_for_element: "read",
  navigate_tab: "navigation",
  highlight_element: "style",
  set_element_style: "style",
  inject_stylesheet: "style",
  enable_reading_mode: "style",
  mask_sensitive_data: "style",
  extract_structured_data: "read",
  inspect_form: "read",
  inspect_headings_and_landmarks: "read",
}

export const browserToolDescriptions: Record<BrowserToolName, string> = {
  get_page_metadata:
    "Read the page title, URL, language, and current text selection. Use this to confirm which page is open before acting.",
  get_page_structure:
    "List visible interactive elements with stable selectors, labels, tags, and roles. Use this first on unfamiliar pages before clicking or typing.",
  get_element_info:
    "Inspect one element in detail: text, attributes, bounds, visibility, and key computed styles. Use this to debug selectors before interacting.",
  scrape_elements:
    "Query a selector and summarize matching elements. Use when you already know the container or selector you want to inspect.",
  get_visible_text:
    "Read visible text from the page or a specific element. Prefer this for page understanding and confirmation after navigation.",
  find_links:
    "Extract links from the page for audit or navigation analysis. Useful when you need candidate destinations without clicking blindly.",
  find_images_missing_alt: "Find images without useful alt text.",
  find_prices: "Extract price-like text from the page.",
  click_element:
    "Click a page element matched by a CSS selector or exact visible text. Use selectors from get_page_structure whenever possible.",
  enter_text:
    "Replace the value of an editable control and dispatch input events. Use for deterministic form filling when you know the target selector.",
  type_text:
    "Type text into an editable control in a typing-like flow. Use this for textareas, contenteditable editors, and search inputs.",
  press_key:
    "Dispatch a keyboard action such as Enter, Tab, Escape, or arrow keys, optionally after focusing a selector.",
  select_option: "Choose an option in a select element.",
  check_element: "Check or uncheck a checkbox or radio button.",
  scroll_to:
    "Scroll the page or a target element into view. Use this to reach lazy-loaded content or bring an off-screen element into view.",
  wait_for_element:
    "Wait until a selector exists in the DOM and optionally becomes visible. Prefer this over arbitrary delays after navigation or clicks.",
  navigate_tab: "Navigate the current tab to a new URL.",
  highlight_element: "Temporarily highlight a page element.",
  set_element_style: "Apply inline styles to an element.",
  inject_stylesheet: "Inject a temporary stylesheet into the page.",
  enable_reading_mode: "Reduce clutter and emphasize the main reading area.",
  mask_sensitive_data: "Blur visible emails or phone-like strings for privacy.",
  extract_structured_data: "Extract structured fields from repeated containers.",
  inspect_form: "Inspect a form and return controls, labels, and states.",
  inspect_headings_and_landmarks:
    "Inspect headings, landmarks, and document structure for guidance or audit.",
}

export const browserToolRequestSchema = z.object({
  callId: z.string().min(1),
  toolName: browserToolNameSchema,
  riskLevel: toolRiskLevelSchema,
  reason: z.string().min(1).max(500),
  input: z.record(z.string(), z.unknown()),
})

export type BrowserToolRequest = z.infer<typeof browserToolRequestSchema>

export const browserToolResultSchema = z.object({
  callId: z.string().min(1),
  toolName: browserToolNameSchema,
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  currentTab: currentTabContextSchema.nullable().optional(),
})

export type BrowserToolResult = z.infer<typeof browserToolResultSchema>

export const agentServerCapabilitiesSchema = z.object({
  available: z.boolean(),
  endpoint: z.string(),
  chat: z.object({
    available: z.boolean(),
    endpoint: z.string(),
  }),
  bridge: z.object({
    available: z.boolean(),
    sessionEndpoint: z.string(),
    pollEndpoint: z.string(),
  }),
  automation: z.object({
    supportsStreamingChat: z.boolean(),
    supportsExtensionToolLoop: z.boolean(),
    supportsChromeDevtoolsMcp: z.boolean(),
  }),
  error: z.string().optional(),
})

export type AgentServerCapabilities = z.infer<
  typeof agentServerCapabilitiesSchema
>

export const extensionRuntimeStateSchema = z.object({
  ok: z.literal(true),
  currentTab: currentTabContextSchema.nullable(),
  agentServer: agentServerCapabilitiesSchema,
  supportedTools: z.array(browserToolNameSchema),
})

export type ExtensionRuntimeState = z.infer<typeof extensionRuntimeStateSchema>

export const runtimeCommandErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  currentTab: currentTabContextSchema.nullable(),
  agentServer: agentServerCapabilitiesSchema,
})

export type RuntimeCommandError = z.infer<typeof runtimeCommandErrorSchema>

export const getRuntimeStateCommandSchema = z.object({
  type: z.literal("get-runtime-state"),
})

export const executeBrowserToolCommandSchema = z.object({
  type: z.literal("execute-browser-tool"),
  request: browserToolRequestSchema,
})

export const navigateTabCommandSchema = z.object({
  type: z.literal("navigate-tab"),
  url: z.string().url(),
})

export const runtimeCommandSchema = z.discriminatedUnion("type", [
  getRuntimeStateCommandSchema,
  executeBrowserToolCommandSchema,
  navigateTabCommandSchema,
])

export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>

export type RuntimeCommandResult =
  | ExtensionRuntimeState
  | RuntimeCommandError
  | BrowserToolResult

export const extensionChatContextSchema = z.object({
  currentTab: currentTabContextSchema.optional(),
  extension: z.object({
    supportedTools: z.array(browserToolNameSchema),
    bridgeSessionId: z.string().min(1),
  }),
})

export type ExtensionChatContext = z.infer<typeof extensionChatContextSchema>

export function isRiskyTool(riskLevel: ToolRiskLevel) {
  return riskLevel === "write" || riskLevel === "navigation"
}

export function getBrowserToolInputSchema(toolName: BrowserToolName) {
  return browserToolInputSchemas[toolName]
}

export const supportedBrowserTools = browserToolNameSchema.options
