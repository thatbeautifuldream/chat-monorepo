import { openai } from "@ai-sdk/openai"
import { ToolLoopAgent } from "ai"

export const chatAgent = new ToolLoopAgent({
  model: openai("gpt-5.4-mini"),
  tools: {
    web_search: openai.tools.webSearch({
      searchContextSize: "low",
    }),
  },
})
