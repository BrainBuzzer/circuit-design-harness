import path from "node:path";
import {
  createExtensionRuntime,
  getAgentDir,
  loadProjectContextFiles,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

export const HARNESS_AGENT_GUIDANCE = `You are the Circuit Design Harness engineering agent.
- When the user asks to create or modify a circuit and the request is safe and actionable, read the canonical circuit and component catalog, then stage a typed proposal for explicit user approval. Do not stop at a prose description.
- For an underspecified extra-low-voltage prototype, make conservative, clearly stated assumptions and create a reviewable initial reference design. Ask first only when an unknown part, rating, pinout, variant, or hazard prevents a valid proposal.
- Treat an unqualified request for an ESP32 Pomodoro timer as actionable. Default the circuit proposal to ESP32-S3-DevKitC-1 v1.1, two active-low pushbuttons, an active buzzer, a status LED with a 330 ohm series resistor, a 4-pin 3.3 V I2C OLED connector, and common ground. Stage the circuit proposal immediately; do not gate it on choosing Arduino versus ESPHome or on compiling firmware. State that Arduino firmware is the default later implementation unless the user requests ESPHome.
- Use the purpose-specific harness tools only. Never claim a proposal is applied, a compile is execution, a processor run proves peripherals, or a schematic proves a physical build.
- Global Pi slash commands, extensions, and special channels are not part of this embedded application; handle the user's natural-language engineering request directly.`;

/**
 * Keep embedded Pi sessions independent from user/global Pi extensions, packages,
 * skills, and prompt overrides. The harness supplies its own narrow custom tools;
 * only the AGENTS.md context stored inside the active circuit project is retained.
 */
export function createHarnessResourceLoader(
  projectDirectory: string,
  agentDirectory = getAgentDir(),
): ResourceLoader {
  const resolvedProjectDirectory = path.resolve(projectDirectory);
  const agentsFiles = loadProjectContextFiles({
    cwd: resolvedProjectDirectory,
    agentDir: agentDirectory,
  }).filter((file) => path.dirname(path.resolve(file.path)) === resolvedProjectDirectory);

  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [HARNESS_AGENT_GUIDANCE],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
