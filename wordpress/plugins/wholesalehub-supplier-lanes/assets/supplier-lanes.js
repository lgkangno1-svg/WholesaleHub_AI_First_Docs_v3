;(function supplierLanesUi(window, document) {
  const prompt = "원하는 규격을 선택하면 구매 가능한 판매조건을 보여드립니다."

  function supplierIdentity(offer) {
    return String(offer.supplier || offer.lane || "")
  }

  function classifyMode(offers) {
    if (offers.length <= 1) {
      return "single-offer"
    }
    const suppliers = new Set(offers.map(supplierIdentity))
    return suppliers.size === 1 ? "single-supplier" : "multi-supplier"
  }

  function matchingOffers(offers, selection, dimensions) {
    if (dimensions.some((dimension) => !Object.hasOwn(selection, dimension))) {
      return []
    }
    return offers.filter((offer) =>
      dimensions.every(
        (dimension) => String(offer[dimension] ?? "") === String(selection[dimension]),
      ),
    )
  }

  function availableValues(offers, selection, dimension) {
    const values = new Set()
    for (const offer of offers) {
      const compatible = Object.entries(selection).every(
        ([selectedDimension, selectedValue]) =>
          selectedDimension === dimension ||
          String(offer[selectedDimension] ?? "") === String(selectedValue),
      )
      const value = String(offer[dimension] ?? "")
      if (compatible && value !== "") {
        values.add(value)
      }
    }
    return [...values]
  }

  function candidateState(offers, requestedSelection, dimensions) {
    const selection = {}
    const steps = []
    let candidates = offers

    for (const dimension of dimensions) {
      const values = availableValues(candidates, {}, dimension)
      const hasMissing = candidates.some((offer) => String(offer[dimension] ?? "") === "")

      if (hasMissing || values.length === 0) {
        continue
      }
      if (values.length === 1) {
        selection[dimension] = values[0]
        candidates = candidates.filter(
          (offer) => String(offer[dimension] ?? "") === String(values[0]),
        )
        continue
      }

      const selected = String(requestedSelection[dimension] ?? "")
      steps.push({ dimension, values, selected: values.includes(selected) ? selected : "" })
      if (!values.includes(selected)) {
        return { candidates, complete: false, selection, steps }
      }
      selection[dimension] = selected
      candidates = candidates.filter((offer) => String(offer[dimension] ?? "") === String(selected))
    }

    return { candidates, complete: true, selection, steps }
  }

  function offerFromCard(card, dimensions) {
    const offer = {
      card,
      key: card.dataset.publicOfferKey || "",
      lane: card.dataset.lane || "",
      price: Number(card.dataset.price || 0),
      variationId: card.dataset.variationId || "",
    }
    for (const dimension of dimensions) {
      offer[dimension] = card.dataset[dimension] || ""
    }
    return offer
  }

  function setStatus(status, message) {
    status.textContent = message
    status.hidden = message === ""
  }

  function enableCard(card, enabled) {
    for (const control of card.querySelectorAll("input, button, select")) {
      control.disabled = !enabled
    }
  }

  function clearSelectedOffer(root) {
    delete root.dataset.selectedVariationId
    delete root.dataset.selectedPublicOfferKey
  }

  function renderMatches(root, cards, matches, status) {
    const results = root.querySelector(".wh-offer-results")
    results.classList.remove("wh-comparison-grid")
    clearSelectedOffer(root)
    for (const card of cards) {
      card.hidden = true
      enableCard(card, false)
      card.classList.remove("is-lowest", "wh-compact-purchase")
      const lowestBadge = card.querySelector(".wh-badge-lowest")
      if (lowestBadge) {
        lowestBadge.hidden = true
      }
    }

    if (matches.length === 0) {
      setStatus(status, prompt)
      return
    }

    setStatus(status, "")
    if (matches.length === 1) {
      matches[0].card.hidden = false
      enableCard(matches[0].card, true)
      matches[0].card.classList.add("wh-compact-purchase")
      root.dataset.selectedVariationId = matches[0].variationId
      root.dataset.selectedPublicOfferKey = matches[0].key
      return
    }

    results.classList.add("wh-comparison-grid")
    const lowest = matches.reduce((best, offer) => (offer.price < best.price ? offer : best))
    for (const offer of matches) {
      offer.card.hidden = false
      enableCard(offer.card, true)
      if (offer === lowest) {
        offer.card.classList.add("is-lowest")
        const lowestBadge = offer.card.querySelector(".wh-badge-lowest")
        if (lowestBadge) {
          lowestBadge.hidden = false
        }
      }
    }
  }

  function resetQuantity(root) {
    for (const quantity of root.querySelectorAll('input[name="quantity"]')) {
      quantity.value = "1"
    }
  }

  function initializeSingleSupplier(root, offers, cards, status) {
    const dropdown = root.querySelector(".wh-spec-dropdown")
    const toggle = root.querySelector(".wh-spec-listbox-toggle")
    const listbox = root.querySelector(".wh-spec-listbox")
    const options = listbox ? [...listbox.querySelectorAll('[role="option"]')] : []

    function selectKey(key, label = "") {
      renderMatches(root, cards, key ? offers.filter((offer) => offer.key === key) : [], status)
      if (!key) {
        setStatus(status, prompt)
      }
      if (toggle) {
        toggle.querySelector("span").textContent = label || "규격을 선택하세요"
      }
      for (const option of options) {
        option.setAttribute(
          "aria-selected",
          String(option.dataset.offerKey || "") === key ? "true" : "false",
        )
      }
    }

    function closeListbox(focusToggle = false) {
      if (!toggle || !listbox) {
        return
      }
      listbox.hidden = true
      toggle.setAttribute("aria-expanded", "false")
      if (focusToggle) {
        toggle.focus()
      }
    }

    if (dropdown) {
      dropdown.addEventListener("change", () => selectKey(dropdown.value))
    }

    if (toggle && listbox) {
      toggle.addEventListener("click", () => {
        const opening = listbox.hidden
        listbox.hidden = !opening
        toggle.setAttribute("aria-expanded", opening ? "true" : "false")
        if (opening) {
          ;(
            options.find((option) => option.getAttribute("aria-selected") === "true") || options[0]
          )?.focus()
        }
      })
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          listbox.hidden = false
          toggle.setAttribute("aria-expanded", "true")
          options[0]?.focus()
        } else if (event.key === "Escape") {
          closeListbox()
        }
      })
      listbox.addEventListener("click", (event) => {
        const option = event.target.closest('[role="option"]')
        if (!option) {
          return
        }
        selectKey(option.dataset.offerKey || "", option.dataset.label || option.textContent)
        closeListbox(true)
      })
      listbox.addEventListener("keydown", (event) => {
        const option = event.target.closest('[role="option"]')
        const index = options.indexOf(option)
        if (index < 0) {
          return
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          const offset = event.key === "ArrowDown" ? 1 : -1
          options[(index + offset + options.length) % options.length]?.focus()
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault()
          options[event.key === "Home" ? 0 : options.length - 1]?.focus()
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          option.click()
        } else if (event.key === "Escape") {
          event.preventDefault()
          closeListbox(true)
        }
      })
      document.addEventListener("click", (event) => {
        if (!root.contains(event.target)) {
          closeListbox()
        }
      })
    }

    return () => {
      if (dropdown) {
        dropdown.value = ""
      }
      closeListbox()
      selectKey("")
    }
  }

  function initializeMultiSupplier(root, offers, cards, dimensions, status) {
    const requestedSelection = {}
    const groups = [...root.querySelectorAll(".wh-spec-filter-group")]
    const buttons = [...root.querySelectorAll(".wh-spec-pill")]

    function update() {
      const state = candidateState(offers, requestedSelection, dimensions)
      const visibleSteps = new Map(state.steps.map((step) => [step.dimension, step]))
      for (const group of groups) {
        const step = visibleSteps.get(group.dataset.dimension || "")
        group.hidden = !step
        if (!step) {
          continue
        }
        for (const button of group.querySelectorAll(".wh-spec-pill")) {
          const value = String(button.dataset.val || "")
          button.hidden = !step.values.includes(value)
          button.disabled = !step.values.includes(value)
          const active = step.selected === value
          button.classList.toggle("active", active)
          button.setAttribute("aria-pressed", active ? "true" : "false")
        }
      }

      if (state.complete) {
        renderMatches(root, cards, state.candidates, status)
      } else {
        renderMatches(root, cards, [], status)
      }
    }

    for (const button of buttons) {
      button.addEventListener("click", () => {
        const dimension = button.dataset.dim || ""
        const value = button.dataset.val || ""
        const index = dimensions.indexOf(dimension)
        if (index < 0) {
          return
        }
        requestedSelection[dimension] =
          String(requestedSelection[dimension] ?? "") === value ? "" : value
        for (const laterDimension of dimensions.slice(index + 1)) {
          delete requestedSelection[laterDimension]
        }
        update()
      })
    }

    update()
    return () => {
      for (const dimension of dimensions) {
        delete requestedSelection[dimension]
      }
      update()
    }
  }

  function initialize(root) {
    let dimensions = []
    try {
      dimensions = JSON.parse(root.dataset.dimensions || "[]")
    } catch {
      dimensions = []
    }
    const cards = [...root.querySelectorAll(".wh-condition-card")]
    const offers = cards.map((card) => offerFromCard(card, dimensions))
    const status = root.querySelector(".wh-selection-status")
    if (!status || offers.length === 0) {
      return
    }

    const mode = root.dataset.uiMode || classifyMode(offers)
    let resetSelection = () => undefined
    if (mode === "single-offer") {
      renderMatches(root, cards, offers.slice(0, 1), status)
    } else if (mode === "single-supplier") {
      resetSelection = initializeSingleSupplier(root, offers, cards, status)
    } else {
      resetSelection = initializeMultiSupplier(root, offers, cards, dimensions, status)
    }

    root.querySelector(".wh-selection-reset")?.addEventListener("click", () => {
      resetQuantity(root)
      resetSelection()
      clearSelectedOffer(root)
    })
  }

  function boot() {
    for (const root of document.querySelectorAll(".wh-option-a-ui[data-ui-mode]")) {
      initialize(root)
    }
  }

  window.WholesaleHubSupplierLanes = Object.freeze({
    availableValues,
    candidateState,
    classifyMode,
    matchingOffers,
  })

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot)
  } else {
    boot()
  }
})(window, document)
