/**
 * @fileoverview get_fee_exhibit tool — fetch and parse a specific Exhibit 107.
 * @module mcp-server/tools/definitions/get-fee-exhibit
 */

import { z } from "zod";
import type { EdgarClient } from "../../../services/edgar/edgar-client.js";
import { FeeExhibitService, recencyWarning } from "../../../services/edgar/fee-exhibit-service.js";

export const getFeeExhibitSchema = z.object({
  accession_number: z.string().describe("SEC filing accession number (e.g. 0001234567-24-000001)"),
  cik: z.string().describe("Company CIK number (10-digit zero-padded or raw integer)"),
  exhibit_filename: z.string().optional().describe("Exhibit 107 document filename for faster parsing. If omitted, auto-detected from the filing index."),
});

type Input = z.infer<typeof getFeeExhibitSchema>;

export async function handleGetFeeExhibit(input: Input, client: EdgarClient) {
  const service = new FeeExhibitService(client);
  const cik = input.cik.padStart(10, "0");

  const filings = await client.getCompanyFilings(cik);
  const meta = {
    entityName: filings.name ?? cik,
    formType: "",
    filingDate: "",
  };

  const recent = filings.filings.recent;
  const normalizedAcc = input.accession_number.replace(/\//g, "-");
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    if (recent.accessionNumber[i] === normalizedAcc) {
      meta.formType = recent.form[i] ?? "";
      meta.filingDate = recent.filingDate[i] ?? "";
      break;
    }
  }

  let exhibit;
  if (input.exhibit_filename) {
    exhibit = await service.fetchExhibitByUrl(cik, normalizedAcc, input.exhibit_filename, meta);
  } else {
    exhibit = await service.findAndParseFeeExhibit(cik, normalizedAcc, meta);
  }

  if (!exhibit) {
    const warning = recencyWarning(meta.filingDate);
    const msg = `No Exhibit 107 found in filing ${input.accession_number}.` +
      (warning ? `\n\n${warning}` : "");
    throw new Error(msg);
  }

  const text = FeeExhibitService.format(exhibit);
  const warning = recencyWarning(meta.filingDate);
  const fullText = warning ? `${text}\n\n${warning}` : text;

  return {
    content: [{ type: "text" as const, text: fullText }],
    structuredContent: exhibit,
  };
}
