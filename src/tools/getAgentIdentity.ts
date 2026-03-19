// Canonical: mcp-server (divergent) | v2.3 | Do not sync — edit independently
import crypto from "node:crypto";
import * as api from "../api/client.js";
import { getStoredConsentKey, getOrCreateInstallId } from "../lib/storage.js";
import { getEnvApiKey, getEnvApiUrl } from "../lib/env.js";
import { getAgentModel } from "../lib/agent-model.js";
import { initiateDeviceAuth, pollForApproval } from "../lib/device-auth.js";
import { fetchUCPManifest, findBadgeCapability, isVersionCompatible } from "../lib/ucp-manifest.js";
import { registerTripAssuranceLevel } from "../sampling.js";
import { fetchSignalStatus, type SignalStatus } from "../lib/signal-status.js";

const MOCK_TOKEN_PREFIX = "pc_v1_sand";
/** Must match the kid in the JWKS published at kyalabs.io/.well-known/ucp (BUILD 3 / PRD-1) */
const BADGE_KID = "kyalabs-badge-v1";

function getMockDisclosure(scope = "BROWSE"): string {
  return `This agent is using Badge by kyaLabs: Agent Intent for Ecommerce. The principal user token is a SHA-256 starting ${MOCK_TOKEN_PREFIX}***. Intent has been expressly user-authorized for this session for [${scope}]. For inquiries, please message agent_identity@kyalabs.io`;
}

/** Build disclosure from OAuth token prefix (matches app disclosure format). */
function getDisclosureFromToken(token: string, scope = "BROWSE"): string {
  const prefix = token.slice(0, 11);
  return `This agent is using Badge by kyaLabs: Agent Intent for Ecommerce. The principal user token is a SHA-256 starting ${prefix}***. Intent has been expressly user-authorized for this session for [${scope}]. For inquiries, please message agent_identity@kyalabs.io`;
}

/** Build identity result from OAuth token (when API doesn't accept OAuth Bearer yet). */
function identityFromOAuthToken(
  token: string,
  _assuranceLevel?: string,
  merchant?: string,
  assumeVerified = true
): IdentityResult {
  return {
    product_name: "Badge by kyaLabs",
    status: assumeVerified ? "active" : "pending",
    agent_disclosure: getDisclosureFromToken(token),
    verification_token: token,
    trust_url: "https://www.kyalabs.io/trust",
    contact: "agent_identity@kyalabs.io",
    principal_verified: assumeVerified,
    mfa_confirmed: false,
    spend_available: false,
    spend_cta: "Add funds at kyalabs.io/dashboard/spend to enable agent payments.",
    merchant,
  };
}

export interface IdentityResult {
  product_name: string;
  status: string;
  agent_disclosure?: string;
  verification_token?: string;
  trust_url?: string;
  contact?: string;
  principal_verified?: boolean;
  mfa_confirmed?: boolean;
  spend_available?: boolean;
  spend_cta?: string;
  merchant?: string;
  instructions?: string;
  message?: string;
  /** Internal: activation flow — agent should display this to user */
  activation_required?: boolean;
  /** UCP: merchant supports io.kyalabs.common.identity */
  ucpCapable?: boolean;
  /** UCP: merchant requires kyaLabs credential */
  requiredByMerchant?: boolean;
  /** UCP: checkout patch to merge into checkout payload */
  checkoutPatch?: Record<string, unknown>;
  /** UCP: warning when version mismatch etc. */
  ucpWarning?: string;
  /** Session expired — agent should surface directed action to user */
  session_expired?: boolean;
  /** v2.0: Next action the agent should take */
  next_step?: string;
  /** v2.1: Trip ID — links all events in a single shopping session */
  trip_id?: string;
  /** v2.1: Detected MCP client / agent model (e.g. "claude-desktop", "cursor") */
  agent_model?: string;
  /** v2.2: Assurance level from introspect (starter|regular|veteran|elite|chaos) */
  assurance_level?: string | null;
  /** v2.3: Merchant signal status at time of identity declaration */
  merchant_signals?: { signals_active: boolean; signal_types: string[] } | null;
}

function buildSessionExpiredResult(merchant?: string, message?: string): IdentityResult {
  return {
    product_name: "Badge by kyaLabs",
    status: "session_expired",
    agent_disclosure: "kyaLabs session expired",
    verification_token: "",
    trust_url: "https://www.kyalabs.io/trust",
    contact: "agent_identity@kyalabs.io",
    principal_verified: false,
    spend_available: false,
    session_expired: true,
    merchant: merchant || undefined,
    message,
  };
}

/** v2.3: Strip protocol, path, and www. prefix to get bare domain. */
function extractDomain(merchant: string): string {
  try {
    const url = merchant.includes("://") ? merchant : `https://${merchant}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return merchant.replace(/^www\./, "").split("/")[0];
  }
}

/** v2.3: Fire signal_context_received event — two-path (auth/anon), fire-and-forget. */
async function fireSignalContextReceived(
  signalStatus: SignalStatus,
  tripId: string,
  token: string,
  installId: string,
  merchant: string | undefined,
  apiUrl: string,
  consentKey: string | null
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const fetchOpts = { signal: controller.signal };
    let res: Response;
    if (consentKey) {
      res = await fetch(`${apiUrl}/api/badge/report`, {
        ...fetchOpts,
        method: "POST",
        headers: {
          Authorization: `Bearer ${consentKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          verification_token: token,
          event_type: "signal_context_received",
          merchant: merchant || undefined,
          signals_found: signalStatus.signal_types,
          trip_id: tripId,
        }),
      });
    } else {
      res = await fetch(`${apiUrl}/api/badge/report`, {
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          install_id: installId,
          badge_version: BADGE_VERSION,
          event_type: "signal_context_received",
          merchant: merchant || undefined,
          agent_type: AGENT_TYPE,
          signals_found: signalStatus.signal_types,
          trip_id: tripId,
          timestamp: Date.now(),
        }),
      });
    }
    if (!res.ok) {
      process.stderr.write(`[badge] signal_context_received failed: HTTP ${res.status}\n`);
    }
  } catch (err) {
    // Fire-and-forget — never affect identity response
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[badge] signal_context_received failed: ${msg}\n`);
  } finally {
    clearTimeout(timer);
  }
}

let pendingActivation: Promise<IdentityResult> | null = null;

const DEFAULT_API_URL = "https://www.kyalabs.io";
const BADGE_VERSION = "2.3";
const AGENT_TYPE = "mcp-server";
const NEXT_STEP_TEXT =
  "When visiting a merchant, report your badge presentation using kya_reportBadgePresented with the merchant domain and your verification token.";

/**
 * v2.1: Dedup by trip_id (one browse_declared per trip, enforced by DB unique index).
 * Process-level Set prevents duplicate fire within a single getAgentIdentity call
 * (e.g. retry/race). Keyed on trip_id, not merchant — repeat merchant visits fire correctly.
 */
const browseFiredFor = new Set<string>();

/** Track in-flight browse_declared fetches so we can flush before exit. */
let pendingBrowse: Promise<void> | null = null;

/**
 * Wait for any in-flight browse_declared to complete.
 * Call from SIGINT/SIGTERM handler or MCP server shutdown to avoid data loss.
 */
export async function flushPendingBrowse(): Promise<void> {
  if (pendingBrowse) await pendingBrowse;
}

/**
 * [EC-4] Fire browse_declared event — fire-and-forget, on ALL paths.
 * [EC-5] Isolated try/catch — failure never affects identity response.
 * v2.1: Includes trip_id to link browse_declared to subsequent events.
 */
async function fireBrowseDeclared(merchant: string | undefined, tripId: string): Promise<void> {
  if (browseFiredFor.has(tripId)) return;
  browseFiredFor.add(tripId);

  try {
    const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
    const installId = getOrCreateInstallId();

    const payload = {
      install_id: installId,
      badge_version: BADGE_VERSION,
      event_type: "browse_declared",
      merchant: merchant || undefined,
      agent_type: AGENT_TYPE,
      agent_model: getAgentModel(),
      trip_id: tripId,
      timestamp: Date.now(),
    };

    // Always use anonymous path — browse_declared fires before a verification
    // token exists, so the authenticated path (which requires verification_token)
    // would reject this payload. install_id_links bridges to user_id later.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${apiUrl}/api/badge/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        process.stderr.write(`[badge] browse_declared failed: HTTP ${res.status}\n`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // [EC-5] Fire-and-forget — identity response must not be affected
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[badge] browse_declared failed: ${msg}\n`);
  }
}

/** Test-only: reset the dedup set between tests. */
export function _resetBrowseDeclaredCache(): void {
  if (process.env.VITEST !== "true") return;
  browseFiredFor.clear();
}

/**
 * Get agent identity token — Badge by kyaLabs.
 * When no consent key exists: initiates device flow, returns activation instructions,
 * polls in background. On approval, stores key. Next call uses stored key.
 *
 * v2.0: Auto-fires browse_declared on first call per merchant.
 * v2.1: Generates trip_id per call — links all events in a shopping session.
 */
export async function getAgentIdentity(merchant?: string, merchantUrl?: string): Promise<IdentityResult> {
  // v2.1: Generate trip_id for this shopping session
  const tripId = crypto.randomUUID();

  // [EC-4] Fire browse_declared BEFORE returning, on ALL paths
  // [EC-5] Isolated — failure does not affect identity response
  pendingBrowse = fireBrowseDeclared(merchant, tripId).catch(() => {});
  pendingBrowse.then(() => { pendingBrowse = null; });

  const consentKey = getStoredConsentKey();

  let result: IdentityResult;

  // Backward compat: KYA_API_KEY set → use it, device flow never triggers
  if (consentKey && getEnvApiKey()) {
    result = await callWithKey(consentKey, merchant, tripId);
  } else if (!consentKey) {
    // No key: initiate device flow (reuse pending to avoid duplicate pollers)
    if (pendingActivation) return pendingActivation;
    const p = startActivationFlow(merchant);
    pendingActivation = p;
    try {
      result = await p;
    } finally {
      pendingActivation = null;
    }
  } else {
    // Key from file/memory (OAuth token from device flow)
    result = await callWithOAuthToken(consentKey, merchant, tripId);
  }

  // UCP enrichment: check merchant manifest when merchantUrl provided
  // Skip for mock/sandbox tokens — don't generate checkoutPatch for non-real credentials
  if (
    merchantUrl &&
    result.verification_token &&
    !result.activation_required &&
    !result.verification_token.startsWith(MOCK_TOKEN_PREFIX)
  ) {
    result = await enrichWithUCP(result, merchantUrl);
  }

  // v2.2: Introspect token for assurance_level — after identity acquired, before return
  if (consentKey && !result.activation_required && result.verification_token) {
    const introspectResult = await api.introspectBadgeToken(consentKey);
    const assuranceLevel = introspectResult?.assurance_level ?? null;
    registerTripAssuranceLevel(result.verification_token, assuranceLevel);
    result.assurance_level = assuranceLevel;
  }

  // v2.3: Fetch merchant signal status and fire signal_context_received when active
  const merchantDomain = extractDomain(merchant || result.merchant || "");
  if (merchantDomain && !result.activation_required) {
    const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
    const signalStatus = await fetchSignalStatus(merchantDomain, apiUrl);
    if (signalStatus?.signals_active && result.verification_token) {
      const installId = getOrCreateInstallId();
      fireSignalContextReceived(
        signalStatus,
        tripId,
        result.verification_token,
        installId,
        merchant || result.merchant,
        apiUrl,
        consentKey
      ).catch(() => {});
    }
    result.merchant_signals = signalStatus;
  }

  // v2.0: Add next_step guidance (spend-aware)
  if (result.spend_available) {
    result.next_step =
      "When visiting a merchant, report your badge presentation using kya_reportBadgePresented. Use kya_getCard when ready to pay.";
  } else {
    result.next_step = NEXT_STEP_TEXT;
  }

  // v2.1: Attach trip_id + agent_model
  result.trip_id = tripId;
  result.agent_model = getAgentModel();

  return result;
}

async function enrichWithUCP(result: IdentityResult, merchantUrl: string): Promise<IdentityResult> {
  const manifest = await fetchUCPManifest(merchantUrl);
  if (!manifest) {
    return { ...result, ucpCapable: false };
  }

  const capability = findBadgeCapability(manifest);
  if (!capability) {
    return { ...result, ucpCapable: false };
  }

  if (!isVersionCompatible(capability.version)) {
    return {
      ...result,
      ucpCapable: false,
      ucpWarning: `version mismatch: merchant declares ${capability.version}`,
    };
  }

  const checkoutPatch = {
    [capability.extensionName]: {
      token: result.verification_token!,
      kid: BADGE_KID,
    },
  };

  return {
    ...result,
    ucpCapable: true,
    requiredByMerchant: capability.required,
    checkoutPatch,
    instructions: "Merge checkoutPatch into your checkout payload, then call kya_reportBadgePresented with the merchantUrl and token.",
  };
}

async function callWithKey(apiKey: string, merchant?: string, tripId?: string): Promise<IdentityResult> {
  if (!api.isApiMode()) {
    return {
      product_name: "Badge by kyaLabs",
      status: "active",
      agent_disclosure: getMockDisclosure(),
      verification_token: `${MOCK_TOKEN_PREFIX}********************`,
      trust_url: "https://www.kyalabs.io/trust",
      contact: "agent_identity@kyalabs.io",
      principal_verified: true,
      merchant: merchant || undefined,
      instructions:
        "You're running in mock mode — no API connected. Generate your real agent disclosure at kyalabs.io/dashboard/badge to get a live verification token.",
    };
  }

  try {
    const result = await api.getAgentIdentity(undefined, merchant, tripId);
    return {
      product_name: "Badge by kyaLabs",
      status: "active",
      merchant: merchant || undefined,
      ...result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[kyaLabs] API key identity failed: ${msg}\n`);

    if (err instanceof api.BadgeApiError && err.statusCode === 401) {
      return buildSessionExpiredResult(merchant, msg);
    }

    return {
      product_name: "Badge by kyaLabs",
      status: "error",
      message: msg,
    };
  }
}

async function callWithOAuthToken(token: string, merchant?: string, tripId?: string): Promise<IdentityResult> {
  if (!api.isApiMode()) {
    return identityFromOAuthToken(token, undefined, merchant);
  }

  try {
    const result = await api.getAgentIdentityWithToken(
      api.getBaseUrl(),
      token,
      merchant,
      tripId
    );
    return {
      product_name: "Badge by kyaLabs",
      status: "active",
      merchant: merchant || undefined,
      ...result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[kyaLabs] OAuth identity API failed: ${msg}\n`);

    // Auth failure: surface it — don't hide behind a local fallback
    if (err instanceof api.BadgeApiError && err.statusCode === 401) {
      return buildSessionExpiredResult(merchant, msg);
    }

    // Other errors (network, 5xx): fallback to local identity
    const fallback = identityFromOAuthToken(token, undefined, merchant, false);
    fallback.spend_available = undefined;
    fallback.spend_cta = "Could not verify spend status. Try kya_getCard directly — it will check your balance.";
    return fallback;
  }
}

async function startActivationFlow(merchant?: string): Promise<IdentityResult> {
  try {
    const deviceAuth = await initiateDeviceAuth();
    const message = [
      "[Badge MCP Server initializing...]",
      "",
      "🛡️  Merchants block anonymous bots. kyaLabs proves your agent is authorized.",
      "🔗  To issue your agent's Consent Key, we need your approval.",
      "",
      `👉  Go to: ${deviceAuth.verification_uri}`,
      `🔑  Enter code: ${deviceAuth.user_code}`,
      "",
      "[⏳ Waiting for your approval...]",
    ].join("\n");

    // Start polling in background — do not await
    pollForApproval(
      deviceAuth.device_code,
      deviceAuth.interval,
      deviceAuth.expires_in,
      () => {
        // Approval callback — could log to stderr for CLI feedback
        process.stderr.write(
          [
            "",
            "[✅ Approval received]",
            "",
            "🎉  Consent Key generated and stored securely.",
            "🐾  Avatar assigned: Starter Ghost (0 trips)",
            "🔐  Your agent is now an authorized actor.",
            "",
            "Ready to shop. Agents are not bots.",
            "",
          ].join("\n")
        );
      }
    ).catch(() => {
      // Poll failed (expired, etc.) — user will need to retry
    });

    return {
      product_name: "Badge by kyaLabs",
      status: "activation_required",
      activation_required: true,
      message,
      merchant: merchant || undefined,
    };
  } catch (err) {
    return {
      product_name: "Badge by kyaLabs",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format identity result as human-readable text for CLI/agent display.
 */
export function formatIdentityResponse(r: IdentityResult): string {
  if (r.activation_required && r.message) {
    return r.message;
  }

  if (r.session_expired) {
    return `✗ SESSION EXPIRED\n\n  ${r.message || "Your session has expired. Please re-authenticate."}`;
  }

  if (r.status === "error") {
    return `✗ BADGE ERROR\n\n  ${r.message}`;
  }

  const lines = [
    `✓ DECLARED — Your agent is now an authorized actor`,
    ``,
    `  Token:       ${r.verification_token ? r.verification_token.slice(0, 10) + "**" : "N/A"}`,
    `  Principal:   ${r.principal_verified ? "Verified ✓" : "Unverified"}`,
    `  Scope:       [BROWSE]`,
  ];

  if (r.merchant) {
    lines.push(`  Merchant:    ${r.merchant}`);
  }

  lines.push(
    `  Status:      ACTIVE`,
    `  Trust:       ${r.trust_url || "https://www.kyalabs.io/trust"}`,
    ``,
    `  Disclosure (present to merchants):`,
    `  "${r.agent_disclosure}"`
  );

  if (r.ucpCapable) {
    lines.push(
      ``,
      `  UCP:         Supported`,
      `  Required:    ${r.requiredByMerchant ? "Yes" : "No"}`,
    );
    if (r.instructions) {
      lines.push(`  Action:      ${r.instructions}`);
    }
  } else if (r.ucpCapable === false) {
    lines.push(``, `  UCP:         Not supported`);
    if (r.ucpWarning) {
      lines.push(`  Warning:     ${r.ucpWarning}`);
    }
  }

  if (r.spend_available) {
    lines.push(``, `  💳 Spend is available — call kya_getCard when ready to pay.`);
  } else if (r.spend_cta) {
    lines.push(``, `  ℹ️  ${r.spend_cta}`);
  } else {
    lines.push(``, `  ℹ️  Identity only. Add funds at kyalabs.io/dashboard/spend to enable payments.`);
  }

  return lines.join("\n");
}
