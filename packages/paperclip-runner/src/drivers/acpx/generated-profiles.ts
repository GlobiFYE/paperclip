// Generated from acpx-profiles.json and cursor-distributions.json. Do not edit.
export const QUALIFIED_ACPX_VERSION = "0.13.1" as const;
export const ACPX_DRIVER_KIND = "acpx_runtime" as const;
export const ACPX_DRIVER_PROTOCOL_VERSION = 1 as const;

export const QUALIFIED_ACPX_PROFILE_DATA = {
  "grok": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "grok",
    "agentProfileVersion": 1,
    "agentServerPackage": "builtin:grok-acp",
    "agentServerVersion": "1",
    "agentRuntimePackage": "native:grok",
    "agentRuntimeVersion": "1.0.13",
    "commandDigest": "sha256:f0b698395a3704ed2ffaf84ea19bdb20c36c8a0a70b7c629c7b6ffe144e59e55",
    "permissionPolicy": "interactive"
  },
  "pi": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "pi",
    "agentProfileVersion": 23,
    "agentServerPackage": "pi-acp",
    "agentServerVersion": "0.0.33",
    "agentRuntimePackage": "@earendil-works/pi-coding-agent",
    "agentRuntimeVersion": "1.0.0",
    "commandDigest": "sha256:00212ff82fe291808024890b3ae07bb7f83a79a7f454710e570b8090b1289906",
    "permissionPolicy": "interactive"
  },
  "cursor": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "cursor",
    "agentProfileVersion": 16,
    "agentServerPackage": "cursor-agent",
    "agentServerVersion": "2026.09.26-dd393fe",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:1ff7b7149a4d0f9177d656f59e9cda3e43b9265bd0c735e394cdf3a928a05b82",
    "permissionPolicy": "interactive"
  },
  "copilot": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "copilot",
    "agentProfileVersion": 19,
    "agentServerPackage": "@github/copilot",
    "agentServerVersion": "1.0.88",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:81c65c8a47fdf94ea89d363ee14c0b0ba55221785a24ef3593a411e40ffedfdb",
    "qualificationStatus": "pending",
    "permissionPolicy": "interactive"
  },
  "claude": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "claude",
    "agentProfileVersion": 1,
    "agentServerPackage": "@agentclientprotocol/claude-agent-acp",
    "agentServerVersion": "0.73.0",
    "agentRuntimePackage": "@anthropic-ai/claude-agent-sdk",
    "agentRuntimeVersion": "0.3.286",
    "commandDigest": "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
    "permissionPolicy": "interactive"
  },
  "codex": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "codex",
    "agentProfileVersion": 1,
    "agentServerPackage": "@agentclientprotocol/codex-acp",
    "agentServerVersion": "1.6.2",
    "agentRuntimePackage": "@openai/codex",
    "agentRuntimeVersion": "0.160.0",
    "commandDigest": "sha256:c4538599d1ab767db5dff50934f13bb5ba313a59d9c4a83e993fac4617ea63d3",
    "permissionPolicy": "interactive"
  }
} as const;

export const CURSOR_DISTRIBUTION_PINS = {
  "darwin-arm64": {
    "closureSha256": "257424bd48e35412091c6adfc61e4648e836757ec1d240d890bba81a24918c30",
    "executable": "node",
    "entrypoint": "index.js"
  },
  "darwin-x64": {
    "closureSha256": "6f28c799c5afdc64fbdff8a2157f565f17ae7615efe014ac389d63bf70cf2be2",
    "executable": "node",
    "entrypoint": "index.js"
  },
  "linux-x64": {
    "closureSha256": "eadb8bb8ffb0450455b15b88c9b230307a9e149958a0c452d16dd157b4633d74",
    "executable": "node",
    "entrypoint": "index.js"
  }
} as const;
