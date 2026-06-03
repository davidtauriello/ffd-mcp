/**
 * @fileoverview compare_fee_rates tool — compare fee data across 2-8 companies.
 * @module mcp-server/tools/definitions/compare-fee-rates
 */

import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { FeeExhibitService } from "../../../services/edgar/fee-exhibit-service.js";

export const compareFeeRatesSchema = z.object({
  companies: z.array(z.string()).min(2).max(8).describe("2-8 company identifiers (ticker, name, or CIK)"),
});

type Input = z.infer<typeof compareFeeRatesSchema>;

interface CompanyComparison {
  company: string;
  cik: string;
  ticker: string | null;
  formType: string | null;
  filingDate: string | null;
  totalOffering: number | null;
  netFeeDue: number | null;
  feeRate: number | null;
  error?: string;
}

export async function handleCompareFeeRates(input: Input, client: EdgarClient) {
  const service = new FeeExhibitService(client);
  const comparisons: CompanyComparison[] = [];

  for (const company of input.companies) {
    try {
      const resolved = await client.resolveCik(company);
      const exhibits = await service.getCompanyFeeExhibits(resolved.cik, { limit: 1 });

      const ex = exhibits[0];
      if (!ex) {
        comparisons.push({
          company: resolved.name,
          cik: resolved.cik,
          ticker: resolved.ticker,
          formType: null,
          filingDate: null,
          totalOffering: null,
          netFeeDue: null,
          feeRate: null,
          error: "No Exhibit 107 found",
        });
        continue;
      }

      comparisons.push({
        company: resolved.name,
        cik: resolved.cik,
        ticker: resolved.ticker,
        formType: ex.formType,
        filingDate: ex.filingDate,
        totalOffering: ex.totalOffering,
        netFeeDue: ex.netFeeDue,
        feeRate: ex.feeRate,
      });
    } catch (err) {
      comparisons.push({
        company,
        cik: "",
        ticker: null,
        formType: null,
        filingDate: null,
        totalOffering: null,
        netFeeDue: null,
        feeRate: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const lines = ["=== Filing Fee Comparison ===", ""];
  for (const c of comparisons) {
    lines.push(`${c.company}${c.ticker ? ` (${c.ticker})` : ""} — CIK ${c.cik}`);
    if (c.error) {
      lines.push(`  Error: ${c.error}`, "");
      continue;
    }
    lines.push(
      `  Form: ${c.formType ?? "—"}  Filed: ${c.filingDate ?? "—"}`,
      `  Total Offering: ${fmtMoney(c.totalOffering)}`,
      `  Net Fee Due:    ${fmtMoney(c.netFeeDue)}`,
      `  Fee Rate:       ${c.feeRate != null ? (c.feeRate * 100).toFixed(6) + "%" : "—"}`,
      "",
    );
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: { comparisons },
  };
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
