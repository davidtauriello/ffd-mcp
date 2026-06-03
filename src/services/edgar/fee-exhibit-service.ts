/**
 * @fileoverview High-level service for fetching and parsing Exhibit 107 fee disclosures.
 * Orchestrates EdgarClient + FeeExhibitParser, locates fee exhibits in filing indexes.
 * @module services/edgar/fee-exhibit-service
 */

import type { EdgarClient } from "./edgar-client.js";
import { FeeExhibitParser } from "./fee-exhibit-parser.js";
import type { FilingFeeExhibit } from "./types.js";

const FEE_EXHIBIT_TYPES = new Set([
  "EX-FILING FEES",
  "EXFILINGFEES",
  "107",
]);

// High-confidence patterns that unambiguously identify fee exhibits.
const FEE_EXHIBIT_FILENAME_PATTERNS_PRIMARY = [
  /exfilingfee/i,
  /ex-filing/i,
  /filingfee/i,
];

// Lower-confidence patterns — "exhibit107" is ambiguous because filers also
// name Exhibit 10.7 as "exhibit107". We try these only after primary patterns
// fail, and we attempt to parse each candidate to verify it's actually a fee table.
const FEE_EXHIBIT_FILENAME_PATTERNS_SECONDARY = [
  /ex107/i,
  /exhibit107/i,
];

/**
 * All form types that can carry Exhibit 107.
 * Kept in sync with the canonical list exported from search-fee-filings.ts.
 * Duplicated here to avoid a circular dependency (service ← tool).
 */
const REGISTRATION_FORMS = [
  "S-1", "S-1/A", "S-3", "S-3/A", "S-4", "S-4/A",
  "S-11", "S-11/A",
  "F-1", "F-1/A", "F-3", "F-3/A", "F-4", "F-4/A",
  "F-6", "F-6/A",
  "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8",
  "SC TO-I", "SC TO-T",
  "PREM14A", "DEFM14A",
  "POS AM",
  "S-8", "S-8/A",
];

export class FeeExhibitService {
  private parser = new FeeExhibitParser();

  constructor(private client: EdgarClient) {}

  // ─── Fetch a known exhibit by accession + filename ───────────────────────────

  async fetchExhibitByUrl(
    cik: string,
    accessionNumber: string,
    filename: string,
    meta: { entityName: string; formType: string; filingDate: string }
  ): Promise<FilingFeeExhibit> {
    const html = await this.client.getFilingDocument(cik, accessionNumber, filename);
    const exhibitUrl = this.client.buildDocumentUrl(cik, accessionNumber, filename);

    return this.parser.parseExhibit(html, {
      cik,
      entityName: meta.entityName,
      accessionNumber,
      formType: meta.formType,
      filingDate: meta.filingDate,
      exhibitDocument: filename,
      exhibitUrl,
    });
  }

  // ─── Find and parse fee exhibits for a filing ────────────────────────────────

  async findAndParseFeeExhibit(
    cik: string,
    accessionNumber: string,
    meta: { entityName: string; formType: string; filingDate: string }
  ): Promise<FilingFeeExhibit | null> {
    const { docs } = await this.client.getFilingDocumentsWithRetry(
      cik,
      accessionNumber,
      meta.filingDate,
    );

    // Phase 1: exact type match (works when the index has exhibit types)
    const byType = docs.filter(
      (d) => FEE_EXHIBIT_TYPES.has(d.type?.toUpperCase?.() ?? "")
    );
    for (const doc of byType) {
      const result = await this.tryParseExhibit(cik, accessionNumber, doc.name, meta);
      if (result) return result;
    }

    // Phase 2: high-confidence filename patterns (e.g. "exfilingfee", "filingfee")
    const primaryMatches = docs.filter(
      (d) => FEE_EXHIBIT_FILENAME_PATTERNS_PRIMARY.some((p) => p.test(d.name))
    );
    for (const doc of primaryMatches) {
      const result = await this.tryParseExhibit(cik, accessionNumber, doc.name, meta);
      if (result) return result;
    }

    // Phase 3: ambiguous patterns (e.g. "exhibit107") — try each candidate and
    // validate that the parsed result looks like a real fee exhibit, not EX-10.7.
    const secondaryMatches = docs.filter(
      (d) => FEE_EXHIBIT_FILENAME_PATTERNS_SECONDARY.some((p) => p.test(d.name))
    );
    for (const doc of secondaryMatches) {
      const result = await this.tryParseExhibit(cik, accessionNumber, doc.name, meta);
      if (result && isFeeExhibit(result)) return result;
    }

    return null;
  }

  /**
   * Attempt to fetch and parse a single document as a fee exhibit.
   * Returns null on failure instead of throwing.
   */
  private async tryParseExhibit(
    cik: string,
    accessionNumber: string,
    filename: string,
    meta: { entityName: string; formType: string; filingDate: string }
  ): Promise<FilingFeeExhibit | null> {
    try {
      return await this.fetchExhibitByUrl(cik, accessionNumber, filename, meta);
    } catch {
      return null;
    }
  }

  // ─── Search a company's recent registration filings ──────────────────────────

  async getCompanyFeeExhibits(
    cik: string,
    options: {
      formTypes?: string[];
      limit?: number;
      startDate?: string;
    }
  ): Promise<FilingFeeExhibit[]> {
    const filings = await this.client.getCompanyFilings(cik);
    const recent = filings.filings.recent;

    const formFilter = options.formTypes?.length
      ? new Set(options.formTypes.map((f) => f.toUpperCase()))
      : new Set(REGISTRATION_FORMS.map((f) => f.toUpperCase()));

    const limit = options.limit ?? 5;
    const startDate = options.startDate ? new Date(options.startDate) : null;

    const matching: Array<{ acc: string; date: string; form: string; primary: string }> = [];

    for (let i = 0; i < recent.accessionNumber.length; i++) {
      const form = recent.form[i] ?? "";
      const date = recent.filingDate[i] ?? "";
      if (!formFilter.has(form.toUpperCase())) continue;
      if (startDate && new Date(date) < startDate) continue;
      matching.push({
        acc: (recent.accessionNumber[i] ?? "").replace(/\//g, "-"),
        date,
        form,
        primary: recent.primaryDocument[i] ?? "",
      });
      if (matching.length >= limit) break;
    }

    const results: FilingFeeExhibit[] = [];
    const errors: Array<{ accession: string; form: string; error: string }> = [];
    for (const m of matching) {
      try {
        const exhibit = await this.findAndParseFeeExhibit(cik, m.acc, {
          entityName: filings.name,
          formType: m.form,
          filingDate: m.date,
        });
        if (exhibit) results.push(exhibit);
      } catch (err) {
        errors.push({
          accession: m.acc,
          form: m.form,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (results.length === 0 && errors.length > 0) {
      console.warn(
        `[fee-exhibit-service] ${cik}: found ${matching.length} filings but all exhibit parses failed:`,
        errors,
      );
    }

    return results;
  }

  // ─── Format a fee exhibit as readable text ───────────────────────────────────

  static format(ex: FilingFeeExhibit): string {
    const lines: string[] = [
      `=== Exhibit 107 Filing Fee Disclosure ===`,
      `Company:    ${ex.entityName}`,
      `CIK:        ${ex.cik}`,
      `Accession:  ${ex.accessionNumber}`,
      `Form:       ${ex.formType}`,
      `Filed:      ${ex.filingDate}`,
      `URL:        ${ex.exhibitUrl}`,
      ``,
      `--- Table 1: Security Classes & Fees ---`,
    ];

    if (ex.lineItems.length === 0) {
      lines.push("  (no line items found)");
    } else {
      for (const item of ex.lineItems) {
        lines.push(
          `  [${item.row}] ${item.securityType} — ${item.classTitle}`,
          `      Rule: ${item.feeCalcRule ?? "—"}`,
          `      Max Aggregate Offering: ${fmtMoney(item.maxAggregateOffering)}`,
          `      Fee Rate: ${item.feeRate != null ? (item.feeRate * 100).toFixed(6) + "%" : "—"}`,
          `      Fee Amount: ${fmtMoney(item.feeAmount)}`,
          ``
        );
      }
    }

    lines.push(
      `--- Totals ---`,
      `  Total Offering:       ${fmtMoney(ex.totalOffering)}`,
      `  Total Fee:            ${fmtMoney(ex.totalFee)}`,
      `  Previously Paid:      ${fmtMoney(ex.totalPreviouslyPaid)}`,
      `  Fee Offsets:          ${fmtMoney(ex.totalFeeOffset)}`,
      `  Net Fee Due:          ${fmtMoney(ex.netFeeDue)}`,
      `  Fee Rate:             ${ex.feeRate != null ? (ex.feeRate * 100).toFixed(6) + "%" : "—"}`
    );

    return lines.join("\n");
  }
}

/**
 * Validate that a parsed exhibit looks like an actual fee table,
 * not an unrelated document (e.g. Exhibit 10.7) that the HTML-table
 * fallback parser happened to extract rows from.
 */
function isFeeExhibit(ex: FilingFeeExhibit): boolean {
  // A real fee exhibit has at least one of: totalOffering, totalFee, netFeeDue,
  // or a line item with a feeAmount or maxAggregateOffering.
  if (ex.totalOffering != null && ex.totalOffering > 0) return true;
  if (ex.totalFee != null && ex.totalFee > 0) return true;
  if (ex.netFeeDue != null && ex.netFeeDue > 0) return true;
  if (ex.lineItems.some((li) => li.feeAmount != null && li.feeAmount > 0)) return true;
  if (ex.lineItems.some((li) => li.maxAggregateOffering != null && li.maxAggregateOffering > 0)) return true;
  return false;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Return a warning string if the most recent filing date is within the
 * EDGAR indexing lag window (48h). The submissions API lists filings
 * immediately, but per-document indexes and EFTS search can lag.
 */
export function recencyWarning(filingDate: string | undefined): string | null {
  if (!filingDate) return null;
  const filed = new Date(filingDate + "T00:00:00Z");
  const hoursAgo = (Date.now() - filed.getTime()) / (60 * 60 * 1000);
  if (hoursAgo <= 48) {
    return (
      `Note: This filing was accepted within the last ${Math.round(hoursAgo)}h. ` +
      `EDGAR's document index and full-text search can lag 24–48h behind acceptance. ` +
      `If the Exhibit 107 is not found, try again later. For 424B/S-3/S-8 filings, ` +
      `get_ffd_concepts_by_company can retrieve fee data from the companyfacts API ` +
      `(no lag), though S-1/F-1 data still requires document parsing.`
    );
  }
  return null;
}
