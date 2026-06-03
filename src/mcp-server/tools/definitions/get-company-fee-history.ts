/**
 * @fileoverview get_company_fee_history tool — fetch all fee exhibits for a company.
 * @module mcp-server/tools/definitions/get-company-fee-history
 */

import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { FeeExhibitService } from "../../../services/edgar/fee-exhibit-service.js";

export const getCompanyFeeHistorySchema = z.object({
  company: z.string().describe("Ticker symbol, company name, or CIK number"),
  form_types: z.array(z.string()).optional().describe("Filter to specific form types"),
  limit: z.number().int().min(1).max(10).optional().describe("Max filings to parse (default 5). Higher values are slower."),
  start_date: z.string().optional().describe("Only include filings on or after this date (YYYY-MM-DD)"),
});

type Input = z.infer<typeof getCompanyFeeHistorySchema>;

export async function handleGetCompanyFeeHistory(input: Input, client: EdgarClient) {
  const resolved = await client.resolveCik(input.company);
  const service = new FeeExhibitService(client);

  const opts: { formTypes?: string[]; limit?: number; startDate?: string } = {
    limit: input.limit ?? 5,
  };
  if (input.form_types) opts.formTypes = input.form_types;
  if (input.start_date) opts.startDate = input.start_date;

  const exhibits = await service.getCompanyFeeExhibits(resolved.cik, opts);

  if (exhibits.length === 0) {
    const text = `No Exhibit 107 fee disclosures found for ${resolved.name} (${resolved.cik}).`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { company: resolved.name, cik: resolved.cik, exhibits: [] },
    };
  }

  const grandTotalOffering = exhibits.reduce((s, e) => s + (e.totalOffering ?? 0), 0);
  const grandTotalFee = exhibits.reduce((s, e) => s + (e.netFeeDue ?? 0), 0);

  const sections = exhibits.map((ex) => FeeExhibitService.format(ex));
  const lines = [
    `=== Fee History: ${resolved.name} (${resolved.cik}) ===`,
    `Exhibits found: ${exhibits.length}`,
    `Grand total offering: $${grandTotalOffering.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    `Grand total net fees: $${grandTotalFee.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    "",
    ...sections,
  ];

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: {
      company: resolved.name,
      cik: resolved.cik,
      ticker: resolved.ticker,
      exhibitCount: exhibits.length,
      grandTotalOffering,
      grandTotalNetFees: grandTotalFee,
      exhibits,
    },
  };
}
