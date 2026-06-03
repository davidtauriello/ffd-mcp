/**
 * @fileoverview Form types resource — registration forms that require Exhibit 107.
 * @module mcp-server/resources/definitions/form-types
 */

export const FORM_TYPES_URI = "ffd://form-types";

export function getFormTypesResource() {
  return {
    uri: FORM_TYPES_URI,
    mimeType: "text/markdown" as const,
    text: FORM_TYPES_MARKDOWN,
  };
}

const FORM_TYPES_MARKDOWN = `# Registration Form Types Requiring Exhibit 107

Exhibit 107 (EX-FILING FEES) is required on all registration statements filed with the SEC
since February 2022. The following form types include structured fee disclosures.

## Primary Registration Statements

| Form | Description | Typical Use |
|:-----|:------------|:------------|
| S-1 | Registration under Securities Act | IPOs and initial public offerings |
| S-1/A | Amendment to S-1 | Updated IPO filings |
| S-3 | Short-form registration | Shelf offerings by established issuers |
| S-3/A | Amendment to S-3 | Updated shelf registrations |
| S-11 | Real estate company registration | REIT offerings |
| S-11/A | Amendment to S-11 | Updated REIT filings |

## Foreign Private Issuer Forms

| Form | Description | Typical Use |
|:-----|:------------|:------------|
| F-1 | Foreign issuer registration | Foreign company IPOs |
| F-1/A | Amendment to F-1 | Updated foreign IPO filings |
| F-3 | Foreign issuer short-form | Foreign shelf offerings |
| F-3/A | Amendment to F-3 | Updated foreign shelf registrations |
| F-4 | Foreign business combinations | Cross-border M&A |
| F-4/A | Amendment to F-4 | Updated foreign M&A filings |

## Prospectus Supplements (424B Series)

| Form | Description | Typical Use |
|:-----|:------------|:------------|
| 424B1 | Prospectus filed under Rule 424(b)(1) | Final prospectus |
| 424B3 | Prospectus filed under Rule 424(b)(3) | Selling shareholder prospectus |
| 424B4 | Prospectus filed under Rule 424(b)(4) | Allocated offering prospectus |
| 424B5 | Prospectus filed under Rule 424(b)(5) | Shelf takedown supplement |

## Tender Offers & Merger Proxies

| Form | Description | Typical Use |
|:-----|:------------|:------------|
| SC TO-I | Tender offer by issuer | Share buyback tenders |
| SC TO-T | Tender offer by third party | Acquisition tenders |
| PREM14A | Preliminary proxy — merger | Pre-vote merger disclosure |
| DEFM14A | Definitive proxy — merger | Final merger proxy |

## Key Dates

- **Feb 2022**: Exhibit 107 became mandatory for electronic filers
- **Pre-2022**: Fee data was embedded in cover pages, not separately tagged
`;
