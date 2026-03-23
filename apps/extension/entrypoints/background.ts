import { defineBackground } from "wxt/utils/define-background"

export default defineBackground(() => {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return
  }

  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.error("Failed to enable side panel action behavior", error)
    })
})
