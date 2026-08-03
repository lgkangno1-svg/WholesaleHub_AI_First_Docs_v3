import { mkdir, readFile, writeFile } from "node:fs/promises"

const directory = process.argv[2] ?? "reports/rebuild"
const readJson = async (name, fallback) => {
  try {
    return JSON.parse(await readFile(`${directory}/${name}`, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw error
  }
}
const [snapshot, plan, sync] = await Promise.all([
  readJson("dailyfood-catalog-snapshot.json", {}),
  readJson("catalog-rebuild-plan.json", {}),
  readJson("catalog-sync-result.json", {}),
])
const key = (supplier, product, option) => `${supplier}|${product}|${option}`
const comparable = (policy) => {
  if (!policy || typeof policy !== "object") return null
  const { shipping_collected_at: _ignored, ...value } = policy
  return value
}
const planned = new Map(
  (plan.groups ?? []).flatMap((group) =>
    Object.values(group.lanes ?? {}).flatMap((lane) =>
      (lane.options ?? []).map((option) => [
        key(lane.supplierId, lane.sourceProductId, option.sourceOptionId),
        option,
      ]),
    ),
  ),
)
const mapped = new Map(
  (sync.shipping_mappings ?? []).map((row) => [
    key(row.supplier_id, row.source_product_id, row.source_option_id),
    row,
  ]),
)
const rows = (snapshot.products ?? []).flatMap((product) =>
  (product.options ?? []).map((option) => {
    const identity = key(product.supplierId, product.sourceProductId, option.sourceOptionId)
    const policy = option.shipping_policy ?? {}
    const planOption = planned.get(identity)
    const mapping = mapped.get(identity)
    return {
      source_product_id: product.sourceProductId,
      source_product_name: product.productName,
      source_option_id: option.sourceOptionId,
      source_option_name: option.optionName,
      source_price: option.price,
      source_stock: option.stockStatus,
      shipping_policy_type: policy.shipping_policy_type ?? "unknown",
      shipping_base_fee: policy.shipping_base_fee ?? 0,
      shipping_tiers: policy.shipping_tiers ?? [],
      shipping_jeju_extra_fee: policy.shipping_jeju_extra_fee ?? 0,
      shipping_remote_extra_fee: policy.shipping_remote_extra_fee ?? 0,
      shipping_raw_text: policy.shipping_raw_text ?? option.shipping ?? "",
      shipping_source: policy.shipping_source ?? "detail",
      shipping_validation_status: policy.shipping_validation_status ?? "review_required",
      shipping_collected_at: policy.shipping_collected_at ?? snapshot.generatedAt ?? "",
      eligible_for_sync: Boolean(planOption),
      exclusion_reason: planOption ? "" : "not_in_catalog_plan",
      woo_parent_id: mapping?.woo_parent_id ?? "",
      woo_variation_id: mapping?.woo_variation_id ?? "",
      public_offer_key: mapping?.public_offer_key ?? "",
      current_hub_shipping_metadata: mapping?.shipping_policy ?? null,
      previous_hub_shipping_metadata: mapping?.previous_shipping_policy ?? null,
      difference_from_source: mapping
        ? JSON.stringify(comparable(mapping.shipping_policy)) !== JSON.stringify(comparable(policy))
        : true,
    }
  }),
)
for (const exclusion of snapshot.exclusions ?? []) {
  if (!exclusion.sourceProductId) continue
  rows.push({
    source_product_id: exclusion.sourceProductId,
    source_product_name: exclusion.productName ?? "",
    source_option_id: exclusion.sourceOptionId ?? "",
    source_option_name: "",
    source_price: "",
    source_stock: "",
    shipping_policy_type: "unknown",
    shipping_base_fee: 0,
    shipping_tiers: [],
    shipping_jeju_extra_fee: 0,
    shipping_remote_extra_fee: 0,
    shipping_raw_text: "",
    shipping_source: "exclusion",
    shipping_validation_status: "review_required",
    shipping_collected_at: snapshot.generatedAt ?? "",
    eligible_for_sync: false,
    exclusion_reason: exclusion.reason ?? "excluded",
    woo_parent_id: "",
    woo_variation_id: "",
    public_offer_key: "",
    current_hub_shipping_metadata: null,
    previous_hub_shipping_metadata: null,
    difference_from_source: null,
  })
}
const optionRows = rows.filter((row) => row.source_option_id !== "" && row.shipping_source !== "exclusion")
const byType = Object.groupBy(optionRows, (row) => row.shipping_policy_type)
const productCount = (entries) => new Set(entries.map((row) => row.source_product_id)).size
const typeCount = (type) => ({
  products: productCount(byType[type] ?? []),
  options: (byType[type] ?? []).length,
})
const audit = {
  generatedAt: new Date().toISOString(),
  snapshot_complete: snapshot.complete === true,
  counts: {
    raw_products: snapshot.source?.rawListGroupCount ?? snapshot.source?.listGroupCount ?? 0,
    raw_options: optionRows.length,
    normal_detail_success: snapshot.source?.individualDetailSuccessCount ?? 0,
    collection_failures: (snapshot.crawlErrors ?? []).length,
    free: typeCount("free"),
    fixed: typeCount("fixed"),
    quantity_tiered: typeCount("quantity_tiered"),
    other_conditional: { products: 0, options: 0 },
    unknown: typeCount("unknown"),
    review_required: optionRows.filter((row) => row.shipping_validation_status !== "valid").length,
    source_hub_differences: optionRows.filter((row) => row.difference_from_source === true).length,
    policy_changes: (sync.shipping_mappings ?? []).filter((row) => row.shipping_policy_changed).length,
    policy_missing: optionRows.filter((row) => row.previous_hub_shipping_metadata === null).length,
    terminal_excluded: rows.filter((row) => row.exclusion_reason === "terminal_excluded").length,
  },
  rows,
}
const fields = Object.keys(rows[0] ?? {
  source_product_id: "", source_product_name: "", source_option_id: "", source_option_name: "",
  source_price: "", source_stock: "", shipping_policy_type: "", shipping_base_fee: "",
  shipping_tiers: "", shipping_jeju_extra_fee: "", shipping_remote_extra_fee: "", shipping_raw_text: "",
  shipping_source: "", shipping_validation_status: "", shipping_collected_at: "", eligible_for_sync: "",
  exclusion_reason: "", woo_parent_id: "", woo_variation_id: "", public_offer_key: "",
  current_hub_shipping_metadata: "", difference_from_source: "",
})
const csv = [fields.join(","), ...rows.map((row) => fields.map((field) => {
  const value = typeof row[field] === "object" && row[field] !== null ? JSON.stringify(row[field]) : String(row[field] ?? "")
  return `"${value.replaceAll('"', '""')}"`
}).join(","))].join("\n")
await mkdir(directory, { recursive: true })
await Promise.all([
  writeFile(`${directory}/daily-shipping-audit.json`, `${JSON.stringify(audit, null, 2)}\n`),
  writeFile(`${directory}/daily-shipping-audit.csv`, `${csv}\n`),
])
console.log(JSON.stringify({ rows: rows.length, counts: audit.counts }))
