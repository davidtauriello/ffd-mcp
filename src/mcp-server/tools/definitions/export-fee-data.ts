/**
 * @fileoverview export_fee_data tool — query SEC fee data and save as CSV.
 *
 * Supports three export modes:
 *  - "fee_history"  — one row per filing with summary totals (from get_company_fee_history)
 *  - "line_items"   — one row per security class across all filings (detailed breakdown)
 *  - "ffd_concepts" — one row per ffd: fact entry (from get_ffd_concepts_by_company)
 *
 * Writes the CSV to the specified output_path (or a default based on ticker + mode).
 *
 * @module mcp-server/tools/definitions/export-fee-data
 */

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { FeeExhibitService } from "../../../services/edgar/fee-exhibit-service.js";
// types used indirectly via FeeExhibitService returns
import { handleGetFfdConceptsByCompany } from "./get-ffd-concepts-by-company.js";

export const exportFeeDataSchema = z.object({
  company: z
    .string()
    .describe("Ticker symbol, company name, or CIK number"),
  mode: z
    .enum(["fee_history", "line_items", "ffd_concepts"])
    .describe(
      "Export mode: " +
      '"fee_history" = one row per filing with summary totals; ' +
      '"line_items" = one row per security class across all filings; ' +
      '"ffd_concepts" = one row per ffd: XBRL fact (companyfacts + parsed exhibits)',
    ),
  output_path: z
    .string()
    .optional()
    .describe(
      "File path to write the CSV. Defaults to ./<TICKER>_<mode>.csv in the current directory.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max filings to fetch (default 10)"),
  form_types: z
    .array(z.string())
    .optional()
    .describe("Filter to specific form types (e.g. ['S-1', 'S-3'])"),
});

type Input = z.infer<typeof exportFeeDataSchema>;

export async function handleExportFeeData(input: Input, client: EdgarClient) {
  const resolved = await client.resolveCik(input.company);
  const label = resolved.ticker ?? resolved.cik;
  const defaultPath = `./${label}_${input.mode}.csv`;
  const outPath = resolve(input.output_path ?? defaultPath);

  let csv: string;
  let rowCount: number;

  switch (input.mode) {
    case "fee_history": {
      const { rows, text } = await exportFeeHistory(client, resolved.cik, input);
      csv = text;
      rowCount = rows;
      break;
    }
    case "line_items": {
      const { rows, text } = await exportLineItems(client, resolved.cik, input);
      csv = text;
      rowCount = rows;
      break;
    }
    case "ffd_concepts": {
      const { rows, text } = await exportFfdConcepts(client, input);
      csv = text;
      rowCount = rows;
      break;
    }
  }

  // Write to disk (best-effort — may fail in containerized environments
  // where output_path points to the MCP server's local filesystem).
  let writtenPath: string | null = null;
  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, csv, "utf-8");
    writtenPath = outPath;
  } catch {
    // Silently skip — the CSV text is returned in structuredContent
    // so the caller can reconstruct the file on their side.
  }

  const summary = writtenPath
    ? `Exported ${rowCount} rows to ${writtenPath} (mode: ${input.mode})`
    : `Generated ${rowCount} rows (mode: ${input.mode}). CSV data returned in response.`;

  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: {
      company: resolved.name,
      cik: resolved.cik,
      ticker: resolved.ticker,
      mode: input.mode,
      outputPath: writtenPath,
      rowCount,
      csvText: csv,
    },
  };
}

// ─── fee_history mode ─────────────────────────────────────────────────────────

async function exportFeeHistory(
  client: EdgarClient,
  cik: string,
  input: Input,
): Promise<{ rows: number; text: string }> {
  const service = new FeeExhibitService(client);
  const opts: { formTypes?: string[]; limit?: number } = {
    limit: input.limit ?? 10,
  };
  if (input.form_types) opts.formTypes = input.form_types;

  const exhibits = await service.getCompanyFeeExhibits(cik, opts);

  const headers = [
    "accession_number",
    "form_type",
    "filing_date",
    "entity_name",
    "cik",
    "exhibit_url",
    "submission_type",
    "total_offering",
    "total_fee",
    "previously_paid",
    "fee_offset",
    "net_fee_due",
    "fee_rate",
    "security_classes",
  ];

  const rows = exhibits.map((ex) => [
    ex.accessionNumber,
    ex.formType,
    ex.filingDate,
    ex.entityName,
    ex.cik,
    ex.exhibitUrl,
    ex.submissionType,
    num(ex.totalOffering),
    num(ex.totalFee),
    num(ex.totalPreviouslyPaid),
    num(ex.totalFeeOffset),
    num(ex.netFeeDue),
    num(ex.feeRate),
    String(ex.lineItems.length),
  ]);

  return { rows: rows.length, text: toCsv(headers, rows) };
}

// ─── line_items mode ──────────────────────────────────────────────────────────

async function exportLineItems(
  client: EdgarClient,
  cik: string,
  input: Input,
): Promise<{ rows: number; text: string }> {
  const service = new FeeExhibitService(client);
  const opts: { formTypes?: string[]; limit?: number } = {
    limit: input.limit ?? 10,
  };
  if (input.form_types) opts.formTypes = input.form_types;

  const exhibits = await service.getCompanyFeeExhibits(cik, opts);

  const headers = [
    "accession_number",
    "form_type",
    "filing_date",
    "entity_name",
    "row_num",
    "security_type",
    "class_title",
    "fee_calc_rule",
    "amount_registered",
    "price_per_unit",
    "max_aggregate_offering",
    "fee_rate",
    "fee_amount",
    "previously_paid",
  ];

  const rows: string[][] = [];
  for (const ex of exhibits) {
    for (const item of ex.lineItems) {
      rows.push([
        ex.accessionNumber,
        ex.formType,
        ex.filingDate,
        ex.entityName,
        String(item.row),
        item.securityType,
        item.classTitle,
        item.feeCalcRule ?? "",
        num(item.amountRegistered),
        num(item.pricePerUnit),
        num(item.maxAggregateOffering),
        num(item.feeRate),
        num(item.feeAmount),
        item.previouslyPaid ? "true" : "false",
      ]);
    }
  }

  return { rows: rows.length, text: toCsv(headers, rows) };
}

// ─── ffd_concepts mode ────────────────────────────────────────────────────────

async function exportFfdConcepts(
  client: EdgarClient,
  input: Input,
): Promise<{ rows: number; text: string }> {
  const result = await handleGetFfdConceptsByCompany(
    {
      company: input.company,
      form_types: input.form_types,
      limit: input.limit,
    },
    client,
  );

  const entries = (result.structuredContent as any).entries as Array<{
    concept: string;
    label: string;
    unit: string;
    value: number;
    filed: string;
    form: string;
    accession: string;
    periodEnd: string;
    periodStart?: string;
    fiscalYear?: number;
    fiscalPeriod?: string;
    source: string;
  }>;

  const headers = [
    "concept",
    "label",
    "value",
    "unit",
    "form",
    "filed",
    "accession",
    "period_end",
    "period_start",
    "fiscal_year",
    "fiscal_period",
    "source",
  ];

  const rows = entries.map((e) => [
    e.concept,
    e.label,
    String(e.value),
    e.unit,
    e.form,
    e.filed,
    e.accession,
    e.periodEnd,
    e.periodStart ?? "",
    e.fiscalYear != null ? String(e.fiscalYear) : "",
    e.fiscalPeriod ?? "",
    e.source,
  ]);

  return { rows: rows.length, text: toCsv(headers, rows) };
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function num(v: number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

function escapeCsv(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(","));
  }
  return lines.join("\n") + "\n";
}
