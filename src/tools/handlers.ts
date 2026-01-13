/**
 * FAERS MCP - Tool Handlers
 * 
 * FDA Adverse Event Reporting System (FAERS) tool implementations.
 * Uses OpenFDA API for drug safety data.
 */

import { ErrorCode, McpError, validateInput, audit } from "@sineai/mcp-core";

// ============================================================================
// CONFIGURATION
// ============================================================================

const OPENFDA_BASE_URL = "https://api.fda.gov/drug/event.json";

// API key from MCP config (env var). If not provided, uses free tier.
// Free tier: 240 requests/min, 1,000 requests/day per IP
// With key: 240 requests/min, 120,000 requests/day per key
const OPENFDA_API_KEY = process.env.OPENFDA_API_KEY || "";

// ============================================================================
// TYPES
// ============================================================================

interface FAERSSearchParams {
  search?: string;
  count?: string;
  limit?: number;
  skip?: number;
}

interface FAERSResponse {
  meta?: {
    disclaimer: string;
    terms: string;
    license: string;
    last_updated: string;
    results: {
      skip: number;
      limit: number;
      total: number;
    };
  };
  results?: any[];
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// DATA DISCLAIMER
// ============================================================================

const FAERS_DISCLAIMER = `
IMPORTANT DATA LIMITATIONS:
- A report in FAERS does NOT prove the drug caused the adverse event
- Reports are voluntarily submitted and may be incomplete or duplicated
- Reporting rates cannot be used to calculate incidence rates
- Many factors influence reporting (publicity, time on market, etc.)
- This data should not be the sole basis for clinical decisions
- Always consult healthcare professionals for medical advice

Source: FDA Adverse Event Reporting System (FAERS) via OpenFDA API
`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build URL for FAERS API request
 */
function buildUrl(params: FAERSSearchParams): string {
  const urlParams = new URLSearchParams();
  
  // Use API key from MCP config if provided
  if (OPENFDA_API_KEY) {
    urlParams.append("api_key", OPENFDA_API_KEY);
  }
  
  if (params.search) {
    urlParams.append("search", params.search);
  }
  
  if (params.count) {
    urlParams.append("count", params.count);
  }
  
  if (params.limit) {
    urlParams.append("limit", params.limit.toString());
  }
  
  if (params.skip) {
    urlParams.append("skip", params.skip.toString());
  }
  
  return `${OPENFDA_BASE_URL}?${urlParams.toString()}`;
}

/**
 * Fetch data from FAERS API
 */
async function fetchFAERS(params: FAERSSearchParams): Promise<FAERSResponse> {
  const url = buildUrl(params);
  
  try {
    const response = await fetch(url);
    const data = await response.json() as FAERSResponse;
    
    if (data.error) {
      throw new McpError(ErrorCode.InternalError, `FAERS API Error: ${data.error.message}`);
    }
    
    return data;
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `Failed to fetch FAERS data: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Format FAERS date (YYYYMMDD) to readable format
 */
function formatDate(dateStr: string): string {
  if (dateStr && dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  return dateStr;
}

/**
 * Build search query for drug name across multiple fields
 */
function buildDrugSearch(drugName: string): string {
  const escapedName = drugName.replace(/"/g, '\\"');
  return `(patient.drug.openfda.brand_name:"${escapedName}"+OR+patient.drug.openfda.generic_name:"${escapedName}"+OR+patient.drug.medicinalproduct:"${escapedName}")`;
}

/**
 * Build date range search filter
 */
function buildDateRangeSearch(startDate?: string, endDate?: string): string {
  if (!startDate && !endDate) return "";
  
  const start = startDate || "19000101";
  const end = endDate || "29991231";
  
  return `+AND+receivedate:[${start}+TO+${end}]`;
}

// ============================================================================
// TOOL HANDLERS
// ============================================================================

/**
 * Search adverse events by drug, reaction, date range
 */
async function handleSearchAdverseEvents(args: {
  drug_name: string;
  reaction?: string;
  start_date?: string;
  end_date?: string;
  serious?: boolean;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  if (args.reaction) validateInput(args.reaction);
  if (args.start_date) validateInput(args.start_date);
  if (args.end_date) validateInput(args.end_date);
  
  audit({ level: "info", event: "search_adverse_events", drug: args.drug_name });
  
  let search = buildDrugSearch(args.drug_name);
  
  if (args.reaction) {
    search += `+AND+patient.reaction.reactionmeddrapt:"${args.reaction}"`;
  }
  
  if (args.start_date || args.end_date) {
    search += buildDateRangeSearch(args.start_date, args.end_date);
  }
  
  if (args.serious) {
    search += "+AND+serious:1";
  }
  
  const data = await fetchFAERS({
    search,
    limit: Math.min(args.limit || 10, 100),
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No adverse event reports found for "${args.drug_name}"`,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  const results = data.results.map((report: any) => ({
    report_id: report.safetyreportid,
    receive_date: formatDate(report.receivedate),
    serious: report.serious === "1",
    patient: {
      age: report.patient?.patientonsetage 
        ? `${report.patient.patientonsetage} ${report.patient.patientonsetageunit}` 
        : "Unknown",
      sex: report.patient?.patientsex === "1" 
        ? "Male" 
        : report.patient?.patientsex === "2" 
          ? "Female" 
          : "Unknown",
      weight: report.patient?.patientweight 
        ? `${report.patient.patientweight} kg` 
        : "Unknown",
    },
    reactions: report.patient?.reaction?.map((r: any) => r.reactionmeddrapt) || [],
    outcomes: report.patient?.reaction?.map((r: any) => r.reactionoutcome) || [],
    drugs: report.patient?.drug?.map((d: any) => ({
      name: d.medicinalproduct,
      indication: d.drugindication,
      role: d.drugcharacterization === "1" 
        ? "Suspect" 
        : d.drugcharacterization === "2" 
          ? "Concomitant" 
          : "Interacting",
    })) || [],
  }));
  
  return {
    total_matching: data.meta?.results?.total,
    returned: results.length,
    results,
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get aggregated event counts grouped by field
 */
async function handleGetEventCounts(args: {
  drug_name: string;
  group_by: string;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "get_event_counts", drug: args.drug_name, group_by: args.group_by });
  
  const countFieldMap: { [key: string]: string } = {
    reaction: "patient.reaction.reactionmeddrapt.exact",
    outcome: "patient.reaction.reactionoutcome",
    age: "patient.patientonsetage",
    sex: "patient.patientsex",
    country: "occurcountry.exact",
    reporter_type: "primarysource.qualification",
    route: "patient.drug.drugadministrationroute",
  };
  
  const countField = countFieldMap[args.group_by];
  if (!countField) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid group_by field: ${args.group_by}`);
  }
  
  const data = await fetchFAERS({
    search: buildDrugSearch(args.drug_name),
    count: countField,
    limit: args.limit || 20,
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No data found for "${args.drug_name}" grouped by ${args.group_by}`,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  // Format results based on group_by type
  const formattedResults = data.results.map((item: any) => {
    let term = item.term;
    
    // Translate coded values
    if (args.group_by === "sex") {
      term = item.term === 1 ? "Male" : item.term === 2 ? "Female" : "Unknown";
    } else if (args.group_by === "outcome") {
      const outcomeMap: { [key: number]: string } = {
        1: "Recovered",
        2: "Recovering",
        3: "Not recovered",
        4: "Recovered with sequelae",
        5: "Fatal",
        6: "Unknown",
      };
      term = outcomeMap[item.term] || item.term;
    } else if (args.group_by === "reporter_type") {
      const reporterMap: { [key: number]: string } = {
        1: "Physician",
        2: "Pharmacist",
        3: "Other health professional",
        4: "Lawyer",
        5: "Consumer",
      };
      term = reporterMap[item.term] || item.term;
    }
    
    return {
      [args.group_by]: term,
      count: item.count,
    };
  });
  
  return {
    drug: args.drug_name,
    grouped_by: args.group_by,
    results: formattedResults,
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Compare safety profiles across multiple drugs
 */
async function handleCompareSafetyProfiles(args: {
  drug_names: string[];
  top_n?: number;
}): Promise<unknown> {
  if (!args.drug_names || args.drug_names.length < 2 || args.drug_names.length > 5) {
    throw new McpError(ErrorCode.InvalidParams, "Please provide 2-5 drugs to compare");
  }
  
  for (const drug of args.drug_names) {
    validateInput(drug);
  }
  
  audit({ level: "info", event: "compare_safety_profiles", drugs: args.drug_names.join(", ") });
  
  const topN = args.top_n || 10;
  const comparisons: { [key: string]: any[] } = {};
  
  for (const drugName of args.drug_names) {
    const data = await fetchFAERS({
      search: buildDrugSearch(drugName),
      count: "patient.reaction.reactionmeddrapt.exact",
      limit: topN,
    });
    
    comparisons[drugName] = data.results?.map((item: any) => ({
      reaction: item.term,
      count: item.count,
    })) || [];
  }
  
  return {
    comparison: comparisons,
    note: "Counts are not normalized by usage - a drug with more reports may simply be more widely used",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get serious adverse events filtered by outcome type
 */
async function handleGetSeriousEvents(args: {
  drug_name: string;
  outcome_type?: string;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "get_serious_events", drug: args.drug_name, outcome_type: args.outcome_type });
  
  let search = buildDrugSearch(args.drug_name) + "+AND+serious:1";
  
  if (args.outcome_type) {
    const outcomeFieldMap: { [key: string]: string } = {
      death: "seriousnessdeath:1",
      hospitalization: "seriousnesshospitalization:1",
      life_threatening: "seriousnesslifethreatening:1",
      disability: "seriousnessdisabling:1",
      congenital_anomaly: "seriousnesscongenitalanomali:1",
      other_serious: "seriousnessother:1",
    };
    
    const outcomeFilter = outcomeFieldMap[args.outcome_type];
    if (outcomeFilter) {
      search += `+AND+${outcomeFilter}`;
    }
  }
  
  const data = await fetchFAERS({
    search,
    limit: args.limit || 10,
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No serious adverse events found for "${args.drug_name}"`,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  const results = data.results.map((report: any) => ({
    report_id: report.safetyreportid,
    receive_date: formatDate(report.receivedate),
    seriousness: {
      death: report.seriousnessdeath === "1",
      hospitalization: report.seriousnesshospitalization === "1",
      life_threatening: report.seriousnesslifethreatening === "1",
      disability: report.seriousnessdisabling === "1",
      congenital_anomaly: report.seriousnesscongenitalanomali === "1",
      other: report.seriousnessother === "1",
    },
    reactions: report.patient?.reaction?.map((r: any) => r.reactionmeddrapt) || [],
    patient_age: report.patient?.patientonsetage 
      ? `${report.patient.patientonsetage} ${report.patient.patientonsetageunit}` 
      : "Unknown",
  }));
  
  return {
    drug: args.drug_name,
    outcome_filter: args.outcome_type || "all serious",
    total_matching: data.meta?.results?.total,
    results,
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get reporting trends over time
 */
async function handleGetReportingTrends(args: {
  drug_name: string;
  granularity?: string;
  years?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  const granularity = args.granularity || "quarter";
  const years = args.years || 5;
  
  audit({ level: "info", event: "get_reporting_trends", drug: args.drug_name, granularity, years });
  
  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - years);
  
  const startDateStr = startDate.toISOString().slice(0, 10).replace(/-/g, "");
  const endDateStr = endDate.toISOString().slice(0, 10).replace(/-/g, "");
  
  const data = await fetchFAERS({
    search: buildDrugSearch(args.drug_name) + `+AND+receivedate:[${startDateStr}+TO+${endDateStr}]`,
    count: "receivedate",
    limit: 1000,
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No reporting trend data found for "${args.drug_name}"`,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  // Aggregate by granularity
  const aggregated: { [key: string]: number } = {};
  
  for (const item of data.results) {
    const dateStr = item.time || item.term?.toString();
    if (!dateStr) continue;
    
    let period: string;
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    
    switch (granularity) {
      case "year":
        period = year;
        break;
      case "month":
        period = `${year}-${month}`;
        break;
      case "quarter":
      default:
        const quarter = Math.ceil(parseInt(month) / 3);
        period = `${year}-Q${quarter}`;
    }
    
    aggregated[period] = (aggregated[period] || 0) + item.count;
  }
  
  // Sort chronologically
  const sortedTrends = Object.entries(aggregated)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, count]) => ({ period, count }));
  
  return {
    drug: args.drug_name,
    granularity,
    period: `${years} years`,
    trends: sortedTrends,
    note: "Increases in reports may reflect increased usage, publicity, or actual safety signals",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Search drugs by reaction
 */
async function handleSearchByReaction(args: {
  reaction: string;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.reaction);
  
  audit({ level: "info", event: "search_by_reaction", reaction: args.reaction });
  
  const data = await fetchFAERS({
    search: `patient.reaction.reactionmeddrapt:"${args.reaction}"`,
    count: "patient.drug.openfda.brand_name.exact",
    limit: args.limit || 20,
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No drugs found associated with reaction "${args.reaction}"`,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  return {
    reaction: args.reaction,
    drugs: data.results.map((item: any) => ({
      drug_name: item.term,
      report_count: item.count,
    })),
    note: "Higher counts may reflect more widely used drugs, not necessarily higher risk",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get concomitant drugs
 */
async function handleGetConcomitantDrugs(args: {
  drug_name: string;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "get_concomitant_drugs", drug: args.drug_name });
  
  const data = await fetchFAERS({
    search: buildDrugSearch(args.drug_name),
    count: "patient.drug.openfda.brand_name.exact",
    limit: (args.limit || 20) + 5, // Get extra to filter out the primary drug
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No concomitant drug data found for "${args.drug_name}"`,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  // Filter out the primary drug (case-insensitive)
  const primaryLower = args.drug_name.toLowerCase();
  const concomitants = data.results
    .filter((item: any) => !item.term.toLowerCase().includes(primaryLower))
    .slice(0, args.limit || 20);
  
  return {
    primary_drug: args.drug_name,
    concomitant_drugs: concomitants.map((item: any) => ({
      drug_name: item.term,
      co_report_count: item.count,
    })),
    note: "These are drugs commonly reported alongside the primary drug in AE reports - does not imply interaction",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get FAERS database information
 */
async function handleGetDataInfo(): Promise<unknown> {
  audit({ level: "info", event: "get_data_info" });
  
  // Make a minimal request to get metadata
  const data = await fetchFAERS({
    search: "receivedate:[20240101+TO+20241231]",
    limit: 1,
  });
  
  return {
    database: "FDA Adverse Event Reporting System (FAERS)",
    source: "OpenFDA API",
    api_documentation: "https://open.fda.gov/apis/drug/event/",
    last_updated: data.meta?.last_updated || "Unknown",
    coverage: "January 2004 - present",
    update_frequency: "Quarterly",
    api_key_status: OPENFDA_API_KEY ? "Configured (120,000 requests/day)" : "Not configured - using free tier (1,000 requests/day)",
    get_api_key: "https://open.fda.gov/apis/authentication/",
    limitations: [
      "Reports do NOT prove causation between drug and event",
      "Voluntary reporting - many events go unreported",
      "Duplicate and incomplete reports exist in the database",
      "Cannot calculate incidence rates (no denominator data)",
      "Reporting influenced by publicity, time on market, etc.",
      "Data quality varies by reporter and time period",
    ],
    proper_use: [
      "Signal detection - identifying potential safety issues for further investigation",
      "Hypothesis generation - not hypothesis confirmation",
      "Understanding reported adverse event patterns",
      "Comparing relative frequency of different reactions for a drug",
    ],
    disclaimer: FAERS_DISCLAIMER,
  };
}

// ============================================================================
// HANDLER ROUTER
// ============================================================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_adverse_events":
      return handleSearchAdverseEvents(args as Parameters<typeof handleSearchAdverseEvents>[0]);
    
    case "get_event_counts":
      return handleGetEventCounts(args as Parameters<typeof handleGetEventCounts>[0]);
    
    case "compare_safety_profiles":
      return handleCompareSafetyProfiles(args as Parameters<typeof handleCompareSafetyProfiles>[0]);
    
    case "get_serious_events":
      return handleGetSeriousEvents(args as Parameters<typeof handleGetSeriousEvents>[0]);
    
    case "get_reporting_trends":
      return handleGetReportingTrends(args as Parameters<typeof handleGetReportingTrends>[0]);
    
    case "search_by_reaction":
      return handleSearchByReaction(args as Parameters<typeof handleSearchByReaction>[0]);
    
    case "get_concomitant_drugs":
      return handleGetConcomitantDrugs(args as Parameters<typeof handleGetConcomitantDrugs>[0]);
    
    case "get_data_info":
      return handleGetDataInfo();
    
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
