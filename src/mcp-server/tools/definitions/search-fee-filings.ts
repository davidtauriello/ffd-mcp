/**
 * @fileoverview search_fee_filings tool — find registration filings with Exhibit 107.
 * @module mcp-server/tools/definitions/search-fee-filings
 */

import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { recencyWarning } from "../../../services/edgar/fee-exhibit-service.js";

/**
 * All form types that can carry Exhibit 107 (EX-FILING FEES).
 * Kept in a single exported constant so every tool that needs the list
 * references the same source of truth.
 */
export const REGISTRATION_FORMS = [
  // Primary domestic registration statements
  "S-1", "S-1/A", "S-3", "S-3/A", "S-4", "S-4/A",
  "S-11", "S-11/A",
  // Foreign private issuer forms
  "F-1", "F-1/A", "F-3", "F-3/A", "F-4", "F-4/A",
  "F-6", "F-6/A",
  // Prospectus supplements (424B series)
  "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8",
  // Tender offers and merger proxies
  "SC TO-I", "SC TO-T",
  "PREM14A", "DEFM14A",
  // Post-effective amendments
  "POS AM",
];

export const searchFeeFilingsSchema = z.object({
  company: z.string().describe("Ticker symbol, company name, or CIK number"),
  form_types: z.array(z.string()).optional().describe("Filter to specific form types (e.g. ['S-1', 'S-3']). Defaults to all registration forms."),
  limit: z.number().int().min(1).max(20).optional().describe("Max filings to return (default 10)"),
});

type Input = z.infer<typeof searchFeeFilingsSchema>;

export async function handleSearchFeeFilings(input: Input, client: EdgarClient) {
  const resolved = await client.resolveCik(input.company);
  const filings = await client.getCompanyFilings(resolved.cik);
  const recent = filings.filings.recent;

  const formFilter = input.form_types?.length
    ? new Set(input.form_types.map((f) => f.toUpperCase()))
    : new Set(REGISTRATION_FORMS.map((f) => f.toUpperCase()));

  const limit = input.limit ?? 10;
  const results: Array<{
    accessionNumber: string;
    formType: string;
    filingDate: string;
    primaryDocument: string;
    edgarUrl: string;
  }> = [];

  for (let i = 0; i < recent.accessionNumber.length && results.length < limit; i++) {
    const form = recent.form[i] ?? "";
    if (!formFilter.has(form.toUpperCase())) continue;

    const acc = recent.accessionNumber[i] ?? "";
    const accNoDash = acc.replace(/-/g, "");
    const cikNum = parseInt(resolved.cik, 10);

    results.push({
      accessionNumber: acc,
      formType: form,
      filingDate: recent.filingDate[i] ?? "",
      primaryDocument: recent.primaryDocument[i] ?? "",
      edgarUrl: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${acc}-index.htm`,
    });
  }

  const lines = [
    `Company: ${filings.name} (CIK ${resolved.cik}${resolved.ticker ? `, ${resolved.ticker}` : ""})`,
    `Found ${results.length} registration statement filing(s):`,
    "",
  ];

  for (const r of results) {
    lines.push(
      `  ${r.formType} — ${r.filingDate}`,
      `    Accession: ${r.accessionNumber}`,
      `    URL: ${r.edgarUrl}`,
      "",
    );
  }

  if (results.length === 0) {
    lines.push("  (no registration filings found)");
  }

  // Surface indexing-lag advisory when the most recent result is very fresh
  const latestDate = results[0]?.filingDate;
  const warning = recencyWarning(latestDate);
  if (warning) lines.push("", warning);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: {
      company: filings.name,
      cik: resolved.cik,
      ticker: resolved.ticker,
      filings: results,
      ...(warning ? { indexingLagWarning: warning } : {}),
    },
  };
}
