import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  dev: {
    server: {
      port: 3001,
    },
  },
  manifest: {
    name: "Chat Extension",
    description: "Side panel extension for the chat monorepo backend.",
    permissions: ["activeTab", "sidePanel", "scripting", "tabs"],
    host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "Open Chat Extension",
    },
  },
})
