/**
 * @fileoverview search_filings_by_fee tool — full-text search scoped to registration statements.
 * @module mcp-server/tools/definitions/search-filings-by-fee
 */

import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { REGISTRATION_FORMS } from "./search-fee-filings.js";

export const searchFilingsByFeeSchema = z.object({
  query: z.string().describe("Full-text search query. Supports phrases (\"exact match\"), boolean (AND/OR/NOT), and wildcards (*)."),
  forms: z.array(z.string()).optional().describe("Form types to search (defaults to registration statements)"),
  start_date: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
  end_date: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
});

type Input = z.infer<typeof searchFilingsByFeeSchema>;

export async function handleSearchFilingsByFee(input: Input, client: EdgarClient) {
  const forms = input.forms?.length ? input.forms : [...REGISTRATION_FORMS];
  const limit = input.limit ?? 20;

  const searchParams: { query: string; forms?: string[]; startDate?: string; endDate?: string; limit?: number } = {
    query: input.query,
    forms,
    limit,
  };
  if (input.start_date) searchParams.startDate = input.start_date;
  if (input.end_date) searchParams.endDate = input.end_date;

  const result = await client.searchFilings(searchParams);

  const hits = result.hits.hits.map((h) => ({
    id: h._id,
    entityName: h._source.entity_name,
    formType: h._source.form_type,
    fileDate: h._source.file_date,
    fileNum: h._source.file_num,
    location: h._source.biz_location,
  }));

  const lines = [
    `Search: "${input.query}"`,
    `Total matches: ${result.hits.total.value}`,
    `Showing: ${hits.length}`,
    "",
  ];

  for (const h of hits) {
    lines.push(
      `  ${h.entityName} — ${h.formType} (${h.fileDate})`,
      `    File #: ${h.fileNum ?? "—"}  Location: ${h.location ?? "—"}`,
      "",
    );
  }

  if (hits.length === 0) {
    lines.push("  (no results)");
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: {
      query: input.query,
      totalMatches: result.hits.total.value,
      results: hits,
    },
  };
}
