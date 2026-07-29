;(function supplierLanesUi(window, document) {
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
      if (compatible) {
        values.add(String(offer[dimension] ?? ""))
      }
    }
    return [...values]
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

  function renderMatches(root, cards, matches, status) {
    const results = root.querySelector(".wh-offer-results")
    results.classList.remove("wh-comparison-grid")
    for (const card of cards) {
      card.hidden = true
      card.classList.remove("is-lowest", "wh-compact-purchase")
      const lowestBadge = card.querySelector(".wh-badge-lowest")
      if (lowestBadge) {
        lowestBadge.hidden = true
      }
    }

    if (matches.length === 0) {
      setStatus(status, "현재 선택 가능한 판매조건이 없습니다.")
      return
    }

    setStatus(status, "")
    if (matches.length === 1) {
      matches[0].card.hidden = false
      matches[0].card.classList.add("wh-compact-purchase")
      return
    }

    results.classList.add("wh-comparison-grid")
    const lowest = matches.reduce((best, offer) => (offer.price < best.price ? offer : best))
    for (const offer of matches) {
      offer.card.hidden = false
      if (offer === lowest) {
        offer.card.classList.add("is-lowest")
        const lowestBadge = offer.card.querySelector(".wh-badge-lowest")
        if (lowestBadge) {
          lowestBadge.hidden = false
        }
      }
    }
  }

  function initializeSingleSupplier(root, offers, cards, status) {
    const dropdown = root.querySelector(".wh-spec-dropdown")
    if (!dropdown) {
      return
    }
    dropdown.addEventListener("change", () => {
      const selectedKey = dropdown.value
      if (!selectedKey) {
        renderMatches(root, cards, [], status)
        setStatus(status, "원하는 규격을 선택하면 구매 가능한 판매조건을 보여드립니다.")
        return
      }
      renderMatches(
        root,
        cards,
        offers.filter((offer) => offer.key === selectedKey),
        status,
      )
    })
  }

  function initializeMultiSupplier(root, offers, cards, dimensions, status) {
    const selection = {}
    const buttons = [...root.querySelectorAll(".wh-spec-pill")]

    function updateDependentControls() {
      for (const [index, dimension] of dimensions.entries()) {
        const earlierSelection = {}
        for (const earlierDimension of dimensions.slice(0, index)) {
          if (Object.hasOwn(selection, earlierDimension)) {
            earlierSelection[earlierDimension] = selection[earlierDimension]
          }
        }
        const available = new Set(availableValues(offers, earlierSelection, dimension))
        if (Object.hasOwn(selection, dimension) && !available.has(String(selection[dimension]))) {
          delete selection[dimension]
        }
        for (const button of buttons.filter((candidate) => candidate.dataset.dim === dimension)) {
          const enabled = available.has(String(button.dataset.val || ""))
          button.disabled = !enabled
          button.hidden = !enabled
          const active =
            Object.hasOwn(selection, dimension) &&
            String(selection[dimension]) === String(button.dataset.val || "")
          button.classList.toggle("active", active)
          button.setAttribute("aria-pressed", active ? "true" : "false")
        }
      }
    }

    function updateResults() {
      const complete = dimensions.every((dimension) => Object.hasOwn(selection, dimension))
      if (!complete) {
        renderMatches(root, cards, [], status)
        setStatus(status, "원하는 규격을 선택하면 구매 가능한 판매조건을 보여드립니다.")
        return
      }
      renderMatches(root, cards, matchingOffers(offers, selection, dimensions), status)
    }

    for (const button of buttons) {
      button.addEventListener("click", () => {
        const dimension = button.dataset.dim || ""
        const value = button.dataset.val || ""
        const dimensionIndex = dimensions.indexOf(dimension)
        if (dimensionIndex < 0) {
          return
        }
        if (Object.hasOwn(selection, dimension) && String(selection[dimension]) === value) {
          delete selection[dimension]
        } else {
          selection[dimension] = value
        }
        for (const laterDimension of dimensions.slice(dimensionIndex + 1)) {
          const compatible = availableValues(
            offers,
            Object.fromEntries(
              dimensions
                .slice(0, dimensions.indexOf(laterDimension))
                .filter((candidate) => Object.hasOwn(selection, candidate))
                .map((candidate) => [candidate, selection[candidate]]),
            ),
            laterDimension,
          )
          if (
            Object.hasOwn(selection, laterDimension) &&
            !compatible.includes(String(selection[laterDimension]))
          ) {
            delete selection[laterDimension]
          }
        }
        updateDependentControls()
        updateResults()
      })
    }

    updateDependentControls()
    if (dimensions.length === 0) {
      renderMatches(root, cards, offers, status)
    } else {
      updateResults()
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
    if (mode === "single-offer") {
      renderMatches(root, cards, offers.slice(0, 1), status)
    } else if (mode === "single-supplier") {
      initializeSingleSupplier(root, offers, cards, status)
    } else {
      initializeMultiSupplier(root, offers, cards, dimensions, status)
    }
  }

  function boot() {
    for (const root of document.querySelectorAll(".wh-option-a-ui[data-ui-mode]")) {
      initialize(root)
    }
  }

  window.WholesaleHubSupplierLanes = Object.freeze({
    availableValues,
    classifyMode,
    matchingOffers,
  })

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot)
  } else {
    boot()
  }
})(window, document)
