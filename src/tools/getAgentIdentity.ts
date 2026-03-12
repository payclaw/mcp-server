// Canonical: badge-server | Synced: PRD-3 | mcp-server syncs from here
import * as api from "../api/client.js";
import { getStoredConsentKey } from "../lib/storage.js";
import { initiateDeviceAuth, pollForApproval } from "../lib/device-auth.js";
import { fetchUCPManifest, findPayClawCapability, isVersionCompatible } from "../lib/ucp-manifest.js";

const MOCK_TOKEN_PREFIX = "pc_v1_sand";
/** Must match the kid in the JWKS published at payclaw.io/.well-known/ucp (BUILD 3 / PRD-1) */
const PAYCLAW_KID = "payclaw-badge-v1";

function getMockDisclosure(scope = "BROWSE"): string {
  return `This agent is using PayClaw Badge: Agent Intent for Ecommerce. The principal user token is a SHA-256 starting ${MOCK_TOKEN_PREFIX}***. Intent has been expressly user-authorized for this session for [${scope}]. For inquiries, please message agent_identity@payclaw.io`;
}

/** Build disclosure from OAuth token prefix (matches app disclosure format). */
function getDisclosureFromToken(token: string, scope = "BROWSE"): string {
  const prefix = token.slice(0, 11);
  return `This agent is using PayClaw Badge: Agent Intent for Ecommerce. The principal user token is a SHA-256 starting ${prefix}***. Intent has been expressly user-authorized for this session for [${scope}]. For inquiries, please message agent_identity@payclaw.io`;
}

/** Build identity result from OAuth token (when API doesn't accept OAuth Bearer yet). */
function identityFromOAuthToken(
  token: string,
  _assuranceLevel?: string,
  merchant?: string,
  assumeVerified = true
): IdentityResult {
  return {
    product_name: "PayClaw Badge",
    status: assumeVerified ? "active" : "pending",
    agent_disclosure: getDisclosureFromToken(token),
    verification_token: token,
    trust_url: "https://payclaw.io/trust",
    contact: "agent_identity@payclaw.io",
    principal_verified: assumeVerified,
    mfa_confirmed: false,
    spend_available: false,
    spend_cta: "Add funds at payclaw.io/dashboard/spend to enable agent payments.",
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
  /** UCP: merchant supports io.payclaw.common.identity */
  ucpCapable?: boolean;
  /** UCP: merchant requires PayClaw credential */
  requiredByMerchant?: boolean;
  /** UCP: checkout patch to merge into checkout payload */
  checkoutPatch?: Record<string, unknown>;
  /** UCP: warning when version mismatch etc. */
  ucpWarning?: string;
  /** Session expired — agent should surface directed action to user */
  session_expired?: boolean;
}

function buildSessionExpiredResult(merchant?: string, message?: string): IdentityResult {
  return {
    product_name: "PayClaw Badge",
    status: "session_expired",
    agent_disclosure: "PayClaw session expired",
    verification_token: "",
    trust_url: "https://payclaw.io/trust",
    contact: "agent_identity@payclaw.io",
    principal_verified: false,
    spend_available: false,
    session_expired: true,
    merchant: merchant || undefined,
    message,
  };
}

let pendingActivation: Promise<IdentityResult> | null = null;

/**
 * Get agent identity token — Badge by PayClaw.
 * When no consent key exists: initiates device flow, returns activation instructions,
 * polls in background. On approval, stores key. Next call uses stored key.
 */
export async function getAgentIdentity(merchant?: string, merchantUrl?: string): Promise<IdentityResult> {
  const consentKey = getStoredConsentKey();

  let result: IdentityResult;

  // Backward compat: PAYCLAW_API_KEY set → use it, device flow never triggers
  if (consentKey && process.env.PAYCLAW_API_KEY) {
    result = await callWithKey(consentKey, merchant);
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
    result = await callWithOAuthToken(consentKey, merchant);
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

  return result;
}

async function enrichWithUCP(result: IdentityResult, merchantUrl: string): Promise<IdentityResult> {
  const manifest = await fetchUCPManifest(merchantUrl);
  if (!manifest) {
    return { ...result, ucpCapable: false };
  }

  const capability = findPayClawCapability(manifest);
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
    "io.payclaw.common.identity": {
      token: result.verification_token!,
      kid: PAYCLAW_KID,
    },
  };

  return {
    ...result,
    ucpCapable: true,
    requiredByMerchant: capability.required,
    checkoutPatch,
    instructions: "Merge checkoutPatch into your checkout payload, then call payclaw_reportBadgePresented with the merchantUrl and token.",
  };
}

async function callWithKey(apiKey: string, merchant?: string): Promise<IdentityResult> {
  if (!api.isApiMode()) {
    return {
      product_name: "PayClaw Badge",
      status: "active",
      agent_disclosure: getMockDisclosure(),
      verification_token: `${MOCK_TOKEN_PREFIX}********************`,
      trust_url: "https://payclaw.io/trust",
      contact: "agent_identity@payclaw.io",
      principal_verified: true,
      merchant: merchant || undefined,
      instructions:
        "You're running in mock mode — no API connected. Generate your real agent disclosure at payclaw.io/dashboard/badge to get a live verification token.",
    };
  }

  try {
    const result = await api.getAgentIdentity(undefined, merchant);
    return {
      product_name: "PayClaw Badge",
      status: "active",
      merchant: merchant || undefined,
      ...result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[PayClaw] API key identity failed: ${msg}\n`);

    if (err instanceof api.PayClawApiError && err.statusCode === 401) {
      return buildSessionExpiredResult(merchant, msg);
    }

    return {
      product_name: "PayClaw Badge",
      status: "error",
      message: msg,
    };
  }
}

async function callWithOAuthToken(token: string, merchant?: string): Promise<IdentityResult> {
  if (!api.isApiMode()) {
    return identityFromOAuthToken(token, undefined, merchant);
  }

  try {
    const result = await api.getAgentIdentityWithToken(
      api.getBaseUrl(),
      token,
      merchant
    );
    return {
      product_name: "PayClaw Badge",
      status: "active",
      merchant: merchant || undefined,
      ...result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[PayClaw] OAuth identity API failed: ${msg}\n`);

    // Auth failure: surface it — don't hide behind a local fallback
    if (err instanceof api.PayClawApiError && err.statusCode === 401) {
      return buildSessionExpiredResult(merchant, msg);
    }

    // Other errors (network, 5xx): fallback to local identity
    const fallback = identityFromOAuthToken(token, undefined, merchant, false);
    fallback.spend_available = undefined;
    fallback.spend_cta = "Could not verify spend status. Try payclaw_getCard directly — it will check your balance.";
    return fallback;
  }
}

async function startActivationFlow(merchant?: string): Promise<IdentityResult> {
  try {
    const deviceAuth = await initiateDeviceAuth();
    const message = [
      "[PayClaw MCP Server initializing...]",
      "",
      "🛡️  Merchants block anonymous bots. PayClaw proves your agent is authorized.",
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
      product_name: "PayClaw Badge",
      status: "activation_required",
      activation_required: true,
      message,
      merchant: merchant || undefined,
    };
  } catch (err) {
    return {
      product_name: "PayClaw Badge",
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
    `  Trust:       ${r.trust_url || "https://payclaw.io/trust"}`,
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
    lines.push(``, `  💳 Spend is available — call payclaw_getCard when ready to pay.`);
  } else if (r.spend_cta) {
    lines.push(``, `  ℹ️  ${r.spend_cta}`);
  } else {
    lines.push(``, `  ℹ️  Identity only. Add funds at payclaw.io/dashboard/spend to enable payments.`);
  }

  return lines.join("\n");
}
