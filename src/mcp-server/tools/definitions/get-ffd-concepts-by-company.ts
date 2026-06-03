/**
 * @fileoverview get_ffd_concepts_by_company — hybrid tool that merges two
 * data sources to build a complete ffd: fact history for a company.
 *
 * Phase 1 — companyfacts API (fast, no lag)
 *   data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 *   Covers 424B series, S-3/A, S-8 — but the SEC's XBRL pipeline does NOT
 *   index ffd: facts from S-1, S-1/A, F-1, or F-1/A filings.
 *
 * Phase 2 — submissions + Exhibit 107 parsing (backfills the gap)
 *   Scans the submissions API for registration forms whose accession numbers
 *   were NOT already covered by companyfacts, fetches each Exhibit 107, and
 *   extracts the summary-level ffd concepts (TtlOfferingAmt, TtlFeeAmt,
 *   NetFeeAmt, FeeRate) via the iXBRL parser.
 *
 * The combined result gives a complete picture regardless of form type.
 *
 * @module mcp-server/tools/definitions/get-ffd-concepts-by-company
 */

import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { FeeExhibitService } from "../../../services/edgar/fee-exhibit-service.js";
import type { FilingFeeExhibit } from "../../../services/edgar/types.js";
import { REGISTRATION_FORMS } from "./search-fee-filings.js";

export const getFfdConceptsByCompanySchema = z.object({
  company: z
    .string()
    .describe("Ticker symbol, company name, or CIK number"),
  concepts: z
    .array(z.string())
    .optional()
    .describe(
      "Filter to specific ffd concept tags (e.g. ['FeeAmt', 'NetFeeAmt']). " +
      "Omit to return every ffd: concept on file.",
    ),
  form_types: z
    .array(z.string())
    .optional()
    .describe(
      "Filter fact entries to specific form types (e.g. ['S-1', 'S-3']). " +
      "Omit to include all form types.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Max registration filings to parse in the Exhibit 107 backfill phase (default 10). " +
      "Only affects S-1/F-1 filings that companyfacts misses.",
    ),
});

type Input = z.infer<typeof getFfdConceptsByCompanySchema>;

/** One fact entry flattened for output. */
interface FfdFactEntry {
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
  source: "companyfacts" | "exhibit107";
}

export async function handleGetFfdConceptsByCompany(
  input: Input,
  client: EdgarClient,
) {
  const resolved = await client.resolveCik(input.company);

  const conceptFilter = input.concepts?.length
    ? new Set(input.concepts)
    : null;
  const formFilter = input.form_types?.length
    ? new Set(input.form_types.map((f) => f.toUpperCase()))
    : null;

  // ─── Phase 1: companyfacts (fast, covers 424B/S-3/S-8) ───────────────────

  const entries: FfdFactEntry[] = [];
  const coveredAccessions = new Set<string>();
  let companyfactsCount = 0;

  const facts = await client.getCompanyFacts(resolved.cik);
  const ffdTaxonomy = facts.facts["ffd"];

  if (ffdTaxonomy) {
    for (const [tag, conceptData] of Object.entries(ffdTaxonomy)) {
      if (conceptFilter && !conceptFilter.has(tag)) continue;

      for (const [unit, unitEntries] of Object.entries(conceptData.units)) {
        for (const entry of unitEntries) {
          if (formFilter && !formFilter.has(entry.form.toUpperCase())) continue;

          coveredAccessions.add(normalizeAccn(entry.accn));
          companyfactsCount++;

          const fact: FfdFactEntry = {
            concept: tag,
            label: conceptData.label,
            unit,
            value: entry.val,
            filed: entry.filed,
            form: entry.form,
            accession: entry.accn,
            periodEnd: entry.end,
            source: "companyfacts",
          };
          if (entry.fy !== undefined) fact.fiscalYear = entry.fy;
          if (entry.fp !== undefined) fact.fiscalPeriod = entry.fp;
          if (entry.start !== undefined) fact.periodStart = entry.start;
          entries.push(fact);
        }
      }
    }
  }

  // ─── Phase 2: submissions + Exhibit 107 parsing (backfills S-1/F-1 gap) ──

  const service = new FeeExhibitService(client);
  const filings = await client.getCompanyFilings(resolved.cik);
  const recent = filings.filings.recent;

  const regFormSet = new Set(REGISTRATION_FORMS.map((f) => f.toUpperCase()));
  const backfillLimit = input.limit ?? 10;
  let backfillAttempted = 0;
  let backfillParsed = 0;

  for (let i = 0; i < recent.accessionNumber.length && backfillAttempted < backfillLimit; i++) {
    const form = recent.form[i] ?? "";
    if (!regFormSet.has(form.toUpperCase())) continue;
    if (formFilter && !formFilter.has(form.toUpperCase())) continue;

    const acc = (recent.accessionNumber[i] ?? "").replace(/\//g, "-");
    // Skip filings already covered by companyfacts
    if (coveredAccessions.has(normalizeAccn(acc))) continue;

    backfillAttempted++;
    try {
      const exhibit = await service.findAndParseFeeExhibit(acc ? resolved.cik : "", acc, {
        entityName: filings.name,
        formType: form,
        filingDate: recent.filingDate[i] ?? "",
      });
      if (exhibit) {
        backfillParsed++;
        mergeExhibitIntoEntries(entries, exhibit, conceptFilter);
      }
    } catch {
      // skip unparseable filings
    }
  }

  // Sort newest first
  entries.sort((a, b) => (a.filed > b.filed ? -1 : a.filed < b.filed ? 1 : 0));

  // ─── Build concept summary ────────────────────────────────────────────────

  const conceptMap = new Map<string, { label: string; forms: Set<string>; count: number }>();
  for (const e of entries) {
    const existing = conceptMap.get(e.concept);
    if (existing) {
      existing.forms.add(e.form);
      existing.count++;
    } else {
      conceptMap.set(e.concept, { label: e.label, forms: new Set([e.form]), count: 1 });
    }
  }
  const conceptSummaries = [...conceptMap.entries()].map(([concept, v]) => ({
    concept,
    label: v.label,
    entryCount: v.count,
    forms: [...v.forms].sort(),
  }));

  // ─── Build text output ────────────────────────────────────────────────────

  const lines: string[] = [
    `=== FFD Concepts: ${facts.entityName} ===`,
    `CIK: ${facts.cik}${resolved.ticker ? `  Ticker: ${resolved.ticker}` : ""}`,
    ``,
    `Sources:`,
    `  companyfacts API:     ${companyfactsCount} entries (covers 424B, S-3/A, S-8)`,
    `  Exhibit 107 parsing:  ${backfillParsed} filings parsed from ${backfillAttempted} checked (covers S-1, F-1, etc.)`,
    ``,
    `Concepts found: ${conceptSummaries.length}`,
    `Total fact entries: ${entries.length}`,
  ];

  if (conceptSummaries.length === 0) {
    lines.push(
      "",
      "No ffd: data found from either source.",
      "This company may not have filed an Exhibit 107, or filings predate the Feb 2022 mandate.",
    );
  } else {
    lines.push("", "--- Concept Summary ---");
    for (const s of conceptSummaries) {
      lines.push(
        `  ${s.concept} (${s.label})`,
        `    Entries: ${s.entryCount}  Forms: ${s.forms.join(", ")}`,
      );
    }

    lines.push("", "--- Recent Entries (newest first) ---");
    const preview = entries.slice(0, 30);
    for (const e of preview) {
      const valStr =
        e.unit === "USD"
          ? "$" + e.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : String(e.value);
      const src = e.source === "exhibit107" ? " [parsed]" : "";
      lines.push(
        `  ${e.concept} = ${valStr}  (${e.form}, filed ${e.filed}${src})`,
      );
    }
    if (entries.length > 30) {
      lines.push(`  ... and ${entries.length - 30} more entries`);
    }
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: {
      company: facts.entityName,
      cik: String(facts.cik),
      ticker: resolved.ticker,
      sources: {
        companyfacts: { entries: companyfactsCount },
        exhibit107: { attempted: backfillAttempted, parsed: backfillParsed },
      },
      concepts: conceptSummaries,
      entries,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize accession number to dashed form for dedup. */
function normalizeAccn(accn: string): string {
  // companyfacts uses "0001234567-24-000001", submissions may use slashes
  return accn.replace(/\//g, "-").trim();
}

/**
 * Extract summary-level ffd concepts from a parsed Exhibit 107 and append
 * them to the entries array in the same shape as companyfacts entries.
 */
function mergeExhibitIntoEntries(
  entries: FfdFactEntry[],
  exhibit: FilingFeeExhibit,
  conceptFilter: Set<string> | null,
) {
  const summaryFacts: Array<{ concept: string; label: string; value: number | null; unit: string }> = [
    { concept: "TtlOfferingAmt", label: "Total Offering Amount", value: exhibit.totalOffering, unit: "USD" },
    { concept: "TtlFeeAmt", label: "Total Fee Amount", value: exhibit.totalFee, unit: "USD" },
    { concept: "NetFeeAmt", label: "Net Fee Due", value: exhibit.netFeeDue, unit: "USD" },
    { concept: "TtlPrevlyPdAmt", label: "Total Previously Paid", value: exhibit.totalPreviouslyPaid, unit: "USD" },
    { concept: "TtlOffsetAmt", label: "Total Fee Offset", value: exhibit.totalFeeOffset, unit: "USD" },
    { concept: "FeeRate", label: "Fee Rate", value: exhibit.feeRate, unit: "pure" },
  ];

  for (const sf of summaryFacts) {
    if (sf.value == null) continue;
    if (conceptFilter && !conceptFilter.has(sf.concept)) continue;

    const fact: FfdFactEntry = {
      concept: sf.concept,
      label: sf.label,
      unit: sf.unit,
      value: sf.value,
      filed: exhibit.filingDate,
      form: exhibit.formType,
      accession: exhibit.accessionNumber,
      periodEnd: exhibit.filingDate,
      source: "exhibit107",
    };
    entries.push(fact);
  }

  // Also add per-line-item FeeAmt entries so individual security class fees appear
  for (const item of exhibit.lineItems) {
    if (item.feeAmount == null) continue;
    if (conceptFilter && !conceptFilter.has("FeeAmt")) continue;

    const fact: FfdFactEntry = {
      concept: "FeeAmt",
      label: `Fee Amount — ${item.classTitle}`,
      unit: "USD",
      value: item.feeAmount,
      filed: exhibit.filingDate,
      form: exhibit.formType,
      accession: exhibit.accessionNumber,
      periodEnd: exhibit.filingDate,
      source: "exhibit107",
    };
    entries.push(fact);
  }
}
