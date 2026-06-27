import { spawn } from "node:child_process"
import { z } from "zod"
import type { Walldob2bCandidate } from "./walldob2b-adapter.js"

const BASE_URL = "https://walldob2b.com"
const DEFAULT_DB_CONTAINER = "avocadoss-db"
const MAX_DB_CANDIDATES = 50

const WordPressRowSchema = z.object({
  productId: z.number().int(),
  productName: z.string(),
  location: z.string(),
  value: z.string(),
})

type WordPressCandidateRow = z.infer<typeof WordPressRowSchema>

export type WordPressDbCandidateOptions = {
  readonly containerName?: string
  readonly limit?: number
}

export type WordPressDbCandidate = Walldob2bCandidate & {
  readonly discoveryLocations: readonly string[]
}

export async function fetchWalldob2bCandidatesFromWordPressDb(
  options: WordPressDbCandidateOptions = {},
): Promise<readonly WordPressDbCandidate[]> {
  const rows = await runReadOnlyWordPressQuery(options.containerName ?? DEFAULT_DB_CONTAINER)
  return findWalldob2bCandidatesFromWordPressRows(rows, options.limit ?? MAX_DB_CANDIDATES)
}

export function findWalldob2bCandidatesFromWordPressRows(
  rows: readonly unknown[],
  limit = MAX_DB_CANDIDATES,
): readonly WordPressDbCandidate[] {
  const candidates = new Map<string, WordPressDbCandidate>()
  for (const row of z.array(WordPressRowSchema).parse(rows)) {
    for (const itId of extractItIds(row)) {
      const current = candidates.get(itId)
      const location = `${row.location}:${row.productId}`
      if (current === undefined) {
        candidates.set(itId, {
          wooProductId: row.productId,
          productName: row.productName,
          itId,
          sourceUrl: `${BASE_URL}/shop/item.php?it_id=${encodeURIComponent(itId)}`,
          discoveryLocations: [location],
        })
      } else if (!current.discoveryLocations.includes(location)) {
        candidates.set(itId, {
          ...current,
          discoveryLocations: [...current.discoveryLocations, location],
        })
      }
      if (candidates.size >= limit) {
        return [...candidates.values()]
      }
    }
  }
  return [...candidates.values()]
}

function extractItIds(row: WordPressCandidateRow): readonly string[] {
  if (row.location === "postmeta:_b2b_walldo_it_id" || row.location === "postmeta:_b2b_source") {
    return row.value.length > 0 ? [row.value] : []
  }
  return extractLinkedItIds(row.value)
}

function extractLinkedItIds(value: string): readonly string[] {
  const ids = new Set<string>()
  const pattern = /walldob2b\.com\/shop\/item\.php\?[^\s"'<>]*it_id=([A-Za-z0-9_-]+)/giu
  for (const match of value.matchAll(pattern)) {
    if (match[1] !== undefined) {
      ids.add(match[1])
    }
  }
  return [...ids]
}

async function runReadOnlyWordPressQuery(
  containerName: string,
): Promise<readonly WordPressCandidateRow[]> {
  const output = await runDockerMariaDb(containerName, WORDPRESS_CANDIDATE_SQL)
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => WordPressRowSchema.parse(JSON.parse(line)))
}

async function runDockerMariaDb(containerName: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      containerName,
      "sh",
      "-lc",
      'mariadb --batch --raw --skip-column-names -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"',
    ])
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"))
        return
      }
      reject(new WordPressDbReadError(Buffer.concat(stderr).toString("utf8").trim()))
    })
    child.stdin.end(sql)
  })
}

export class WordPressDbReadError extends Error {
  readonly name = "WordPressDbReadError"

  constructor(readonly detail: string) {
    super("Failed to read WordPress DB candidates")
  }
}

const WORDPRESS_CANDIDATE_SQL = `
SELECT JSON_OBJECT('productId', p.ID, 'productName', p.post_title, 'location', 'post_content', 'value', p.post_content)
FROM avcd_posts p
WHERE p.post_type = 'product'
  AND p.post_content LIKE '%walldob2b.com/shop/item.php?it_id=%'
UNION ALL
SELECT JSON_OBJECT('productId', p.ID, 'productName', p.post_title, 'location', 'post_excerpt', 'value', p.post_excerpt)
FROM avcd_posts p
WHERE p.post_type = 'product'
  AND p.post_excerpt LIKE '%walldob2b.com/shop/item.php?it_id=%'
UNION ALL
SELECT JSON_OBJECT('productId', p.ID, 'productName', p.post_title, 'location', 'postmeta:_b2b_walldo_it_id', 'value', pm.meta_value)
FROM avcd_postmeta pm
JOIN avcd_posts p ON p.ID = pm.post_id
WHERE p.post_type = 'product'
  AND pm.meta_key = '_b2b_walldo_it_id'
  AND pm.meta_value <> ''
UNION ALL
SELECT JSON_OBJECT('productId', p.ID, 'productName', p.post_title, 'location', 'postmeta:_b2b_source', 'value', idmeta.meta_value)
FROM avcd_postmeta source
JOIN avcd_postmeta idmeta ON idmeta.post_id = source.post_id AND idmeta.meta_key = '_b2b_walldo_it_id'
JOIN avcd_posts p ON p.ID = source.post_id
WHERE p.post_type = 'product'
  AND source.meta_key = '_b2b_source'
  AND source.meta_value = 'walldob2b'
UNION ALL
SELECT JSON_OBJECT('productId', p.ID, 'productName', p.post_title, 'location', CONCAT('postmeta:', pm.meta_key), 'value', pm.meta_value)
FROM avcd_postmeta pm
JOIN avcd_posts p ON p.ID = pm.post_id
WHERE p.post_type = 'product'
  AND pm.meta_value LIKE '%walldob2b.com/shop/item.php?it_id=%'
LIMIT 300;
`
