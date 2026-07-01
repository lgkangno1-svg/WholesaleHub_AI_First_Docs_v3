const POLICY_MESSAGE =
  "Product image repair is disabled: current WholesaleHub policy forbids image crawling and media attachment."

console.error(POLICY_MESSAGE)
process.exitCode = 1
