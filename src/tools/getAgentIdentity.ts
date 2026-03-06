// Canonical: mcp-server | Synced: 0.7.3 | Do not edit in badge-server
import * as api from "../api/client.js";
import { getStoredConsentKey } from "../lib/storage.js";
import { initiateDeviceAuth, pollForApproval } from "../lib/device-auth.js";

const MOCK_TOKEN_PREFIX = "pc_v1_sand";

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
    spend_cta: "Fund your wallet at payclaw.io to enable agent payments.",
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
}

let pendingActivation: Promise<IdentityResult> | null = null;

/**
 * Get agent identity token — Badge by PayClaw.
 * When no consent key exists: initiates device flow, returns activation instructions,
 * polls in background. On approval, stores key. Next call uses stored key.
 */
export async function getAgentIdentity(merchant?: string): Promise<IdentityResult> {
  const consentKey = getStoredConsentKey();

  // Backward compat: PAYCLAW_API_KEY set → use it, device flow never triggers
  if (consentKey && process.env.PAYCLAW_API_KEY) {
    return callWithKey(consentKey, merchant);
  }

  // No key: initiate device flow (reuse pending to avoid duplicate pollers)
  if (!consentKey) {
    if (pendingActivation) return pendingActivation;
    const p = startActivationFlow(merchant);
    pendingActivation = p;
    try {
      const result = await p;
      return result;
    } finally {
      pendingActivation = null;
    }
  }

  // Key from file/memory (OAuth token from device flow)
  return callWithOAuthToken(consentKey, merchant);
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
    return {
      product_name: "PayClaw Badge",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
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
  } catch {
    // API may not accept OAuth tokens yet — build identity locally
    return identityFromOAuthToken(token, undefined, merchant, false);
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

  if (r.spend_available) {
    lines.push(``, `  💳 Spend is available — call payclaw_getCard when ready to pay.`);
  } else if (r.spend_cta) {
    lines.push(``, `  ℹ️  ${r.spend_cta}`);
  } else {
    lines.push(``, `  ℹ️  Identity only. Fund your wallet at payclaw.io to enable payments.`);
  }

  return lines.join("\n");
}
