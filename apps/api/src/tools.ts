import {
  browserToolDescriptions,
  browserToolRiskLevels,
  getBrowserToolInputSchema,
  supportedBrowserTools,
  type BrowserToolName,
  type ExtensionChatContext,
} from "@workspace/browser-agent"
import { tool } from "ai"

import { requestBrowserTool } from "./bridge.js"

function summarizeInput(input: Record<string, unknown>) {
  const fragments = Object.entries(input)
    .slice(0, 3)
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}=${value.slice(0, 80)}`
      }

      return `${key}=${JSON.stringify(value).slice(0, 80)}`
    })

  return fragments.length > 0 ? fragments.join(", ") : "no arguments"
}

function buildToolReason(toolName: BrowserToolName, input: Record<string, unknown>) {
  return `${browserToolDescriptions[toolName]} Input: ${summarizeInput(input)}`
}

export function createBrowserAgentTools(context: ExtensionChatContext) {
  const sessionId = context.extension.bridgeSessionId

  return Object.fromEntries(
    supportedBrowserTools.map((toolName) => [
      toolName,
      tool({
        description: browserToolDescriptions[toolName],
        inputSchema: getBrowserToolInputSchema(toolName),
        execute: async (input) => {
          const result = await requestBrowserTool({
            sessionId,
            toolName,
            input: input as Record<string, unknown>,
            riskLevel: browserToolRiskLevels[toolName],
            reason: buildToolReason(
              toolName,
              input as Record<string, unknown>
            ),
          })

          if (!result.ok) {
            throw new Error(result.error ?? `${toolName} failed.`)
          }

          if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
            return {
              ...result.data,
              currentTab: result.currentTab ?? null,
            }
          }

          return {
            result: result.data ?? null,
            currentTab: result.currentTab ?? null,
          }
        },
      }),
    ])
  )
}
