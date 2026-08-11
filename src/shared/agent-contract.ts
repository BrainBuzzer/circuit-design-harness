export type PiAuthType = "api_key" | "oauth";

export interface PiProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly supportsApiKey: boolean;
  readonly supportsOAuth: boolean;
  readonly apiKeyLabel?: string;
  readonly oauthLabel?: string;
  readonly authenticated: boolean;
  readonly canLogout: boolean;
  readonly authType?: PiAuthType;
  readonly authSource?: string;
}

export interface PiModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly supportsImages: boolean;
  readonly contextWindow: number;
}

export interface AgentChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

export type AgentActivity = "unconfigured" | "ready" | "thinking" | "error";

export interface AgentSnapshot {
  readonly activity: AgentActivity;
  readonly activeProjectId?: string;
  readonly activeModel?: PiModelInfo;
  readonly providers: readonly PiProviderInfo[];
  readonly availableModels: readonly PiModelInfo[];
  readonly pendingCircuitProposals: readonly CircuitProposal[];
  readonly pendingAssemblyProposals: readonly AssemblyProposal[];
  readonly error?: string;
}

export type AuthPromptDetails =
  | {
      readonly type: "text" | "secret" | "manual_code";
      readonly message: string;
      readonly placeholder?: string;
    }
  | {
      readonly type: "select";
      readonly message: string;
      readonly options: readonly {
        readonly id: string;
        readonly label: string;
        readonly description?: string;
      }[];
    };

export type AuthNotification =
  | {
      readonly type: "info";
      readonly message: string;
      readonly links?: readonly { readonly url: string; readonly label?: string }[];
    }
  | {
      readonly type: "auth_url";
      readonly url: string;
      readonly instructions?: string;
    }
  | {
      readonly type: "device_code";
      readonly userCode: string;
      readonly verificationUri: string;
      readonly intervalSeconds?: number;
      readonly expiresInSeconds?: number;
    }
  | {
      readonly type: "progress";
      readonly message: string;
    };

export type AgentEvent =
  | {
      readonly type: "snapshot";
      readonly snapshot: AgentSnapshot;
    }
  | {
      readonly type: "conversation";
      readonly projectId: string;
      readonly messages: readonly AgentChatMessage[];
    }
  | {
      readonly type: "text-delta";
      readonly projectId: string;
      readonly delta: string;
    }
  | {
      readonly type: "response-end";
      readonly projectId: string;
    }
  | {
      readonly type: "error";
      readonly projectId?: string;
      readonly message: string;
    }
  | {
      readonly type: "auth-prompt";
      readonly flowId: string;
      readonly promptId: string;
      readonly providerId: string;
      readonly providerName: string;
      readonly prompt: AuthPromptDetails;
    }
  | {
      readonly type: "auth-notification";
      readonly flowId: string;
      readonly providerId: string;
      readonly notification: AuthNotification;
    }
  | {
      readonly type: "auth-complete";
      readonly flowId: string;
      readonly providerId: string;
    }
  | {
      readonly type: "auth-error";
      readonly flowId: string;
      readonly providerId: string;
      readonly message: string;
      readonly cancelled: boolean;
    };

export interface SendAgentMessageInput {
  readonly projectId: string;
  readonly text: string;
  readonly attachmentIds?: readonly string[];
  readonly captureIds?: readonly string[];
}

export interface StartProviderLoginInput {
  readonly providerId: string;
  readonly authType: PiAuthType;
}

export interface RespondToAuthPromptInput {
  readonly flowId: string;
  readonly promptId: string;
  readonly value: string;
}

export interface SetAgentModelInput {
  readonly projectId: string;
  readonly providerId: string;
  readonly modelId: string;
}

export interface ResolveCircuitProposalInput {
  readonly projectId: string;
  readonly proposalId: string;
}

import type { AssemblyProposal } from "@domain/assembly";
import type { CircuitProposal } from "@domain/circuit";
