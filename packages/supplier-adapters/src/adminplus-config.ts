import { readFile } from "node:fs/promises"
import { parse } from "yaml"
import { z } from "zod"
import { ADMINPLUS_COLLECT_ONLY_FIELDS, type AdminPlusSitesConfig } from "./types.js"

const SiteSchema = z.object({
  supplier_id: z.string().min(1),
  supplier_name: z.string().min(1),
  enabled: z.boolean(),
  list_urls: z.array(z.url()).min(1),
  allowed_hosts: z.array(z.string().min(1)).min(1),
  allowed_path_prefixes: z.array(z.string().startsWith("/")).min(1),
  forbidden_path_patterns: z.array(z.string().startsWith("/")).min(1),
  collect_only: z.tuple([
    z.literal(ADMINPLUS_COLLECT_ONLY_FIELDS[0]),
    z.literal(ADMINPLUS_COLLECT_ONLY_FIELDS[1]),
    z.literal(ADMINPLUS_COLLECT_ONLY_FIELDS[2]),
    z.literal(ADMINPLUS_COLLECT_ONLY_FIELDS[3]),
    z.literal(ADMINPLUS_COLLECT_ONLY_FIELDS[4]),
  ]),
  selectors: z.object({
    row: z.string().min(1),
    product_name: z.string().min(1),
    option_text: z.string().min(1),
    price: z.string().min(1),
    stock_status: z.string().min(1),
    product_url: z.string().min(1),
    security_warning: z.string().min(1).optional(),
  }),
  out_of_stock_texts: z.array(z.string().min(1)).optional(),
  storage_state_path: z.string().min(1).optional(),
  max_pages: z.number().int().positive().max(20),
})

const ConfigSchema = z.object({
  schedule: z.object({
    timezone: z.literal("Asia/Seoul"),
    cron: z.literal("0 11 * * *"),
    max_runs_per_day: z.literal(1),
  }),
  sites: z.array(SiteSchema),
})

export class AdminPlusConfigError extends Error {
  readonly name = "AdminPlusConfigError"

  constructor(
    readonly configPath: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid AdminPlus sites config: ${configPath}`, options)
  }
}

export async function loadAdminPlusSitesConfig(configPath: string): Promise<AdminPlusSitesConfig> {
  try {
    const value = ConfigSchema.parse(parse(await readFile(configPath, "utf8")))
    return {
      schedule: {
        timezone: value.schedule.timezone,
        cron: value.schedule.cron,
        maxRunsPerDay: value.schedule.max_runs_per_day,
      },
      sites: value.sites.map((site) => ({
        supplierId: site.supplier_id,
        supplierName: site.supplier_name,
        enabled: site.enabled,
        listUrls: site.list_urls,
        allowedHosts: site.allowed_hosts,
        allowedPathPrefixes: site.allowed_path_prefixes,
        forbiddenPathPatterns: site.forbidden_path_patterns,
        collectOnly: site.collect_only,
        selectors: {
          row: site.selectors.row,
          productName: site.selectors.product_name,
          optionText: site.selectors.option_text,
          price: site.selectors.price,
          stockStatus: site.selectors.stock_status,
          productUrl: site.selectors.product_url,
          ...(site.selectors.security_warning === undefined
            ? {}
            : { securityWarning: site.selectors.security_warning }),
        },
        ...(site.out_of_stock_texts === undefined
          ? {}
          : { outOfStockTexts: site.out_of_stock_texts }),
        ...(site.storage_state_path === undefined
          ? {}
          : { storageStatePath: site.storage_state_path }),
        maxPages: site.max_pages,
      })),
    }
  } catch (error) {
    throw new AdminPlusConfigError(configPath, { cause: error })
  }
}
