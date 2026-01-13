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

const OPENFDA_FAERS_URL = "https://api.fda.gov/drug/event.json";
const OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json";
const OPENFDA_ENFORCEMENT_URL = "https://api.fda.gov/drug/enforcement.json";

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
function buildUrl(baseUrl: string, params: FAERSSearchParams): string {
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
  
  return `${baseUrl}?${urlParams.toString()}`;
}

/**
 * Fetch data from FAERS API
 */
async function fetchFAERS(params: FAERSSearchParams): Promise<FAERSResponse> {
  const url = buildUrl(OPENFDA_FAERS_URL, params);
  
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
  
  const url = buildUrl(OPENFDA_LABEL_URL, { search, limit: 1 });
  
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
  
  const url = buildUrl(OPENFDA_ENFORCEMENT_URL, { search, limit: args.limit || 10 });
  
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
    
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
