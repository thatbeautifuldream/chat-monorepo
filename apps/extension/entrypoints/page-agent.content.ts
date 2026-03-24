import {
  browserToolInputSchemas,
  browserToolRequestSchema,
  browserToolResultSchema,
  type BrowserToolRequest,
  type BrowserToolResult,
} from "@workspace/browser-agent"

const HIGHLIGHT_STYLE_ID = "chat-monorepo-ai-agent-highlight-style"
const HIGHLIGHT_CLASS = "chat-monorepo-ai-agent-highlight"
const READING_MODE_STYLE_ID = "chat-monorepo-ai-reading-mode"
const MASK_CLASS = "chat-monorepo-ai-masked"

type ContentScriptMessage = {
  type: "browser-tool-request"
  request: BrowserToolRequest
}

function summarizeElement(element: Element | null) {
  if (!element) {
    return null
  }

  const text =
    "innerText" in element && typeof element.innerText === "string"
      ? element.innerText
      : element.textContent

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: element.className || null,
    text: (text ?? "").trim().replace(/\s+/g, " ").slice(0, 240) || null,
  }
}

function ensureStyleElement(id: string, cssText: string) {
  let style = document.getElementById(id) as HTMLStyleElement | null

  if (!style) {
    style = document.createElement("style")
    style.id = id
    document.documentElement.append(style)
  }

  style.textContent = cssText
  return style
}

function getElement(selector: string) {
  return document.querySelector(selector)
}

function buildStableSelector(element: Element) {
  const tag = element.tagName.toLowerCase()
  const testId = element.getAttribute("data-testid")

  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`
  }

  if (element.id && !/[0-9]{4,}/.test(element.id) && element.id.length < 80) {
    return `#${CSS.escape(element.id)}`
  }

  const ariaLabel = element.getAttribute("aria-label")

  if (ariaLabel && ariaLabel.length < 120) {
    return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`
  }

  const name = element.getAttribute("name")

  if (name) {
    return `${tag}[name="${CSS.escape(name)}"]`
  }

  if (tag === "a") {
    const href = element.getAttribute("href")

    if (href && href.length < 160) {
      return `a[href="${CSS.escape(href)}"]`
    }
  }

  if (tag === "input") {
    return `input[type="${(element as HTMLInputElement).type || "text"}"]`
  }

  const role = element.getAttribute("role")

  if (role) {
    return `${tag}[role="${CSS.escape(role)}"]`
  }

  return tag
}

function getElementLabel(element: Element) {
  const html = element as HTMLElement
  const ariaLabel = element.getAttribute("aria-label")

  if (ariaLabel) {
    return ariaLabel.trim().slice(0, 120)
  }

  const placeholder = element.getAttribute("placeholder")

  if (placeholder) {
    return placeholder.trim().slice(0, 120)
  }

  const text = html.innerText?.trim()

  if (text) {
    return text.replace(/\s+/g, " ").slice(0, 120)
  }

  return (
    element.getAttribute("title") ||
    element.getAttribute("name") ||
    element.getAttribute("id") ||
    element.tagName.toLowerCase()
  )
}

function isVisibleElement(element: Element) {
  const html = element as HTMLElement

  if (html.getAttribute("aria-hidden") === "true") {
    return false
  }

  const rect = html.getBoundingClientRect()

  if (rect.width === 0 && rect.height === 0) {
    return false
  }

  const style = window.getComputedStyle(html)

  return style.display !== "none" && style.visibility !== "hidden"
}

function findElementByExactText(text: string, nth = 0) {
  const ownTextMatches: Element[] = []
  const fullTextMatches: Element[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)

  while (walker.nextNode()) {
    const node = walker.currentNode as Element
    let ownText = ""

    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = child.textContent?.trim()

        if (fragment) {
          ownText += ownText ? ` ${fragment}` : fragment
        }
      }
    }

    if (ownText === text) {
      ownTextMatches.push(node)
    }

    if (node.textContent?.trim() === text) {
      fullTextMatches.push(node)
    }
  }

  if (ownTextMatches[nth]) {
    return ownTextMatches[nth]
  }

  fullTextMatches.sort(
    (left, right) => (left.innerHTML?.length ?? 0) - (right.innerHTML?.length ?? 0)
  )

  return fullTextMatches[nth] ?? null
}

async function waitForElement(selector: string, timeoutMs: number) {
  const existing = getElement(selector)

  if (existing) {
    return existing
  }

  return new Promise<Element>((resolve, reject) => {
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      const element = getElement(selector)

      if (element) {
        window.clearInterval(interval)
        resolve(element)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval)
        reject(new Error(`Timed out waiting for selector: ${selector}`))
      }
    }, 100)
  })
}

function getEditableElement(selector: string) {
  const element = getElement(selector)

  if (!element) {
    throw new Error(`No element found for selector: ${selector}`)
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  ) {
    return element
  }

  throw new Error("Target element is not editable.")
}

function setEditableValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  value: string
) {
  const dispatchValueFallback = (target: typeof element, nextValue: string) => {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const prototype =
        target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set

      setter?.call(target, nextValue)
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: nextValue,
        })
      )
      target.dispatchEvent(new Event("change", { bubbles: true }))
      return
    }

    target.textContent = nextValue
    target.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: true, data: nextValue })
    )
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.focus()
    element.select()

    const inserted = document.execCommand("insertText", false, value)

    if (!inserted) {
      dispatchValueFallback(element, value)
    } else {
      element.dispatchEvent(new Event("change", { bubbles: true }))
    }

    return
  }

  element.focus()
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  const inserted = document.execCommand("insertText", false, value)

  if (!inserted) {
    dispatchValueFallback(element, value)
  }
}

function appendEditableValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  value: string
) {
  const appendFallback = (target: typeof element, nextValue: string) => {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const prototype =
        target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set

      setter?.call(target, `${target.value}${nextValue}`)
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: nextValue,
        })
      )
      target.dispatchEvent(new Event("change", { bubbles: true }))
      return
    }

    target.textContent = `${target.textContent ?? ""}${nextValue}`
    target.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: true, data: nextValue })
    )
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.focus()
    const length = element.value.length

    try {
      element.setSelectionRange(length, length)
    } catch {
      // Some input types do not support setSelectionRange.
    }

    const inserted = document.execCommand("insertText", false, value)

    if (!inserted) {
      appendFallback(element, value)
    } else {
      element.dispatchEvent(new Event("change", { bubbles: true }))
    }

    return
  }

  element.focus()
  const selection = window.getSelection()
  selection?.selectAllChildren(element)
  selection?.collapseToEnd()

  const inserted = document.execCommand("insertText", false, value)

  if (!inserted) {
    appendFallback(element, value)
  }
}

function getVisibleText(element: Element) {
  const text =
    element instanceof HTMLElement ? element.innerText : element.textContent ?? ""

  return text.trim().replace(/\s+/g, " ")
}

function getPageSelectionText() {
  return window.getSelection()?.toString().trim() || null
}

async function executeTool(request: BrowserToolRequest): Promise<BrowserToolResult> {
  switch (request.toolName) {
    case "get_page_metadata":
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          title: document.title,
          url: window.location.href,
          lang: document.documentElement.lang || null,
          selectionText: getPageSelectionText(),
        },
      }

    case "get_page_structure": {
      const input = browserToolInputSchemas.get_page_structure.parse(request.input)
      const selectors: Record<
        "interactive" | "inputs" | "links" | "buttons" | "all",
        string
      > = {
        interactive: [
          "a[href]",
          "button",
          "input",
          "select",
          "textarea",
          "[role='button']",
          "[role='link']",
          "[role='textbox']",
          "[role='tab']",
          "[role='menuitem']",
          "[role='checkbox']",
          "[role='switch']",
          "[role='combobox']",
          "[contenteditable='true']",
          "[contenteditable='']",
          "[onclick]",
          "[tabindex]:not([tabindex='-1'])",
        ].join(", "),
        inputs:
          "input, select, textarea, [role='textbox'], [role='combobox'], [contenteditable='true'], [contenteditable='']",
        links: "a[href], [role='link']",
        buttons:
          "button, [role='button'], input[type='submit'], input[type='button']",
        all: "body *",
      }
      const matches = Array.from(
        document.querySelectorAll(selectors[input.filter])
      ).filter(isVisibleElement)

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          filter: input.filter,
          totalMatched: matches.length,
          elements: matches.slice(0, input.limit).map((element) => ({
            tag: element.tagName.toLowerCase(),
            selector: buildStableSelector(element),
            label: getElementLabel(element),
            type:
              element instanceof HTMLInputElement ? element.type || null : null,
            role: element.getAttribute("role"),
          })),
        },
      }
    }

    case "get_element_info": {
      const input = browserToolInputSchemas.get_element_info.parse(request.input)
      const element = await waitForElement(input.selector, 5_000)
      const attributes = Object.fromEntries(
        Array.from(element.attributes).map((attribute) => [
          attribute.name,
          attribute.value,
        ])
      )
      const rect = (element as HTMLElement).getBoundingClientRect()
      const styles = window.getComputedStyle(element as HTMLElement)

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          selector: input.selector,
          tag: element.tagName.toLowerCase(),
          text: getVisibleText(element).slice(0, 500),
          attributes,
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          visible: isVisibleElement(element),
          computedStyles: {
            display: styles.display,
            visibility: styles.visibility,
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            fontSize: styles.fontSize,
          },
        },
      }
    }

    case "scrape_elements": {
      const input = browserToolInputSchemas.scrape_elements.parse(request.input)
      const matches = Array.from(document.querySelectorAll(input.selector)).slice(
        0,
        input.limit
      )
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          selector: input.selector,
          count: document.querySelectorAll(input.selector).length,
          matches: matches.map((element) => summarizeElement(element)),
        },
      }
    }

    case "get_visible_text": {
      const input = browserToolInputSchemas.get_visible_text.parse(request.input)
      const target = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document.body
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          selector: input.selector ?? null,
          text: getVisibleText(target).slice(0, input.maxLength),
          target: summarizeElement(target),
        },
      }
    }

    case "find_links": {
      const input = browserToolInputSchemas.find_links.parse(request.input)
      const root = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document
      const links = Array.from(root.querySelectorAll("a[href]"))
        .slice(0, input.limit)
        .map((link) => ({
          text: getVisibleText(link),
          href: link.getAttribute("href"),
          target: summarizeElement(link),
        }))
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: { links },
      }
    }

    case "find_images_missing_alt": {
      const input = browserToolInputSchemas.find_images_missing_alt.parse(
        request.input
      )
      const root = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document
      const images = Array.from(root.querySelectorAll("img"))
        .filter((image) => !image.getAttribute("alt")?.trim())
        .slice(0, input.limit)
        .map((image) => ({
          src: image.getAttribute("src"),
          target: summarizeElement(image),
        }))
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: { images },
      }
    }

    case "find_prices": {
      const input = browserToolInputSchemas.find_prices.parse(request.input)
      const root = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document.body
      const pattern =
        /(?:[$€£₹]\s?\d[\d,]*(?:\.\d{2})?)|(?:\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR))/g
      const uniqueMatches = Array.from(
        new Set((getVisibleText(root).match(pattern) ?? []).slice(0, input.limit))
      )
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: { prices: uniqueMatches },
      }
    }

    case "click_element": {
      const input = browserToolInputSchemas.click_element.parse(request.input)
      const element = input.selector
        ? await waitForElement(input.selector, 5_000)
        : findElementByExactText(input.text!, input.nth)

      if (!(element instanceof HTMLElement)) {
        throw new Error("Target element is not clickable.")
      }

      if (!isVisibleElement(element)) {
        throw new Error("Target element is not visible.")
      }

      element.scrollIntoView({ block: "center", inline: "center" })
      const rect = element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const shared = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY,
        button: 0,
      }

      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...shared,
          pointerId: 1,
          pointerType: "mouse",
        })
      )
      element.dispatchEvent(new MouseEvent("mousedown", shared))
      element.focus()
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          ...shared,
          pointerId: 1,
          pointerType: "mouse",
        })
      )
      element.dispatchEvent(new MouseEvent("mouseup", shared))
      element.dispatchEvent(new MouseEvent("click", shared))

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          clicked: summarizeElement(element),
          currentUrl: window.location.href,
          pageTitle: document.title,
        },
      }
    }

    case "enter_text": {
      const input = browserToolInputSchemas.enter_text.parse(request.input)
      const element = getEditableElement(input.selector)
      setEditableValue(element, input.text)
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          target: summarizeElement(element),
          textLength: input.text.length,
        },
      }
    }

    case "type_text": {
      const input = browserToolInputSchemas.type_text.parse(request.input)
      const element = getEditableElement(input.selector)

      if (input.clearFirst) {
        setEditableValue(element, input.text)
      } else {
        appendEditableValue(element, input.text)
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          target: summarizeElement(element),
          textLength: input.text.length,
        },
      }
    }

    case "press_key": {
      const input = browserToolInputSchemas.press_key.parse(request.input)
      const target = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document.activeElement ?? document.body

      if (target instanceof HTMLElement) {
        target.focus()
      }

      const eventInit: KeyboardEventInit = {
        key: input.key,
        bubbles: true,
        cancelable: true,
        ctrlKey: input.modifiers.includes("ctrl"),
        shiftKey: input.modifiers.includes("shift"),
        altKey: input.modifiers.includes("alt"),
        metaKey: input.modifiers.includes("meta"),
      }

      target.dispatchEvent(new KeyboardEvent("keydown", eventInit))
      target.dispatchEvent(new KeyboardEvent("keypress", eventInit))
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit))

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          key: input.key,
          target: summarizeElement(target instanceof Element ? target : null),
        },
      }
    }

    case "select_option": {
      const input = browserToolInputSchemas.select_option.parse(request.input)
      const element = await waitForElement(input.selector, 5_000)

      if (!(element instanceof HTMLSelectElement)) {
        throw new Error("Target element is not a select.")
      }

      if (input.value !== undefined) {
        element.value = input.value
      } else if (input.label !== undefined) {
        const option = Array.from(element.options).find(
          (item) => item.label === input.label || item.text === input.label
        )

        if (!option) {
          throw new Error(`No option matched label: ${input.label}`)
        }

        element.value = option.value
      } else if (input.index !== undefined) {
        element.selectedIndex = input.index
      }

      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          value: element.value,
          selectedText: element.selectedOptions[0]?.text ?? null,
          target: summarizeElement(element),
        },
      }
    }

    case "check_element": {
      const input = browserToolInputSchemas.check_element.parse(request.input)
      const element = await waitForElement(input.selector, 5_000)

      if (!(element instanceof HTMLInputElement)) {
        throw new Error("Target element is not an input.")
      }

      element.checked = input.checked
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          checked: element.checked,
          target: summarizeElement(element),
        },
      }
    }

    case "scroll_to": {
      const input = browserToolInputSchemas.scroll_to.parse(request.input)

      if (input.selector) {
        const element = await waitForElement(input.selector, 5_000)
        element.scrollIntoView({
          behavior: input.behavior,
          block: "center",
          inline: "center",
        })
        return {
          callId: request.callId,
          toolName: request.toolName,
          ok: true,
          data: { target: summarizeElement(element) },
        }
      }

      if (input.toPercent !== undefined) {
        const maxScroll =
          document.documentElement.scrollHeight - window.innerHeight

        window.scrollTo({
          top: (maxScroll * input.toPercent) / 100,
          behavior: input.behavior,
        })

        return {
          callId: request.callId,
          toolName: request.toolName,
          ok: true,
          data: { scrollY: window.scrollY },
        }
      }

      if (input.direction && input.amount) {
        const delta =
          input.direction === "up" || input.direction === "left"
            ? -input.amount
            : input.amount

        window.scrollBy({
          top:
            input.direction === "up" || input.direction === "down" ? delta : 0,
          left:
            input.direction === "left" || input.direction === "right"
              ? delta
              : 0,
          behavior: input.behavior,
        })

        return {
          callId: request.callId,
          toolName: request.toolName,
          ok: true,
          data: { scrollY: window.scrollY },
        }
      }

      window.scrollTo({
        top: input.top ?? window.scrollY + window.innerHeight,
        behavior: input.behavior,
      })

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: { scrollY: window.scrollY },
      }
    }

    case "wait_for_element": {
      const input = browserToolInputSchemas.wait_for_element.parse(request.input)
      const element = await waitForElement(input.selector, input.timeoutMs)

      if (input.visible && !isVisibleElement(element)) {
        throw new Error(`Selector exists but is not visible: ${input.selector}`)
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          target: summarizeElement(element),
        },
      }
    }

    case "highlight_element": {
      const input = browserToolInputSchemas.highlight_element.parse(request.input)
      const element = await waitForElement(input.selector, 5_000)

      ensureStyleElement(
        HIGHLIGHT_STYLE_ID,
        `
          .${HIGHLIGHT_CLASS} {
            outline: 3px solid #f59e0b !important;
            box-shadow: 0 0 0 8px rgba(245, 158, 11, 0.18) !important;
            transition: box-shadow 160ms ease;
          }
        `
      )

      element.classList.add(HIGHLIGHT_CLASS)
      window.setTimeout(() => {
        element.classList.remove(HIGHLIGHT_CLASS)
      }, input.durationMs)

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: { highlighted: summarizeElement(element) },
      }
    }

    case "set_element_style": {
      const input = browserToolInputSchemas.set_element_style.parse(request.input)
      const element = await waitForElement(input.selector, 5_000)

      if (!(element instanceof HTMLElement)) {
        throw new Error("Target element cannot receive inline styles.")
      }

      for (const [key, value] of Object.entries(input.styles)) {
        element.style.setProperty(key, value)
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          target: summarizeElement(element),
          styles: input.styles,
        },
      }
    }

    case "inject_stylesheet": {
      const input = browserToolInputSchemas.inject_stylesheet.parse(request.input)
      const styleId = `chat-monorepo-injected-style-${request.callId}`
      ensureStyleElement(styleId, input.cssText)
      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: { styleId },
      }
    }

    case "enable_reading_mode": {
      const input = browserToolInputSchemas.enable_reading_mode.parse(request.input)
      const article =
        (input.articleSelector
          ? await waitForElement(input.articleSelector, 5_000)
          : document.querySelector("article, main, [role='main']")) ??
        document.body

      ensureStyleElement(
        READING_MODE_STYLE_ID,
        `
          body [data-ai-reading-hidden="true"] {
            display: none !important;
          }

          body [data-ai-reading-focus="true"] {
            max-width: 760px !important;
            margin: 0 auto !important;
            font-size: 1.08rem !important;
            line-height: 1.8 !important;
          }
        `
      )

      for (const selector of [
        "aside",
        "nav",
        "footer",
        "[role='complementary']",
        ".ad",
        ".ads",
        "[aria-label*='advert']",
      ]) {
        for (const node of document.querySelectorAll(selector)) {
          if (!article.contains(node)) {
            node.setAttribute("data-ai-reading-hidden", "true")
          }
        }
      }

      if (article instanceof HTMLElement) {
        article.setAttribute("data-ai-reading-focus", "true")
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          article: summarizeElement(article),
        },
      }
    }

    case "mask_sensitive_data": {
      const input = browserToolInputSchemas.mask_sensitive_data.parse(request.input)
      const root = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document.body
      const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
      const phonePattern =
        /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/
      const candidates = Array.from(root.querySelectorAll("*")).filter((element) => {
        const text = getVisibleText(element)
        return (
          (input.maskEmails && emailPattern.test(text)) ||
          (input.maskPhones && phonePattern.test(text))
        )
      })

      ensureStyleElement(
        `${HIGHLIGHT_STYLE_ID}-mask`,
        `.${MASK_CLASS} { filter: blur(6px) !important; }`
      )

      for (const element of candidates) {
        element.classList.add(MASK_CLASS)
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          maskedCount: candidates.length,
        },
      }
    }

    case "extract_structured_data": {
      const input = browserToolInputSchemas.extract_structured_data.parse(
        request.input
      )
      const containers = Array.from(
        document.querySelectorAll(input.containerSelector)
      ).slice(0, input.limit)
      const records = containers.map((container) =>
        Object.fromEntries(
          input.fields.map((field) => {
            const match = container.querySelector(field.selector)

            if (!match) {
              return [field.name, null]
            }

            if (field.type === "html") {
              return [field.name, match instanceof HTMLElement ? match.outerHTML : null]
            }

            if (field.type === "attribute") {
              return [field.name, match.getAttribute(field.attributeName ?? "")]
            }

            return [field.name, getVisibleText(match)]
          })
        )
      )

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          count: records.length,
          records,
        },
      }
    }

    case "inspect_form": {
      const input = browserToolInputSchemas.inspect_form.parse(request.input)
      const scope = input.selector
        ? await waitForElement(input.selector, 5_000)
        : document
      const form =
        scope instanceof HTMLFormElement
          ? scope
          : scope.querySelector("form") ?? scope
      const controls = Array.from(
        form.querySelectorAll("input, textarea, select, button")
      ).map((element) => {
        const id = element.getAttribute("id")
        const label = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
          : element.closest("label")?.textContent

        return {
          tagName: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          id,
          label: label?.trim() ?? null,
          placeholder: element.getAttribute("placeholder"),
          required: element.hasAttribute("required"),
        }
      })

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          controls,
        },
      }
    }

    case "inspect_headings_and_landmarks": {
      browserToolInputSchemas.inspect_headings_and_landmarks.parse(request.input)
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6")
      ).map((heading) => ({
        level: heading.tagName.toLowerCase(),
        text: getVisibleText(heading).slice(0, 200),
      }))
      const landmarks = Array.from(
        document.querySelectorAll(
          "main, nav, aside, header, footer, section, [role='main'], [role='navigation'], [role='complementary'], [role='banner'], [role='contentinfo']"
        )
      ).map((landmark) => ({
        role: landmark.getAttribute("role") ?? landmark.tagName.toLowerCase(),
        target: summarizeElement(landmark),
      }))

      return {
        callId: request.callId,
        toolName: request.toolName,
        ok: true,
        data: {
          headings,
          landmarks,
        },
      }
    }

    case "navigate_tab":
      throw new Error("navigate_tab must be handled in the background script.")
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener(
      (message: ContentScriptMessage, _sender, sendResponse) => {
        if (message?.type !== "browser-tool-request") {
          return
        }

        const parsedRequest = browserToolRequestSchema.safeParse(message.request)

        if (!parsedRequest.success) {
          sendResponse({
            callId: message.request?.callId ?? "invalid",
            toolName: message.request?.toolName ?? "get_page_metadata",
            ok: false,
            error: "Invalid browser tool request.",
          } satisfies BrowserToolResult)
          return true
        }

        void (async () => {
          try {
            const result = await executeTool(parsedRequest.data)
            sendResponse(browserToolResultSchema.parse(result))
          } catch (error) {
            sendResponse({
              callId: parsedRequest.data.callId,
              toolName: parsedRequest.data.toolName,
              ok: false,
              error: error instanceof Error ? error.message : "Browser tool failed.",
            } satisfies BrowserToolResult)
          }
        })()

        return true
      }
    )
  },
})
