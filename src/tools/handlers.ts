/**
 * FAERS MCP - Tool Handlers
 * 
 * FDA Adverse Event Reporting System (FAERS) tool implementations.
 * Uses OpenFDA API for drug safety data.
 */

import { ErrorCode, McpError, validateInput, audit, secrets } from "@sineai/mcp-core";

// ============================================================================
// CONFIGURATION
// ============================================================================

const OPENFDA_FAERS_URL = "https://api.fda.gov/drug/event.json";
const OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json";
const OPENFDA_ENFORCEMENT_URL = "https://api.fda.gov/drug/enforcement.json";

// API key cache - loaded once from env or Key Vault
let OPENFDA_API_KEY: string | null = null;

/**
 * Get OpenFDA API key from environment or Key Vault
 * Priority: 1) Environment variable, 2) Key Vault secret, 3) Free tier (empty)
 */
async function getApiKey(): Promise<string> {
  // Return cached value if already loaded
  if (OPENFDA_API_KEY !== null) {
    return OPENFDA_API_KEY;
  }
  
  // Check environment variable first (from MCP config)
  if (process.env.OPENFDA_API_KEY) {
    OPENFDA_API_KEY = process.env.OPENFDA_API_KEY;
    return OPENFDA_API_KEY;
  }
  
  // Try Key Vault
  try {
    const keyVaultKey = await secrets.get("openfda-api-key");
    if (keyVaultKey) {
      OPENFDA_API_KEY = keyVaultKey;
      return OPENFDA_API_KEY;
    }
  } catch {
    // Key Vault not available or secret not found
  }
  
  // Use free tier
  OPENFDA_API_KEY = "";
  return OPENFDA_API_KEY;
}

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
// COLOR SCHEMES FOR VISUALIZATION
// ============================================================================

const COLOR_SCHEMES = {
  outcomes: {
    "Recovered": "#22c55e",
    "Recovering": "#84cc16",
    "Not recovered": "#f59e0b",
    "Recovered with sequelae": "#f97316",
    "Fatal": "#ef4444",
    "Unknown": "#9ca3af",
  },
  seriousness: {
    "death": "#991b1b",
    "hospitalization": "#dc2626",
    "life_threatening": "#f97316",
    "disability": "#eab308",
    "congenital_anomaly": "#a855f7",
    "other": "#6b7280",
  },
  sex: {
    "Male": "#3b82f6",
    "Female": "#ec4899",
    "Unknown": "#9ca3af",
  },
  reporter: {
    "Physician": "#2563eb",
    "Pharmacist": "#7c3aed",
    "Other health professional": "#0891b2",
    "Consumer": "#16a34a",
    "Lawyer": "#dc2626",
  },
  recall_classification: {
    "Class I": "#dc2626",
    "Class II": "#f59e0b",
    "Class III": "#22c55e",
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build URL for OpenFDA API request
 */
async function buildUrl(baseUrl: string, params: FAERSSearchParams): Promise<string> {
  const urlParams = new URLSearchParams();
  
  // Get API key from env or Key Vault
  const apiKey = await getApiKey();
  if (apiKey) {
    urlParams.append("api_key", apiKey);
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
  
  return `${baseUrl}?${urlParams.toString()}`;
}

/**
 * Fetch data from FAERS API
 */
async function fetchFAERS(params: FAERSSearchParams): Promise<FAERSResponse> {
  const url = await buildUrl(OPENFDA_FAERS_URL, params);
  
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
  
  // Build visualization hint based on group_by type
  const visualizationHints: { [key: string]: any } = {
    reaction: {
      type: "horizontal_bar_chart",
      x_axis: "count",
      y_axis: "reaction",
      title: `Top Adverse Events for ${args.drug_name}`,
      sort: "descending",
    },
    outcome: {
      type: "pie_chart",
      category: "outcome",
      value: "count",
      title: `Outcome Distribution for ${args.drug_name}`,
      color_scheme: COLOR_SCHEMES.outcomes,
    },
    sex: {
      type: "pie_chart",
      category: "sex",
      value: "count",
      title: `Patient Sex Distribution for ${args.drug_name}`,
      color_scheme: COLOR_SCHEMES.sex,
    },
    age: {
      type: "histogram",
      x_axis: "age",
      y_axis: "count",
      title: `Patient Age Distribution for ${args.drug_name}`,
      bin_size: 10,
    },
    country: {
      type: "horizontal_bar_chart",
      x_axis: "count",
      y_axis: "country",
      title: `Reports by Country for ${args.drug_name}`,
      sort: "descending",
      max_items: 15,
    },
    reporter_type: {
      type: "pie_chart",
      category: "reporter_type",
      value: "count",
      title: `Reporter Types for ${args.drug_name}`,
      color_scheme: COLOR_SCHEMES.reporter,
    },
    route: {
      type: "horizontal_bar_chart",
      x_axis: "count",
      y_axis: "route",
      title: `Administration Routes for ${args.drug_name}`,
      sort: "descending",
    },
  };

  return {
    drug: args.drug_name,
    grouped_by: args.group_by,
    results: formattedResults,
    visualization_hint: visualizationHints[args.group_by],
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
    visualization_hint: {
      type: "grouped_bar_chart",
      group_by: "reaction",
      series: "drug_name",
      value: "count",
      title: "Safety Profile Comparison",
      x_axis: "reaction",
      y_axis: "count",
      legend: args.drug_names,
    },
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
  
  // Calculate seriousness breakdown for visualization
  const seriousnessBreakdown: { [key: string]: number } = {
    death: 0,
    hospitalization: 0,
    life_threatening: 0,
    disability: 0,
    congenital_anomaly: 0,
    other: 0,
  };
  
  results.forEach((r: any) => {
    if (r.seriousness.death) seriousnessBreakdown.death++;
    if (r.seriousness.hospitalization) seriousnessBreakdown.hospitalization++;
    if (r.seriousness.life_threatening) seriousnessBreakdown.life_threatening++;
    if (r.seriousness.disability) seriousnessBreakdown.disability++;
    if (r.seriousness.congenital_anomaly) seriousnessBreakdown.congenital_anomaly++;
    if (r.seriousness.other) seriousnessBreakdown.other++;
  });

  return {
    drug: args.drug_name,
    outcome_filter: args.outcome_type || "all serious",
    total_matching: data.meta?.results?.total,
    seriousness_breakdown: Object.entries(seriousnessBreakdown)
      .filter(([_, count]) => count > 0)
      .map(([category, count]) => ({ category, count })),
    results,
    visualization_hint: {
      type: "stacked_bar_chart",
      x_axis: "category",
      y_axis: "count",
      title: `Serious Event Breakdown for ${args.drug_name}`,
      categories: ["death", "hospitalization", "life_threatening", "disability", "congenital_anomaly", "other"],
      color_scheme: COLOR_SCHEMES.seriousness,
      x_label: "Seriousness Type",
      y_label: "Number of Reports",
    },
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
    visualization_hint: {
      type: "line_chart",
      x_axis: "period",
      y_axis: "count",
      title: `Adverse Event Reports for ${args.drug_name} Over Time`,
      x_label: granularity === "year" ? "Year" : granularity === "quarter" ? "Quarter" : "Month",
      y_label: "Report Count",
      show_trend_line: true,
    },
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
    visualization_hint: {
      type: "horizontal_bar_chart",
      x_axis: "report_count",
      y_axis: "drug_name",
      title: `Drugs Associated with ${args.reaction}`,
      sort: "descending",
      max_items: 20,
      x_label: "Number of Reports",
      y_label: "Drug Name",
    },
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
    visualization_hint: {
      type: "horizontal_bar_chart",
      x_axis: "co_report_count",
      y_axis: "drug_name",
      title: `Drugs Co-Reported with ${args.drug_name}`,
      sort: "descending",
      x_label: "Co-Report Count",
      y_label: "Drug Name",
    },
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
  
  const apiKey = await getApiKey();
  
  return {
    database: "FDA Adverse Event Reporting System (FAERS)",
    source: "OpenFDA API",
    api_documentation: "https://open.fda.gov/apis/drug/event/",
    last_updated: data.meta?.last_updated || "Unknown",
    coverage: "January 2004 - present",
    update_frequency: "Quarterly",
    rate_limit_status: apiKey ? "Configured (120,000 requests/day)" : "Using free tier (1,000 requests/day)",
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

/**
 * Get FDA drug label information
 */
async function handleGetDrugLabelInfo(args: {
  drug_name: string;
  sections?: string[];
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "get_drug_label_info", drug: args.drug_name });
  
  const escapedName = args.drug_name.replace(/"/g, '\\"');
  const search = `(openfda.brand_name:"${escapedName}"+OR+openfda.generic_name:"${escapedName}")`;
  
  const url = await buildUrl(OPENFDA_LABEL_URL, { search, limit: 1 });
  
  try {
    const response = await fetch(url);
    const data = await response.json() as FAERSResponse;
    
    if (data.error || !data.results || data.results.length === 0) {
      return {
        message: `No drug label information found for "${args.drug_name}"`,
        suggestion: "Try searching with the exact brand name or generic name as it appears on the FDA label",
      };
    }
    
    const label = data.results[0];
    
    // Extract key sections
    const allSections: { [key: string]: any } = {
      brand_name: label.openfda?.brand_name?.[0] || "Unknown",
      generic_name: label.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: label.openfda?.manufacturer_name?.[0] || "Unknown",
      product_type: label.openfda?.product_type?.[0] || "Unknown",
      route: label.openfda?.route || [],
      substance_name: label.openfda?.substance_name || [],
      boxed_warning: label.boxed_warning?.[0] || null,
      warnings: label.warnings?.[0] || label.warnings_and_cautions?.[0] || null,
      contraindications: label.contraindications?.[0] || null,
      adverse_reactions: label.adverse_reactions?.[0] || null,
      drug_interactions: label.drug_interactions?.[0] || null,
      indications_and_usage: label.indications_and_usage?.[0] || null,
      dosage_and_administration: label.dosage_and_administration?.[0] || null,
      pregnancy: label.pregnancy?.[0] || label.pregnancy_or_breast_feeding?.[0] || null,
      pediatric_use: label.pediatric_use?.[0] || null,
      geriatric_use: label.geriatric_use?.[0] || null,
      overdosage: label.overdosage?.[0] || null,
    };
    
    // Filter to requested sections if specified
    let result: { [key: string]: any };
    if (args.sections && args.sections.length > 0) {
      result = {};
      for (const section of args.sections) {
        const key = section.toLowerCase().replace(/ /g, "_");
        if (allSections[key] !== undefined) {
          result[key] = allSections[key];
        }
      }
      // Always include basic drug info
      result.brand_name = allSections.brand_name;
      result.generic_name = allSections.generic_name;
    } else {
      result = allSections;
    }
    
    // Remove null values
    Object.keys(result).forEach(key => {
      if (result[key] === null) {
        delete result[key];
      }
    });
    
    return {
      drug: args.drug_name,
      label_info: result,
      has_boxed_warning: !!label.boxed_warning,
      source: "FDA Drug Label via OpenFDA API",
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `Failed to fetch drug label: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get FDA drug recall information
 */
async function handleGetRecallInfo(args: {
  drug_name: string;
  classification?: string;
  status?: string;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "get_recall_info", drug: args.drug_name });
  
  const escapedName = args.drug_name.replace(/"/g, '\\"');
  let search = `(product_description:"${escapedName}"+OR+openfda.brand_name:"${escapedName}"+OR+openfda.generic_name:"${escapedName}")`;
  
  if (args.classification) {
    search += `+AND+classification:"${args.classification}"`;
  }
  
  if (args.status) {
    search += `+AND+status:"${args.status}"`;
  }
  
  const url = await buildUrl(OPENFDA_ENFORCEMENT_URL, { search, limit: args.limit || 10 });
  
  try {
    const response = await fetch(url);
    const data = await response.json() as FAERSResponse;
    
    if (data.error || !data.results || data.results.length === 0) {
      return {
        message: `No recall information found for "${args.drug_name}"`,
        note: "This may mean the drug has not been recalled, or the search term doesn't match FDA records",
      };
    }
    
    const recalls = data.results.map((recall: any) => ({
      recall_number: recall.recall_number,
      classification: recall.classification,
      classification_description: 
        recall.classification === "Class I" 
          ? "Most serious - may cause death or serious health problems"
          : recall.classification === "Class II"
            ? "May cause temporary or reversible health problems"
            : "Unlikely to cause adverse health consequences",
      status: recall.status,
      recall_initiation_date: recall.recall_initiation_date,
      report_date: recall.report_date,
      reason_for_recall: recall.reason_for_recall,
      product_description: recall.product_description,
      recalling_firm: recall.recalling_firm,
      distribution_pattern: recall.distribution_pattern,
      voluntary_mandated: recall.voluntary_mandated,
      city: recall.city,
      state: recall.state,
      country: recall.country,
    }));
    
    // Count by classification
    const classificationCounts: { [key: string]: number } = {};
    recalls.forEach((r: any) => {
      classificationCounts[r.classification] = (classificationCounts[r.classification] || 0) + 1;
    });
    
    return {
      drug: args.drug_name,
      total_recalls: data.meta?.results?.total || recalls.length,
      returned: recalls.length,
      classification_summary: classificationCounts,
      recalls,
      visualization_hint: {
        type: "timeline",
        x_axis: "recall_initiation_date",
        label: "reason_for_recall",
        title: `Recall History for ${args.drug_name}`,
        color_by: "classification",
        color_scheme: COLOR_SCHEMES.recall_classification,
        secondary_chart: {
          type: "pie_chart",
          category: "classification",
          value: "count",
          title: "Recalls by Classification",
          data: Object.entries(classificationCounts).map(([classification, count]) => ({
            classification,
            count,
          })),
          color_scheme: COLOR_SCHEMES.recall_classification,
        },
      },
      source: "FDA Enforcement Reports via OpenFDA API",
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `Failed to fetch recall info: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Search adverse events by indication
 */
async function handleSearchByIndication(args: {
  indication: string;
  group_by?: string;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.indication);
  
  const groupBy = args.group_by || "drug";
  
  audit({ level: "info", event: "search_by_indication", indication: args.indication, group_by: groupBy });
  
  const escapedIndication = args.indication.replace(/"/g, '\\"');
  const search = `patient.drug.drugindication:"${escapedIndication}"`;
  
  let countField: string;
  if (groupBy === "reaction") {
    countField = "patient.reaction.reactionmeddrapt.exact";
  } else {
    countField = "patient.drug.openfda.brand_name.exact";
  }
  
  const data = await fetchFAERS({
    search,
    count: countField,
    limit: args.limit || 20,
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No adverse events found for indication "${args.indication}"`,
      suggestion: "Try using different terms for the indication (e.g., 'type 2 diabetes' vs 'diabetes mellitus')",
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  const results = data.results.map((item: any) => ({
    [groupBy === "reaction" ? "reaction" : "drug_name"]: item.term,
    report_count: item.count,
  }));
  
  const visualizationHint = groupBy === "drug"
    ? {
        type: "horizontal_bar_chart",
        x_axis: "report_count",
        y_axis: "drug_name",
        title: `Drugs Used for ${args.indication} (by AE Report Count)`,
        sort: "descending",
        x_label: "Number of AE Reports",
        y_label: "Drug Name",
      }
    : {
        type: "horizontal_bar_chart",
        x_axis: "report_count",
        y_axis: "reaction",
        title: `Top Adverse Events for ${args.indication} Medications`,
        sort: "descending",
        x_label: "Number of Reports",
        y_label: "Adverse Reaction",
      };

  return {
    indication: args.indication,
    grouped_by: groupBy,
    results,
    visualization_hint: visualizationHint,
    note: groupBy === "drug" 
      ? "Shows drugs most commonly reported with this indication - higher counts may reflect more widely used drugs"
      : "Shows most common adverse reactions for drugs used for this indication",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Search adverse events by drug class (pharmacologic class)
 */
async function handleSearchByDrugClass(args: {
  drug_class: string;
  group_by?: string;
  serious_only?: boolean;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_class);
  
  const groupBy = args.group_by || "reaction";
  
  audit({ level: "info", event: "search_by_drug_class", drug_class: args.drug_class, group_by: groupBy });
  
  const escapedClass = args.drug_class.replace(/"/g, '\\"');
  let search = `patient.drug.openfda.pharm_class_epc:"${escapedClass}"`;
  
  if (args.serious_only) {
    search += "+AND+serious:1";
  }
  
  let countField: string;
  if (groupBy === "drug") {
    countField = "patient.drug.openfda.brand_name.exact";
  } else {
    countField = "patient.reaction.reactionmeddrapt.exact";
  }
  
  const data = await fetchFAERS({
    search,
    count: countField,
    limit: args.limit || 20,
  });
  
  if (!data.results || data.results.length === 0) {
    return {
      message: `No adverse events found for drug class "${args.drug_class}"`,
      suggestion: "Try using the official FDA pharmacologic class name (e.g., 'Tumor Necrosis Factor Blocker [EPC]', 'Dipeptidyl Peptidase 4 Inhibitor [EPC]')",
      common_classes: [
        "Tumor Necrosis Factor Blocker [EPC]",
        "Glucagon-like Peptide-1 Receptor Agonist [EPC]",
        "Selective Serotonin Reuptake Inhibitor [EPC]",
        "HMG-CoA Reductase Inhibitor [EPC]",
        "Angiotensin Converting Enzyme Inhibitor [EPC]",
        "Proton Pump Inhibitor [EPC]",
        "Dipeptidyl Peptidase 4 Inhibitor [EPC]",
      ],
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  const results = data.results.map((item: any) => ({
    [groupBy === "drug" ? "drug_name" : "reaction"]: item.term,
    report_count: item.count,
  }));
  
  // Also get the list of drugs in this class if grouping by reaction
  let drugsInClass: string[] = [];
  if (groupBy === "reaction") {
    const drugData = await fetchFAERS({
      search,
      count: "patient.drug.openfda.brand_name.exact",
      limit: 10,
    });
    drugsInClass = drugData.results?.map((item: any) => item.term) || [];
  }

  const visualizationHint = groupBy === "drug"
    ? {
        type: "horizontal_bar_chart",
        x_axis: "report_count",
        y_axis: "drug_name",
        title: `Drugs in ${args.drug_class} (by AE Report Count)`,
        sort: "descending",
        x_label: "Number of AE Reports",
        y_label: "Drug Name",
      }
    : {
        type: "horizontal_bar_chart",
        x_axis: "report_count",
        y_axis: "reaction",
        title: `Top Adverse Events for ${args.drug_class}`,
        sort: "descending",
        x_label: "Number of Reports",
        y_label: "Adverse Reaction",
      };

  return {
    drug_class: args.drug_class,
    grouped_by: groupBy,
    serious_only: args.serious_only || false,
    drugs_in_class: drugsInClass.length > 0 ? drugsInClass : undefined,
    results,
    visualization_hint: visualizationHint,
    note: "Results represent all drugs in this pharmacologic class. Higher counts may reflect more widely used drugs within the class.",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Compare FDA label adverse reactions to actual FAERS reports
 */
async function handleCompareLabelToReports(args: {
  drug_name: string;
  top_n?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "compare_label_to_reports", drug: args.drug_name });
  
  const topN = args.top_n || 20;
  
  // Step 1: Get drug label adverse reactions
  const escapedName = args.drug_name.replace(/"/g, '\\"');
  const labelSearch = `(openfda.brand_name:"${escapedName}"+OR+openfda.generic_name:"${escapedName}")`;
  const labelUrl = await buildUrl(OPENFDA_LABEL_URL, { search: labelSearch, limit: 1 });
  
  let labelAdverseReactions: string[] = [];
  let labelWarnings: string | null = null;
  let brandName = args.drug_name;
  let genericName = args.drug_name;
  
  try {
    const labelResponse = await fetch(labelUrl);
    const labelData = await labelResponse.json() as FAERSResponse;
    
    if (labelData.results && labelData.results.length > 0) {
      const label = labelData.results[0];
      brandName = label.openfda?.brand_name?.[0] || args.drug_name;
      genericName = label.openfda?.generic_name?.[0] || args.drug_name;
      
      // Extract adverse reactions from label text
      const arText = label.adverse_reactions?.[0] || "";
      // Simple extraction - look for capitalized terms that might be reactions
      const reactionPattern = /\b([A-Z][a-z]+(?:\s+[a-z]+)*)\b/g;
      const matches: string[] = arText.match(reactionPattern) || [];
      const excludeWords = ["The", "This", "These", "There", "They", "With", "From", "Have", "Were", "Been"];
      labelAdverseReactions = [...new Set(matches)]
        .filter((r) => r.length > 3 && !excludeWords.includes(r))
        .slice(0, 50);
      
      labelWarnings = label.boxed_warning?.[0] || label.warnings?.[0] || null;
    }
  } catch {
    // Continue without label data
  }
  
  // Step 2: Get top reported reactions from FAERS
  const faersData = await fetchFAERS({
    search: buildDrugSearch(args.drug_name),
    count: "patient.reaction.reactionmeddrapt.exact",
    limit: topN,
  });
  
  if (!faersData.results || faersData.results.length === 0) {
    return {
      message: `No FAERS reports found for "${args.drug_name}"`,
      label_data_available: labelAdverseReactions.length > 0,
      disclaimer: FAERS_DISCLAIMER,
    };
  }
  
  const reportedReactions = faersData.results.map((item: any) => ({
    reaction: item.term,
    report_count: item.count,
  }));
  
  // Step 3: Compare - find reactions in reports but potentially not on label
  const labelReactionsLower = labelAdverseReactions.map(r => r.toLowerCase());
  
  const comparison = reportedReactions.map((reported: any) => {
    const reactionLower = reported.reaction.toLowerCase();
    const onLabel = labelReactionsLower.some(lr => 
      reactionLower.includes(lr) || lr.includes(reactionLower)
    );
    
    return {
      reaction: reported.reaction,
      report_count: reported.report_count,
      on_label: onLabel,
      signal_status: onLabel ? "labeled" : "potential_signal",
    };
  });
  
  // Separate into labeled vs potential signals
  const labeledReactions = comparison.filter((c: any) => c.on_label);
  const potentialSignals = comparison.filter((c: any) => !c.on_label);

  return {
    drug: args.drug_name,
    brand_name: brandName,
    generic_name: genericName,
    analysis_summary: {
      total_reactions_analyzed: comparison.length,
      labeled_reactions_found: labeledReactions.length,
      potential_signals: potentialSignals.length,
      signal_percentage: Math.round((potentialSignals.length / comparison.length) * 100),
    },
    has_boxed_warning: !!labelWarnings,
    labeled_reactions: labeledReactions,
    potential_signals: potentialSignals,
    visualization_hint: {
      type: "horizontal_bar_chart",
      x_axis: "report_count",
      y_axis: "reaction",
      title: `Label vs FAERS Comparison for ${args.drug_name}`,
      sort: "descending",
      color_by: "signal_status",
      color_scheme: {
        labeled: "#22c55e",
        potential_signal: "#f59e0b",
      },
      x_label: "Number of Reports",
      y_label: "Adverse Reaction",
      legend: ["On Label", "Potential Signal"],
    },
    interpretation: {
      labeled: "These reactions are documented in the FDA-approved label",
      potential_signal: "These reactions are frequently reported but may not be prominently featured on the label - warrant further investigation",
    },
    note: "This analysis uses text matching and may not capture all label mentions. Always review the full prescribing information.",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get pediatric safety data
 */
async function handleGetPediatricSafety(args: {
  drug_name: string;
  age_group?: string;
  include_adult_comparison?: boolean;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  const ageGroup = args.age_group || "all_pediatric";
  const includeAdultComparison = args.include_adult_comparison !== false;
  const limit = args.limit || 15;
  
  audit({ level: "info", event: "get_pediatric_safety", drug: args.drug_name, age_group: ageGroup });
  
  // Define age ranges (in years, using patientonsetage field)
  // FAERS age can be in different units, we'll search for common patterns
  const ageRanges: { [key: string]: { min: number; max: number; label: string } } = {
    neonate: { min: 0, max: 0, label: "Neonate (0-27 days)" },
    infant: { min: 0, max: 1, label: "Infant (28 days - 23 months)" },
    child: { min: 2, max: 11, label: "Child (2-11 years)" },
    adolescent: { min: 12, max: 17, label: "Adolescent (12-17 years)" },
    all_pediatric: { min: 0, max: 17, label: "All Pediatric (0-17 years)" },
  };
  
  const range = ageRanges[ageGroup] || ageRanges.all_pediatric;
  
  // Build search for pediatric patients
  const drugSearch = buildDrugSearch(args.drug_name);
  const pediatricSearch = `${drugSearch}+AND+patient.patientonsetage:[${range.min}+TO+${range.max}]+AND+patient.patientonsetageunit:801`; // 801 = years
  
  // Get top reactions for pediatric patients
  const pediatricData = await fetchFAERS({
    search: pediatricSearch,
    count: "patient.reaction.reactionmeddrapt.exact",
    limit,
  });
  
  // Get total pediatric report count
  const pediatricCountData = await fetchFAERS({
    search: pediatricSearch,
    limit: 1,
  });
  
  const pediatricReactions = pediatricData.results?.map((item: any) => ({
    reaction: item.term,
    report_count: item.count,
  })) || [];
  
  const pediatricTotalReports = pediatricCountData.meta?.results?.total || 0;
  
  // Get serious event breakdown for pediatric
  const pediatricSeriousData = await fetchFAERS({
    search: `${pediatricSearch}+AND+serious:1`,
    limit: 1,
  });
  const pediatricSeriousCount = pediatricSeriousData.meta?.results?.total || 0;
  
  // Get sex distribution for pediatric
  const pediatricSexData = await fetchFAERS({
    search: pediatricSearch,
    count: "patient.patientsex",
    limit: 3,
  });
  const pediatricSexDistribution = pediatricSexData.results?.map((item: any) => ({
    sex: item.term === 1 ? "Male" : item.term === 2 ? "Female" : "Unknown",
    count: item.count,
  })) || [];
  
  let adultComparison: any = null;
  
  if (includeAdultComparison) {
    // Get adult data for comparison
    const adultSearch = `${drugSearch}+AND+patient.patientonsetage:[18+TO+120]+AND+patient.patientonsetageunit:801`;
    
    const adultData = await fetchFAERS({
      search: adultSearch,
      count: "patient.reaction.reactionmeddrapt.exact",
      limit,
    });
    
    const adultCountData = await fetchFAERS({
      search: adultSearch,
      limit: 1,
    });
    
    const adultReactions = adultData.results?.map((item: any) => ({
      reaction: item.term,
      report_count: item.count,
    })) || [];
    
    const adultTotalReports = adultCountData.meta?.results?.total || 0;
    
    // Find reactions unique to or more prominent in pediatric population
    const adultReactionMap = new Map(adultReactions.map((r: any) => [r.reaction, r.report_count]));
    const pediatricReactionMap = new Map(pediatricReactions.map((r: any) => [r.reaction, r.report_count]));
    
    const pediatricUnique = pediatricReactions.filter((r: any) => !adultReactionMap.has(r.reaction));
    const adultUnique = adultReactions.filter((r: any) => !pediatricReactionMap.has(r.reaction));
    
    adultComparison = {
      adult_total_reports: adultTotalReports,
      adult_top_reactions: adultReactions.slice(0, 10),
      pediatric_unique_reactions: pediatricUnique,
      adult_unique_reactions: adultUnique.slice(0, 10),
      report_ratio: pediatricTotalReports > 0 && adultTotalReports > 0 
        ? `1:${Math.round(adultTotalReports / pediatricTotalReports)}`
        : "N/A",
    };
  }

  return {
    drug: args.drug_name,
    age_group: range.label,
    pediatric_summary: {
      total_reports: pediatricTotalReports,
      serious_reports: pediatricSeriousCount,
      serious_percentage: pediatricTotalReports > 0 
        ? Math.round((pediatricSeriousCount / pediatricTotalReports) * 100)
        : 0,
      sex_distribution: pediatricSexDistribution,
    },
    top_pediatric_reactions: pediatricReactions,
    adult_comparison: adultComparison,
    visualization_hint: {
      type: "grouped_bar_chart",
      group_by: "reaction",
      series: ["Pediatric", "Adult"],
      value: "report_count",
      title: `Pediatric vs Adult Safety Profile: ${args.drug_name}`,
      x_axis: "reaction",
      y_axis: "report_count",
      secondary_chart: {
        type: "pie_chart",
        category: "sex",
        value: "count",
        title: "Pediatric Sex Distribution",
        color_scheme: COLOR_SCHEMES.sex,
      },
    },
    regulatory_note: "Pediatric safety data is critical for pediatric trial planning and PREA (Pediatric Research Equity Act) requirements",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get geriatric safety data
 */
async function handleGetGeriatricSafety(args: {
  drug_name: string;
  age_group?: string;
  include_adult_comparison?: boolean;
  limit?: number;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  const ageGroup = args.age_group || "all_geriatric";
  const includeAdultComparison = args.include_adult_comparison !== false;
  const limit = args.limit || 15;
  
  audit({ level: "info", event: "get_geriatric_safety", drug: args.drug_name, age_group: ageGroup });
  
  // Define age ranges
  const ageRanges: { [key: string]: { min: number; max: number; label: string } } = {
    "65_to_74": { min: 65, max: 74, label: "Young-Old (65-74 years)" },
    "75_to_84": { min: 75, max: 84, label: "Middle-Old (75-84 years)" },
    "85_plus": { min: 85, max: 120, label: "Oldest-Old (85+ years)" },
    "all_geriatric": { min: 65, max: 120, label: "All Geriatric (65+ years)" },
  };
  
  const range = ageRanges[ageGroup] || ageRanges.all_geriatric;
  
  // Build search for geriatric patients
  const drugSearch = buildDrugSearch(args.drug_name);
  const geriatricSearch = `${drugSearch}+AND+patient.patientonsetage:[${range.min}+TO+${range.max}]+AND+patient.patientonsetageunit:801`;
  
  // Get top reactions for geriatric patients
  const geriatricData = await fetchFAERS({
    search: geriatricSearch,
    count: "patient.reaction.reactionmeddrapt.exact",
    limit,
  });
  
  // Get total geriatric report count
  const geriatricCountData = await fetchFAERS({
    search: geriatricSearch,
    limit: 1,
  });
  
  const geriatricReactions = geriatricData.results?.map((item: any) => ({
    reaction: item.term,
    report_count: item.count,
  })) || [];
  
  const geriatricTotalReports = geriatricCountData.meta?.results?.total || 0;
  
  // Get serious event breakdown for geriatric
  const geriatricSeriousData = await fetchFAERS({
    search: `${geriatricSearch}+AND+serious:1`,
    limit: 1,
  });
  const geriatricSeriousCount = geriatricSeriousData.meta?.results?.total || 0;
  
  // Check for geriatric-specific concerns (falls, cognitive, etc.)
  const geriatricConcerns = ["fall", "confusion", "dizziness", "somnolence", "cognitive", "memory", "delirium", "syncope"];
  const geriatricSpecificReactions = geriatricReactions.filter((r: any) => 
    geriatricConcerns.some(concern => r.reaction.toLowerCase().includes(concern))
  );
  
  // Get sex distribution for geriatric
  const geriatricSexData = await fetchFAERS({
    search: geriatricSearch,
    count: "patient.patientsex",
    limit: 3,
  });
  const geriatricSexDistribution = geriatricSexData.results?.map((item: any) => ({
    sex: item.term === 1 ? "Male" : item.term === 2 ? "Female" : "Unknown",
    count: item.count,
  })) || [];
  
  let adultComparison: any = null;
  
  if (includeAdultComparison) {
    // Get younger adult data for comparison (18-64)
    const adultSearch = `${drugSearch}+AND+patient.patientonsetage:[18+TO+64]+AND+patient.patientonsetageunit:801`;
    
    const adultData = await fetchFAERS({
      search: adultSearch,
      count: "patient.reaction.reactionmeddrapt.exact",
      limit,
    });
    
    const adultCountData = await fetchFAERS({
      search: adultSearch,
      limit: 1,
    });
    
    const adultReactions = adultData.results?.map((item: any) => ({
      reaction: item.term,
      report_count: item.count,
    })) || [];
    
    const adultTotalReports = adultCountData.meta?.results?.total || 0;
    
    // Find reactions unique to or more prominent in geriatric population
    const adultReactionMap = new Map(adultReactions.map((r: any) => [r.reaction, r.report_count]));
    const geriatricReactionMap = new Map(geriatricReactions.map((r: any) => [r.reaction, r.report_count]));
    
    const geriatricUnique = geriatricReactions.filter((r: any) => !adultReactionMap.has(r.reaction));
    const adultUnique = adultReactions.filter((r: any) => !geriatricReactionMap.has(r.reaction));
    
    adultComparison = {
      younger_adult_total_reports: adultTotalReports,
      younger_adult_top_reactions: adultReactions.slice(0, 10),
      geriatric_unique_reactions: geriatricUnique,
      younger_adult_unique_reactions: adultUnique.slice(0, 10),
      report_ratio: geriatricTotalReports > 0 && adultTotalReports > 0 
        ? `${Math.round(geriatricTotalReports / adultTotalReports * 100) / 100}:1`
        : "N/A",
    };
  }

  return {
    drug: args.drug_name,
    age_group: range.label,
    geriatric_summary: {
      total_reports: geriatricTotalReports,
      serious_reports: geriatricSeriousCount,
      serious_percentage: geriatricTotalReports > 0 
        ? Math.round((geriatricSeriousCount / geriatricTotalReports) * 100)
        : 0,
      sex_distribution: geriatricSexDistribution,
    },
    top_geriatric_reactions: geriatricReactions,
    geriatric_specific_concerns: geriatricSpecificReactions.length > 0 ? {
      note: "Reactions of particular concern in elderly patients",
      reactions: geriatricSpecificReactions,
    } : null,
    younger_adult_comparison: adultComparison,
    visualization_hint: {
      type: "grouped_bar_chart",
      group_by: "reaction",
      series: ["Geriatric (65+)", "Younger Adult (18-64)"],
      value: "report_count",
      title: `Geriatric vs Younger Adult Safety Profile: ${args.drug_name}`,
      x_axis: "reaction",
      y_axis: "report_count",
      secondary_chart: {
        type: "pie_chart",
        category: "sex",
        value: "count",
        title: "Geriatric Sex Distribution",
        color_scheme: COLOR_SCHEMES.sex,
      },
    },
    regulatory_note: "Geriatric safety data is important for ICH E7 compliance and trials in elderly populations",
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get executive safety summary for a drug
 */
async function handleGetSafetySummary(args: {
  drug_name: string;
  include_label_warnings?: boolean;
  include_recalls?: boolean;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  const includeLabelWarnings = args.include_label_warnings !== false;
  const includeRecalls = args.include_recalls !== false;
  
  audit({ level: "info", event: "get_safety_summary", drug: args.drug_name });
  
  // Get total report count
  const totalData = await fetchFAERS({
    search: buildDrugSearch(args.drug_name),
    limit: 1,
  });
  const totalReports = totalData.meta?.results?.total || 0;
  
  // Get serious event count
  const seriousData = await fetchFAERS({
    search: buildDrugSearch(args.drug_name) + "+AND+serious:1",
    limit: 1,
  });
  const seriousReports = seriousData.meta?.results?.total || 0;
  
  // Get top 10 reactions
  const reactionsData = await fetchFAERS({
    search: buildDrugSearch(args.drug_name),
    count: "patient.reaction.reactionmeddrapt.exact",
    limit: 10,
  });
  const topReactions = reactionsData.results?.map((item: any) => ({
    reaction: item.term,
    count: item.count,
  })) || [];
  
  // Get outcome breakdown
  const outcomeData = await fetchFAERS({
    search: buildDrugSearch(args.drug_name),
    count: "patient.reaction.reactionoutcome",
    limit: 10,
  });
  const outcomeMap: { [key: number]: string } = {
    1: "Recovered",
    2: "Recovering",
    3: "Not recovered",
    4: "Recovered with sequelae",
    5: "Fatal",
    6: "Unknown",
  };
  const outcomes = outcomeData.results?.map((item: any) => ({
    outcome: outcomeMap[item.term] || `Code ${item.term}`,
    count: item.count,
  })) || [];
  
  // Get recent trend (last 2 years by quarter)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 2);
  const startDateStr = startDate.toISOString().slice(0, 10).replace(/-/g, "");
  const endDateStr = endDate.toISOString().slice(0, 10).replace(/-/g, "");
  
  const trendData = await fetchFAERS({
    search: buildDrugSearch(args.drug_name) + `+AND+receivedate:[${startDateStr}+TO+${endDateStr}]`,
    count: "receivedate",
    limit: 100,
  });
  
  // Calculate trend direction
  let trendDirection = "stable";
  let recentQuarterCount = 0;
  let previousQuarterCount = 0;
  
  if (trendData.results && trendData.results.length > 0) {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    
    for (const item of trendData.results) {
      const dateStr = item.time || item.term?.toString();
      if (!dateStr) continue;
      
      const itemDate = new Date(
        parseInt(dateStr.slice(0, 4)),
        parseInt(dateStr.slice(4, 6)) - 1,
        parseInt(dateStr.slice(6, 8))
      );
      
      if (itemDate >= threeMonthsAgo) {
        recentQuarterCount += item.count;
      } else if (itemDate >= sixMonthsAgo) {
        previousQuarterCount += item.count;
      }
    }
    
    if (previousQuarterCount > 0) {
      const changePercent = ((recentQuarterCount - previousQuarterCount) / previousQuarterCount) * 100;
      if (changePercent > 20) trendDirection = "increasing";
      else if (changePercent < -20) trendDirection = "decreasing";
    }
  }
  
  // Get label warnings if requested
  let labelWarnings: any = null;
  if (includeLabelWarnings) {
    const escapedName = args.drug_name.replace(/"/g, '\\"');
    const labelSearch = `(openfda.brand_name:"${escapedName}"+OR+openfda.generic_name:"${escapedName}")`;
    const labelUrl = await buildUrl(OPENFDA_LABEL_URL, { search: labelSearch, limit: 1 });
    
    try {
      const labelResponse = await fetch(labelUrl);
      const labelData = await labelResponse.json() as FAERSResponse;
      
      if (labelData.results && labelData.results.length > 0) {
        const label = labelData.results[0];
        labelWarnings = {
          has_boxed_warning: !!label.boxed_warning,
          boxed_warning_summary: label.boxed_warning?.[0]?.slice(0, 500) || null,
          warnings_summary: label.warnings?.[0]?.slice(0, 500) || label.warnings_and_cautions?.[0]?.slice(0, 500) || null,
        };
      }
    } catch {
      // Continue without label data
    }
  }
  
  // Get recalls if requested
  let recallSummary: any = null;
  if (includeRecalls) {
    const escapedName = args.drug_name.replace(/"/g, '\\"');
    const recallSearch = `(product_description:"${escapedName}"+OR+openfda.brand_name:"${escapedName}")`;
    const recallUrl = await buildUrl(OPENFDA_ENFORCEMENT_URL, { search: recallSearch, limit: 5 });
    
    try {
      const recallResponse = await fetch(recallUrl);
      const recallData = await recallResponse.json() as FAERSResponse;
      
      if (recallData.results && recallData.results.length > 0) {
        recallSummary = {
          total_recalls: recallData.meta?.results?.total || recallData.results.length,
          recent_recalls: recallData.results.slice(0, 3).map((r: any) => ({
            classification: r.classification,
            date: r.recall_initiation_date,
            reason: r.reason_for_recall?.slice(0, 200),
          })),
        };
      }
    } catch {
      // Continue without recall data
    }
  }

  return {
    drug: args.drug_name,
    report_summary: {
      total_reports: totalReports,
      serious_reports: seriousReports,
      serious_percentage: totalReports > 0 ? Math.round((seriousReports / totalReports) * 100) : 0,
    },
    top_10_reactions: topReactions,
    outcome_distribution: outcomes,
    trend: {
      direction: trendDirection,
      recent_quarter_reports: recentQuarterCount,
      previous_quarter_reports: previousQuarterCount,
      period: "Last 6 months comparison",
    },
    label_warnings: labelWarnings,
    recall_summary: recallSummary,
    visualization_hint: {
      type: "dashboard",
      components: [
        {
          type: "stat_card",
          metrics: ["total_reports", "serious_percentage", "trend_direction"],
        },
        {
          type: "horizontal_bar_chart",
          data: "top_10_reactions",
          title: "Top Adverse Events",
        },
        {
          type: "pie_chart",
          data: "outcome_distribution",
          title: "Outcomes",
          color_scheme: COLOR_SCHEMES.outcomes,
        },
      ],
    },
    disclaimer: FAERS_DISCLAIMER,
  };
}

/**
 * Get pregnancy and lactation information from drug label
 */
async function handleGetPregnancyLactationInfo(args: {
  drug_name: string;
}): Promise<unknown> {
  validateInput(args.drug_name);
  
  audit({ level: "info", event: "get_pregnancy_lactation_info", drug: args.drug_name });
  
  const escapedName = args.drug_name.replace(/"/g, '\\"');
  const search = `(openfda.brand_name:"${escapedName}"+OR+openfda.generic_name:"${escapedName}")`;
  
  const url = await buildUrl(OPENFDA_LABEL_URL, { search, limit: 1 });
  
  try {
    const response = await fetch(url);
    const data = await response.json() as FAERSResponse;
    
    if (data.error || !data.results || data.results.length === 0) {
      return {
        message: `No drug label information found for "${args.drug_name}"`,
        suggestion: "Try searching with the exact brand name or generic name as it appears on the FDA label",
      };
    }
    
    const label = data.results[0];
    
    // Extract pregnancy and lactation sections
    const pregnancyInfo: any = {
      brand_name: label.openfda?.brand_name?.[0] || args.drug_name,
      generic_name: label.openfda?.generic_name?.[0] || args.drug_name,
    };
    
    // Pregnancy section (new format post-2015)
    if (label.pregnancy) {
      pregnancyInfo.pregnancy = label.pregnancy[0];
    }
    
    // Pregnancy category (old format)
    if (label.pregnancy_category) {
      pregnancyInfo.pregnancy_category = label.pregnancy_category[0];
    }
    
    // Teratogenic effects
    if (label.teratogenic_effects) {
      pregnancyInfo.teratogenic_effects = label.teratogenic_effects[0];
    }
    
    // Nursing mothers / Lactation
    if (label.nursing_mothers) {
      pregnancyInfo.nursing_mothers = label.nursing_mothers[0];
    }
    
    if (label.lactation) {
      pregnancyInfo.lactation = label.lactation[0];
    }
    
    // Females and males of reproductive potential
    if (label.females_and_males_of_reproductive_potential) {
      pregnancyInfo.reproductive_potential = label.females_and_males_of_reproductive_potential[0];
    }
    
    // Labor and delivery
    if (label.labor_and_delivery) {
      pregnancyInfo.labor_and_delivery = label.labor_and_delivery[0];
    }
    
    // Check for contraindication in pregnancy
    const contraindications = label.contraindications?.[0] || "";
    const boxedWarning = label.boxed_warning?.[0] || "";
    
    const pregnancyContraindicated = 
      contraindications.toLowerCase().includes("pregnan") ||
      boxedWarning.toLowerCase().includes("pregnan") ||
      (label.pregnancy?.[0] || "").toLowerCase().includes("contraindicated");
    
    // Determine risk level
    let riskAssessment = "Unknown";
    const pregnancyText = (pregnancyInfo.pregnancy || pregnancyInfo.pregnancy_category || "").toLowerCase();
    
    if (pregnancyContraindicated || pregnancyText.includes("contraindicated")) {
      riskAssessment = "Contraindicated in pregnancy";
    } else if (pregnancyText.includes("category x")) {
      riskAssessment = "Category X - Contraindicated";
    } else if (pregnancyText.includes("category d")) {
      riskAssessment = "Category D - Positive evidence of risk";
    } else if (pregnancyText.includes("category c")) {
      riskAssessment = "Category C - Risk cannot be ruled out";
    } else if (pregnancyText.includes("category b")) {
      riskAssessment = "Category B - No evidence of risk in humans";
    } else if (pregnancyText.includes("category a")) {
      riskAssessment = "Category A - Adequate studies show no risk";
    }
    
    return {
      drug: args.drug_name,
      pregnancy_risk_assessment: riskAssessment,
      pregnancy_contraindicated: pregnancyContraindicated,
      label_sections: pregnancyInfo,
      protocol_guidance: {
        exclusion_criteria_suggestion: pregnancyContraindicated 
          ? "Pregnant women and women of childbearing potential not using adequate contraception should be excluded"
          : "Consider pregnancy testing and contraception requirements based on risk assessment",
        monitoring_suggestion: "Pregnancy testing at screening and periodic testing during study participation",
      },
      source: "FDA Drug Label via OpenFDA API",
      note: "Always review the complete prescribing information for detailed pregnancy and lactation guidance",
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `Failed to fetch pregnancy/lactation info: ${error.message}`);
    }
    throw error;
  }
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
    
    case "get_drug_label_info":
      return handleGetDrugLabelInfo(args as Parameters<typeof handleGetDrugLabelInfo>[0]);
    
    case "get_recall_info":
      return handleGetRecallInfo(args as Parameters<typeof handleGetRecallInfo>[0]);
    
    case "search_by_indication":
      return handleSearchByIndication(args as Parameters<typeof handleSearchByIndication>[0]);
    
    case "search_by_drug_class":
      return handleSearchByDrugClass(args as Parameters<typeof handleSearchByDrugClass>[0]);
    
    case "compare_label_to_reports":
      return handleCompareLabelToReports(args as Parameters<typeof handleCompareLabelToReports>[0]);
    
    case "get_pediatric_safety":
      return handleGetPediatricSafety(args as Parameters<typeof handleGetPediatricSafety>[0]);
    
    case "get_geriatric_safety":
      return handleGetGeriatricSafety(args as Parameters<typeof handleGetGeriatricSafety>[0]);
    
    case "get_safety_summary":
      return handleGetSafetySummary(args as Parameters<typeof handleGetSafetySummary>[0]);
    
    case "get_pregnancy_lactation_info":
      return handleGetPregnancyLactationInfo(args as Parameters<typeof handleGetPregnancyLactationInfo>[0]);
    
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
