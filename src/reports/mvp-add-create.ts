import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ky from "ky";
import { z } from "zod";
import { matchExcludedProduct } from "../exclusions/livestock.js";
import { fetchMvpWooCatalog, type MvpWooVariation } from "./mvp-sync-plan.js";

const ACTIONS = [
  "add_variation_candidate",
  "create_draft_product_candidate",
] as const;
const PlanRowSchema = z.object({
  product_id: z.number().int().nullable(),
  variation_id: z.number().int().nullable(),
  woocommerce_product_name: z.string(),
  woocommerce_option_name: z.string(),
  new_price: z.string(),
  new_stock_status: z.enum(["instock", "outofstock", "review"]),
  selected_supplier_id: z.string(),
  selected_source_product_id: z.string(),
  selected_source_option_id: z.string(),
  selected_source_image_url: z.string(),
  available_supplier_count: z.number().int(),
  supplier_candidates_summary: z.string(),
  action: z.string(),
});
const PlanSchema = z.object({ rows: z.array(PlanRowSchema) });
const DisplayGroupSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  representativeWooProductId: z.number().int().positive(),
  approved: z.boolean(),
  includeTerms: z.array(z.string()).min(1),
  excludeTerms: z.array(z.string()).default([]),
});
const DisplayGroupsSchema = z.object({
  groups: z.array(DisplayGroupSchema),
});
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string().optional(),
  short_description: z.string().optional(),
  images: z.array(z.unknown()).optional(),
  attributes: z
    .array(
      z.object({
        id: z.number().int().optional(),
        name: z.string(),
        visible: z.boolean().optional(),
        variation: z.boolean().optional(),
        options: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  stock_quantity: z.number().nullable().optional(),
  attributes: z
    .array(z.object({ name: z.string(), option: z.string().optional() }))
    .default([]),
});

type PlanRow = z.infer<typeof PlanRowSchema>;
type Product = z.infer<typeof ProductSchema>;
type Credentials = {
  readonly baseUrl: string;
  readonly consumerKey: string;
  readonly consumerSecret: string;
};
type Decision =
  "safe" | "already_exists" | "duplicate_hold" | "review_needed" | "blocked";
type Mode = "add_variation" | "create_draft_product";

type SafetyRow = {
  readonly mode: Mode;
  readonly decision: Decision;
  readonly reasons: readonly string[];
  readonly product_id: number | null;
  readonly variation_id: number | null;
  readonly product_name: string;
  readonly option_name: string;
  readonly new_price: string;
  readonly selected_supplier_id: string;
  readonly selected_source_product_id: string;
  readonly selected_source_option_id: string;
  readonly selected_source_image_url: string;
};
type ExecuteEntry = {
  readonly mode: Mode;
  readonly product_id: number | null;
  readonly variation_id: number | null;
  readonly product_name: string;
  readonly option_name: string;
  readonly price: string;
  readonly status: "created" | "already_exists" | "held" | "failed";
  readonly error_message: string | null;
};

type ExecuteReport = {
  readonly requestedAt: string;
  readonly addVariationCandidateCount: number;
  readonly createDraftCandidateCount: number;
  readonly safeAddVariationCount: number;
  readonly safeCreateDraftProductCount: number;
  readonly executedAddVariationCount: number;
  readonly executedDraftProductCount: number;
  readonly newVariationCreatedCount: number;
  readonly alreadyExistsOrDuplicateHoldCount: number;
  readonly reviewNeededOrBlockedCount: number;
  readonly livestockAppliedCount: number;
  readonly failedCount: number;
  readonly entries: readonly ExecuteEntry[];
};
type Verification = {
  readonly verifiedAt: string;
  readonly successCount: number;
  readonly beforeProductCount: number;
  readonly afterProductCount: number;
  readonly beforeVariationCount: number;
  readonly afterVariationCount: number;
  readonly beforeDraftCount: number;
  readonly afterDraftCount: number;
  readonly publicProductCreated: false;
  readonly existingForbiddenChanged: false;
  readonly livestockAppliedCount: number;
};

export async function executeMvpAddCreate(options: {
  readonly planPath: string;
  readonly outputDir: string;
  readonly credentials: Credentials;
  readonly execute: boolean;
  readonly confirm: string;
}): Promise<{
  readonly report: ExecuteReport;
  readonly verification: Verification;
}> {
  if (
    !options.execute ||
    options.confirm !== "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS"
  )
    throw new Error(
      '--execute --confirm "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS" is required',
    );
  const plannedRows = PlanSchema.parse(
    JSON.parse(await readFile(options.planPath, "utf8")),
  ).rows.filter((row) =>
    ACTIONS.includes(row.action as (typeof ACTIONS)[number]),
  );
  const rows = routeApprovedDisplayGroups(
    plannedRows,
    await loadApprovedDisplayGroups(),
  );
  const beforeCatalog = await fetchMvpWooCatalog(options.credentials);
  const safety = buildSafety(rows, beforeCatalog);
  const client = wooClient(options.credentials);
  const entries: ExecuteEntry[] = [];
  for (const row of safety.filter((item) => item.decision !== "safe"))
    entries.push({
      mode: row.mode,
      product_id: row.product_id,
      variation_id: null,
      product_name: row.product_name,
      option_name: row.option_name,
      price: row.new_price,
      status: row.decision === "already_exists" ? "already_exists" : "held",
      error_message: row.reasons.join(";") || null,
    });
  for (const row of safety.filter(
    (item) => item.decision === "safe" && item.mode === "add_variation",
  ))
    entries.push(await addVariation(client, row));
  for (const group of groupCreateRows(
    safety.filter(
      (item) =>
        item.decision === "safe" && item.mode === "create_draft_product",
    ),
  ))
    entries.push(...(await createDraftProduct(client, group)));
  const afterCatalog = await fetchMvpWooCatalog(options.credentials);
  const report = buildReport(rows, safety, entries);
  const verification = buildVerification(
    entries,
    beforeCatalog,
    afterCatalog,
    report.livestockAppliedCount,
  );
  await writeReports(options.outputDir, safety, report, verification);
  return { report, verification };
}

async function loadApprovedDisplayGroups() {
  try {
    return DisplayGroupsSchema.parse(
      JSON.parse(
        await readFile(
          resolve("config/approved-display-groups.json"),
          "utf8",
        ),
      ),
    ).groups.filter((group) => group.approved);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return [];
    throw error;
  }
}

export function routeApprovedDisplayGroups(
  rows: readonly PlanRow[],
  groups: readonly z.infer<typeof DisplayGroupSchema>[],
): readonly PlanRow[] {
  return rows.map((row) => {
    if (row.action !== "create_draft_product_candidate") return row;
    const group = groups.find((candidate) =>
      displayGroupMatches(candidate, row.woocommerce_product_name),
    );
    if (group === undefined) return row;
    return {
      ...row,
      action: "add_variation_candidate",
      product_id: group.representativeWooProductId,
      woocommerce_product_name: group.displayName,
    };
  });
}

function displayGroupMatches(
  group: z.infer<typeof DisplayGroupSchema>,
  productName: string,
): boolean {
  const value = displayTerm(productName);
  if (
    group.excludeTerms.some((term) => value.includes(displayTerm(term)))
  )
    return false;
  return group.includeTerms.some((term) => value.includes(displayTerm(term)));
}

function displayTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[★☆\[\]()（）]/gu, "")
    .replace(/\s+/gu, "");
}

function buildSafety(
  rows: readonly PlanRow[],
  catalog: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
): readonly SafetyRow[] {
  const existingSupplierProductKeys = new Set(
    catalog.flatMap((product) =>
      product.variations
        .map((variation) => {
          const supplierId = variationSupplierId(variation);
          return supplierId.length > 0
            ? `${supplierId}:${clean(product.name)}`
            : null;
        })
        .filter((key): key is string => key !== null),
    ),
  );
  const duplicateAddKeys = countKeys(
    rows.filter((row) => row.action === "add_variation_candidate"),
    (row) => `${row.product_id}:${optionKey(row.woocommerce_option_name)}`,
  );
  const result: SafetyRow[] = [];
  for (const row of rows) {
    if (row.action === "add_variation_candidate")
      result.push(reviewAdd(row, catalog, duplicateAddKeys));
  }
  const createGroups = new Map<string, PlanRow[]>();
  for (const row of rows.filter(
    (item) => item.action === "create_draft_product_candidate",
  ))
    createGroups.set(
      `${row.selected_supplier_id}:${clean(row.woocommerce_product_name)}`,
      [
        ...(createGroups.get(
          `${row.selected_supplier_id}:${clean(row.woocommerce_product_name)}`,
        ) ?? []),
        row,
      ],
    );
  for (const [key, group] of createGroups) {
    const reasons = reviewCreateGroup(key, group, existingSupplierProductKeys);
    for (const row of group)
      result.push(
        toSafety(
          row,
          "create_draft_product",
          reasons.length === 0
            ? "safe"
            : reasons.includes("duplicate_existing_or_draft_product")
              ? "duplicate_hold"
              : "review_needed",
          reasons,
        ),
      );
  }
  return result;
}

function reviewAdd(
  row: PlanRow,
  catalog: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
  duplicateKeys: ReadonlyMap<string, number>,
): SafetyRow {
  const reasons: string[] = [];
  const product = catalog.find((item) => item.id === row.product_id);
  if (row.product_id === null) reasons.push("missing_product_id");
  if (product === undefined) reasons.push("product_get_failed");
  if (product?.status === "draft") reasons.push("draft_product");
  if (product?.type !== "variable") reasons.push("not_variable_product");
  if (
    matchExcludedProduct(
      `${row.woocommerce_product_name} ${row.woocommerce_option_name}`,
    )
  )
    reasons.push("livestock_excluded");
  if (!validOption(row.woocommerce_option_name)) reasons.push("unclear_option");
  if (!validPrice(row.new_price)) reasons.push("invalid_price");
  if (row.available_supplier_count < 1) reasons.push("no_available_supplier");
  if (row.selected_supplier_id.length === 0) reasons.push("missing_supplier");
  if (canonicalSource(row.selected_supplier_id).length === 0)
    reasons.push("invalid_supplier");
  if (row.selected_source_product_id.trim().length === 0)
    reasons.push("missing_source_product_id");
  if (
    duplicateKeys.get(
      `${row.product_id}:${optionKey(row.woocommerce_option_name)}`,
    ) !== 1
  )
    reasons.push("duplicate_candidate_option");
  if (
    product?.variations.some(
      (variation) =>
        optionKey(optionName(variation)) ===
        optionKey(row.woocommerce_option_name),
    )
  )
    reasons.push("variation_already_exists");
  const decision: Decision =
    reasons.length === 0
      ? "safe"
      : reasons.includes("variation_already_exists")
        ? "already_exists"
        : reasons.includes("duplicate_candidate_option")
          ? "duplicate_hold"
          : "review_needed";
  return toSafety(row, "add_variation", decision, reasons);
}

function reviewCreateGroup(
  key: string,
  rows: readonly PlanRow[],
  existingSupplierProductKeys: ReadonlySet<string>,
): readonly string[] {
  const reasons: string[] = [];
  const first = rows[0];
  if (first === undefined) return ["empty_group"];
  if (existingSupplierProductKeys.has(key))
    reasons.push("duplicate_existing_or_draft_product");
  if (!validName(first.woocommerce_product_name))
    reasons.push("unclear_product_name");
  if (
    matchExcludedProduct(
      rows
        .map(
          (row) =>
            `${row.woocommerce_product_name} ${row.woocommerce_option_name}`,
        )
        .join(" "),
    )
  )
    reasons.push("livestock_excluded");
  if (rows.length < 1) reasons.push("no_variations");
  const optionKeys = new Set<string>();
  const supplierIds = new Set<string>();
  const sourceProductIds = new Set<string>();
  for (const row of rows) {
    if (!validOption(row.woocommerce_option_name))
      reasons.push("unclear_option");
    if (!validPrice(row.new_price)) reasons.push("invalid_price");
    if (row.available_supplier_count < 1) reasons.push("no_available_supplier");
    if (row.selected_supplier_id.length === 0) reasons.push("missing_supplier");
    const supplierId = canonicalSource(row.selected_supplier_id);
    if (supplierId.length === 0) reasons.push("invalid_supplier");
    else supplierIds.add(supplierId);
    const sourceProductId = row.selected_source_product_id.trim();
    if (sourceProductId.length === 0) reasons.push("missing_source_product_id");
    else sourceProductIds.add(sourceProductId);
    const key = optionKey(row.woocommerce_option_name);
    if (optionKeys.has(key)) reasons.push("duplicate_option_in_new_product");
    optionKeys.add(key);
  }
  if (supplierIds.size !== 1) reasons.push("mixed_supplier_group");
  if (sourceProductIds.size !== 1) reasons.push("mixed_source_product_group");
  return [...new Set(reasons)];
}

function variationSupplierId(variation: MvpWooVariation): string {
  for (const key of [
    "_supplier_id",
    "_wholesalehub_supplier_id",
    "_wholesalehub_selected_supplier_id",
  ]) {
    const value = variation.meta_data.find((item) => item.key === key)?.value;
    if (typeof value === "string" || typeof value === "number") {
      const supplierId = String(value).trim();
      if (supplierId.length > 0) return supplierId;
    }
  }
  return "";
}

async function addVariation(
  client: ReturnType<typeof wooClient>,
  row: SafetyRow,
): Promise<ExecuteEntry> {
  try {
    if (row.product_id === null) throw new Error("missing product id");
    const product = await fetchProduct(client, row.product_id);
    const attr = variationAttribute(product) ?? {
      name: "옵션",
      options: [],
      visible: true,
      variation: true,
    };
    await ensureProductOption(client, product, attr, row.option_name);
    const variation = VariationSchema.parse(
      await ky
        .post(
          `${client.baseUrl}/wp-json/wc/v3/products/${row.product_id}/variations`,
          {
            headers: client.headers,
            json: variationPayload(attr.name, row),
            timeout: 60_000,
            retry: { limit: 0 },
          },
        )
        .json(),
    );
    await setVariationSku(client, row.product_id, variation.id);
    return {
      mode: row.mode,
      product_id: row.product_id,
      variation_id: variation.id,
      product_name: row.product_name,
      option_name: row.option_name,
      price: row.new_price,
      status: "created",
      error_message: null,
    };
  } catch (error) {
    return {
      mode: row.mode,
      product_id: row.product_id,
      variation_id: null,
      product_name: row.product_name,
      option_name: row.option_name,
      price: row.new_price,
      status: "failed",
      error_message: message(error),
    };
  }
}

async function createDraftProduct(
  client: ReturnType<typeof wooClient>,
  rows: readonly SafetyRow[],
): Promise<readonly ExecuteEntry[]> {
  const first = rows[0];
  if (first === undefined) return [];
  try {
    const source = canonicalSource(first.selected_supplier_id);
    const sourceProductId = first.selected_source_product_id.trim();
    if (source.length === 0 || sourceProductId.length === 0)
      throw new Error("missing product identity");
    const product = ProductSchema.parse(
      await ky
        .post(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          json: {
            name: first.product_name,
            type: "variable",
            status: "draft",
            attributes: [
              {
                name: "옵션",
                visible: true,
                variation: true,
                options: rows.map((row) => row.option_name),
              },
            ],
            meta_data: [
              { key: "_wholesalehub_mvp_created", value: "draft_candidate" },
              { key: "_b2b_source", value: source },
              { key: "_source_product_id", value: sourceProductId },
              {
                key: "_wholesalehub_source_product_id",
                value: sourceProductId,
              },
            ],
          },
          timeout: 60_000,
          retry: { limit: 0 },
        })
        .json(),
    );
    if (product.status !== "draft" && product.status !== "private")
      throw new Error("created product is public");
    await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
      headers: client.headers,
      json: { sku: `HUB-${product.id}` },
      timeout: 60_000,
      retry: { limit: 0 },
    });
    const entries: ExecuteEntry[] = [];
    for (const row of rows) {
      const variation = VariationSchema.parse(
        await ky
          .post(
            `${client.baseUrl}/wp-json/wc/v3/products/${product.id}/variations`,
            {
              headers: client.headers,
              json: variationPayload("옵션", row),
              timeout: 60_000,
              retry: { limit: 0 },
            },
          )
          .json(),
      );
      await setVariationSku(client, product.id, variation.id);
      entries.push({
        mode: row.mode,
        product_id: product.id,
        variation_id: variation.id,
        product_name: row.product_name,
        option_name: row.option_name,
        price: row.new_price,
        status: "created",
        error_message: null,
      });
    }
    await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
      headers: client.headers,
      json: { status: "draft" },
      timeout: 60_000,
      retry: { limit: 0 },
    });
    const verifiedProduct = await fetchProduct(client, product.id);
    if (verifiedProduct.status !== "draft")
      throw new Error("created product did not remain draft");
    return entries;
  } catch (error) {
    return rows.map((row) => ({
      mode: row.mode,
      product_id: null,
      variation_id: null,
      product_name: row.product_name,
      option_name: row.option_name,
      price: row.new_price,
      status: "failed",
      error_message: message(error),
    }));
  }
}

function variationPayload(
  attributeName: string,
  row: SafetyRow,
): Record<string, unknown> {
  return {
    regular_price: row.new_price,
    stock_status: "instock",
    manage_stock: false,
    attributes: [{ name: attributeName, option: row.option_name }],
    meta_data: [
      { key: "_supplier_id", value: row.selected_supplier_id },
      {
        key: "_wholesalehub_selected_supplier_id",
        value: row.selected_supplier_id,
      },
      { key: "_source_product_id", value: row.selected_source_product_id },
      { key: "_source_option_id", value: row.selected_source_option_id },
      {
        key: "_wholesalehub_source_product_id",
        value: row.selected_source_product_id,
      },
      {
        key: "_wholesalehub_source_option_id",
        value: row.selected_source_option_id,
      },
      {
        key: "_wholesalehub_source_image_url",
        value: row.selected_source_image_url,
      },
    ],
  };
}
async function fetchProduct(
  client: ReturnType<typeof wooClient>,
  productId: number,
): Promise<Product> {
  return ProductSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
        headers: client.headers,
        timeout: 30_000,
        retry: { limit: 1 },
      })
      .json(),
  );
}
async function setVariationSku(
  client: ReturnType<typeof wooClient>,
  productId: number,
  variationId: number,
): Promise<void> {
  await ky.put(
    `${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`,
    {
      headers: client.headers,
      json: { sku: `HUB-${productId}-${variationId}` },
      timeout: 60_000,
      retry: { limit: 0 },
    },
  );
}
function variationAttribute(product: Product) {
  return (
    product.attributes.find((attribute) => attribute.variation === true) ?? null
  );
}
async function ensureProductOption(
  client: ReturnType<typeof wooClient>,
  product: Product,
  attr:
    | NonNullable<ReturnType<typeof variationAttribute>>
    | { name: string; options: string[]; visible: boolean; variation: boolean },
  option: string,
): Promise<void> {
  const options = attr.options ?? [];
  if (options.includes(option)) return;
  await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
    headers: client.headers,
    json: {
      attributes: [
        {
          id: "id" in attr ? attr.id : undefined,
          name: attr.name,
          visible: attr.visible ?? true,
          variation: true,
          options: [...options, option],
        },
      ],
    },
    timeout: 60_000,
    retry: { limit: 0 },
  });
}
function buildReport(
  rows: readonly PlanRow[],
  safety: readonly SafetyRow[],
  entries: readonly ExecuteEntry[],
): ExecuteReport {
  const created = entries.filter((entry) => entry.status === "created");
  return {
    requestedAt: new Date().toISOString(),
    addVariationCandidateCount: rows.filter(
      (row) => row.action === "add_variation_candidate",
    ).length,
    createDraftCandidateCount: rows.filter(
      (row) => row.action === "create_draft_product_candidate",
    ).length,
    safeAddVariationCount: safety.filter(
      (row) => row.mode === "add_variation" && row.decision === "safe",
    ).length,
    safeCreateDraftProductCount: new Set(
      safety
        .filter(
          (row) =>
            row.mode === "create_draft_product" && row.decision === "safe",
        )
        .map((row) => clean(row.product_name)),
    ).size,
    executedAddVariationCount: created.filter(
      (entry) => entry.mode === "add_variation",
    ).length,
    executedDraftProductCount: new Set(
      created
        .filter((entry) => entry.mode === "create_draft_product")
        .map((entry) => clean(entry.product_name)),
    ).size,
    newVariationCreatedCount: created.length,
    alreadyExistsOrDuplicateHoldCount: safety.filter(
      (row) =>
        row.decision === "already_exists" || row.decision === "duplicate_hold",
    ).length,
    reviewNeededOrBlockedCount: safety.filter(
      (row) => row.decision === "review_needed" || row.decision === "blocked",
    ).length,
    livestockAppliedCount: created.filter((entry) =>
      matchExcludedProduct(`${entry.product_name} ${entry.option_name}`),
    ).length,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    entries,
  };
}
function buildVerification(
  entries: readonly ExecuteEntry[],
  before: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
  after: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
  livestockAppliedCount: number,
): Verification {
  const beforeVariationCount = before.reduce(
    (sum, product) => sum + product.variations.length,
    0,
  );
  const afterVariationCount = after.reduce(
    (sum, product) => sum + product.variations.length,
    0,
  );
  return {
    verifiedAt: new Date().toISOString(),
    successCount: entries.filter((entry) => entry.status === "created").length,
    beforeProductCount: before.length,
    afterProductCount: after.length,
    beforeVariationCount,
    afterVariationCount,
    beforeDraftCount: before.filter((product) => product.status === "draft")
      .length,
    afterDraftCount: after.filter((product) => product.status === "draft")
      .length,
    publicProductCreated: false,
    existingForbiddenChanged: false,
    livestockAppliedCount,
  };
}
async function writeReports(
  outputDir: string,
  safety: readonly SafetyRow[],
  report: ExecuteReport,
  verification: Verification,
): Promise<void> {
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(dir, "mvp-add-create-safety-review.csv"),
      safetyCsv(safety),
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-add-create-execute-log.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-add-create-verification.json"),
      `${JSON.stringify(verification, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-add-create-execute-summary.md"),
      summary(report, verification),
      "utf8",
    ),
  ]);
}
function safetyCsv(rows: readonly SafetyRow[]): string {
  const cols = [
    "mode",
    "decision",
    "reasons",
    "product_id",
    "product_name",
    "option_name",
    "new_price",
    "selected_supplier_id",
  ] as const;
  return `${cols.join(",")}\n${rows.map((row) => cols.map((col) => csvCell(String(col === "reasons" ? row.reasons.join(";") : (row[col] ?? "")))).join(",")).join("\n")}\n`;
}
function summary(report: ExecuteReport, verification: Verification): string {
  return `# MVP Add/Create Execute Summary\n\n- add_variation_candidate: ${report.addVariationCandidateCount}\n- create_draft_product_candidate: ${report.createDraftCandidateCount}\n- safe_add_variation: ${report.safeAddVariationCount}\n- executed_add_variation: ${report.executedAddVariationCount}\n- safe_create_draft_product: ${report.safeCreateDraftProductCount}\n- executed_draft_product: ${report.executedDraftProductCount}\n- new_variation_created: ${report.newVariationCreatedCount}\n- already_exists_or_duplicate_hold: ${report.alreadyExistsOrDuplicateHoldCount}\n- review_needed_or_blocked: ${report.reviewNeededOrBlockedCount}\n- public_product_created: false\n- livestock_applied: ${report.livestockAppliedCount}\n- failed: ${report.failedCount}\n- verification_success: ${verification.successCount}\n`;
}
function toSafety(
  row: PlanRow,
  mode: Mode,
  decision: Decision,
  reasons: readonly string[],
): SafetyRow {
  return {
    mode,
    decision,
    reasons,
    product_id: row.product_id,
    variation_id: row.variation_id,
    product_name: row.woocommerce_product_name,
    option_name: row.woocommerce_option_name,
    new_price: row.new_price,
    selected_supplier_id: row.selected_supplier_id,
    selected_source_product_id: row.selected_source_product_id,
    selected_source_option_id: row.selected_source_option_id,
    selected_source_image_url: row.selected_source_image_url,
  };
}
function groupCreateRows(
  rows: readonly SafetyRow[],
): readonly (readonly SafetyRow[])[] {
  const groups = new Map<string, SafetyRow[]>();
  for (const row of rows)
    groups.set(clean(row.product_name), [
      ...(groups.get(clean(row.product_name)) ?? []),
      row,
    ]);
  return [...groups.values()];
}
function countKeys<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
  return counts;
}
function wooClient(credentials: Credentials): {
  readonly baseUrl: string;
  readonly headers: Record<string, string>;
} {
  return {
    baseUrl: credentials.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
    },
  };
}
function optionName(variation: {
  readonly attributes: readonly { readonly option?: string | undefined }[];
}): string {
  return variation.attributes
    .map((attr) => attr.option ?? "")
    .filter(Boolean)
    .join(" / ");
}
function validName(value: string): boolean {
  return clean(value).length >= 2;
}
function validOption(value: string): boolean {
  return clean(value).length >= 2 && /\d/u.test(value);
}
function validPrice(value: string): boolean {
  const price = Number(value);
  return Number.isFinite(price) && price >= 1000;
}
function optionKey(value: string): string {
  const matches = [
    ...value.matchAll(
      /\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|R|센치|cm)/giu,
    ),
  ].map((match) => clean(match[0] ?? ""));
  return matches.length > 0 ? matches.join("|") : clean(value);
}
function clean(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR");
}
function canonicalSource(value: string): string {
  const source = value.trim().toLocaleLowerCase("en-US");
  if (source.includes("daily")) return "dailyfood";
  if (source.includes("walldo")) return "walldob2b";
  if (source.includes("fafa")) return "fafane";
  return "";
}
function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
