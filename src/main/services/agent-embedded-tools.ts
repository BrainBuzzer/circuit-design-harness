import { assessSimulation, EmbeddedFeatureSchema, EmbeddedTargetIdSchema } from "@domain/embedded";
import {
  FirmwareCircuitRequestSchema,
  prepareFirmwareCircuitScenario,
} from "@domain/firmware-trace";
import { BUILTIN_IC_MODELS } from "@domain/ic-models";
import { SIMULATION_MODEL_PACK_GUIDANCE } from "@domain/simulation-model";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import type { AssemblyService } from "./assembly-service";
import type { CircuitService } from "./circuit-service";
import type { EmbeddedCatalogService } from "./embedded-catalog-service";
import type { FirmwareService } from "./firmware-service";
import type { SimulationModelService } from "./simulation-model-service";

const AssessmentInputSchema = z.object({
  targetId: EmbeddedTargetIdSchema,
  requiredFeatures: z.array(EmbeddedFeatureSchema).max(50),
  preferredEngine: z.enum(["simavr", "qemu", "compile_only"]).optional(),
});

export function createAgentEmbeddedTools(
  projectId: string,
  assemblies: AssemblyService,
  circuits: CircuitService,
  embeddedCatalog: EmbeddedCatalogService,
  firmware: FirmwareService,
  simulationModels: SimulationModelService,
): ToolDefinition[] {
  const getAssembly = defineTool({
    name: "get_breadboard_assembly",
    label: "Read breadboard build map",
    description:
      "Returns the canonical physical breadboard placement, jumpers, circuit revision, and diagnostics including physical shorts and missing logical connectivity.",
    promptSnippet: "Inspect the current physical breadboard build map and its diagnostics.",
    promptGuidelines: [
      "Treat assembly diagnostics as design checks, not proof that the photographed physical build matches the map.",
      "Never infer hidden breadboard connections, component values, or polarity from an image alone.",
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await assemblies.getSnapshot(projectId);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot) }],
        details: {
          assemblyRevision: snapshot.document.revision,
          circuitRevision: snapshot.document.circuitRevision,
        },
      };
    },
  });

  const assessEmbedded = defineTool({
    name: "assess_embedded_simulation",
    label: "Assess board simulation coverage",
    description:
      "Reports local build and simulation coverage for Arduino Uno R3 or ESP32-S3. It distinguishes processor execution, partial peripheral models, unsupported features, and installed tool availability.",
    promptSnippet:
      "Check whether the selected board and required peripherals can actually be simulated.",
    promptGuidelines: [
      "Never describe compile-only validation as simulation.",
      "Report each unsupported or approximated peripheral and recommend hardware-in-the-loop checks when needed.",
    ],
    parameters: Type.Object({
      targetId: Type.Union(
        EmbeddedTargetIdSchema.options.map((target) => Type.Literal(target)) as [
          ReturnType<typeof Type.Literal>,
          ReturnType<typeof Type.Literal>,
        ],
      ),
      requiredFeatures: Type.Array(Type.String(), { maxItems: 50 }),
      preferredEngine: Type.Optional(
        Type.Union([Type.Literal("simavr"), Type.Literal("qemu"), Type.Literal("compile_only")]),
      ),
    }),
    execute: async (_toolCallId, rawInput) => {
      const input = AssessmentInputSchema.parse(rawInput);
      const [assessment, catalog] = await Promise.all([
        Promise.resolve(
          assessSimulation({
            targetId: input.targetId,
            requiredFeatures: input.requiredFeatures,
            ...(input.preferredEngine ? { preferredEngine: input.preferredEngine } : {}),
          }),
        ),
        embeddedCatalog.getSnapshot(),
      ]);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ assessment, installedTools: catalog.tools }),
          },
        ],
        details: { targetId: input.targetId, overall: assessment.overall },
      };
    },
  });

  const searchEspHome = defineTool({
    name: "search_esphome_catalog",
    label: "Search official ESPHome catalog",
    description:
      "Searches the pinned official ESPHome in-tree component and ESP32 board catalog. Results include platforms, source, and official documentation URLs. Final YAML must still be validated by ESPHome itself.",
    promptSnippet:
      "Find official ESPHome components and guides without inventing configuration keys.",
    promptGuidelines: [
      "Prefer official documentation links returned by this tool and state the pinned catalog commit.",
      "Do not invent YAML options. Recommend running ESPHome validation for the exact installed version.",
    ],
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 100 }),
      kind: Type.Optional(Type.Union([Type.Literal("component"), Type.Literal("board")])),
    }),
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          query: z.string().trim().min(1).max(100),
          kind: z.enum(["component", "board"]).optional(),
        })
        .parse(rawInput);
      const snapshot = await embeddedCatalog.getSnapshot();
      const query = input.query.toLowerCase();
      const components =
        input.kind === "board"
          ? []
          : snapshot.components
              .filter((component) =>
                `${component.name} ${component.platforms.join(" ")}`.toLowerCase().includes(query),
              )
              .slice(0, 20);
      const boards =
        input.kind === "component"
          ? []
          : snapshot.boards
              .filter((board) =>
                `${board.id} ${board.name} ${board.target}`.toLowerCase().includes(query),
              )
              .slice(0, 20);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              esphomeCommit: snapshot.esphomeCommit,
              documentationCommit: snapshot.documentationCommit,
              components,
              boards,
            }),
          },
        ],
        details: { componentCount: components.length, boardCount: boards.length },
      };
    },
  });

  const listIcModels = defineTool({
    name: "list_builtin_ic_models",
    label: "List built-in IC simulation models",
    description:
      "Returns the ten locally integrated IC models, physical pin maps, manufacturer datasheets, behavior fidelity, and explicit model limitations.",
    promptSnippet: "Inspect the available local IC models before adding an integrated circuit.",
    promptGuidelines: [
      "Use exact model IDs and pin IDs from this tool when proposing circuit edits.",
      "Always repeat the model limitations when a conclusion depends on analog, timing, thermal, current, motor, or other unmodeled physics.",
    ],
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: JSON.stringify({ models: BUILTIN_IC_MODELS }) }],
      details: { modelCount: BUILTIN_IC_MODELS.length },
    }),
  });

  const listProjectModels = defineTool({
    name: "list_project_simulation_models",
    label: "List project datasheet models",
    description:
      "Returns declarative component model packs explicitly installed in this project. Packs run only through fixed local declarative adapters and retain page-level provenance and limitations.",
    promptSnippet: "Inspect project-specific datasheet model packs and their runtime status.",
    promptGuidelines: [
      "Never promote declarative functional evaluation to electrical, timing, thermal, or safety validation.",
      "Use recorded attachment hashes, pages, claims, and confidence when discussing model provenance.",
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await simulationModels.list(projectId);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot) }],
        details: { modelCount: snapshot.models.length },
      };
    },
  });

  const getModelGuidance = defineTool({
    name: "get_simulation_model_pack_guidance",
    label: "Read datasheet model-pack contract",
    description:
      "Returns the strict declarative JSON contract and safety rules for proposing a component model from attached datasheet pages. Installation remains an explicit user action in the workbench.",
    promptSnippet:
      "Build a cited, reviewable component model proposal from attached datasheet evidence.",
    promptGuidelines: [
      "Return proposal JSON in a fenced json block for user review; do not claim it is installed.",
      "Do not infer missing values. Cite the exact attachment UUID and page for every modeled claim.",
    ],
    parameters: Type.Object({}),
    execute: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            guidance: SIMULATION_MODEL_PACK_GUIDANCE,
            proposalShape: {
              schemaVersion: 1,
              id: "lowercase-model-id",
              revision: 1,
              name: "Component name",
              manufacturer: "Optional manufacturer",
              partNumber: "Exact part number",
              targets: ["arduino_uno_r3", "esp32s3"],
              pins: [{ id: "pin-id", name: "Pin name", role: "digital_input" }],
              electrical: {
                recommendedMinVoltage: 0,
                recommendedMaxVoltage: 0,
                absoluteMaxVoltage: 0,
                maxPinCurrentMa: 0,
              },
              behavior: {
                kind: "digital_gpio",
                inputPins: ["pin-id"],
                outputPins: [],
                truthTable: [{ when: { "pin-id": 0 }, outputs: {} }],
              },
              limitations: ["Every omitted behavior and uncertainty."],
              provenance: [
                {
                  attachmentId: "UUID shown in attachment evidence",
                  pageNumber: 1,
                  claim: "Exact claim supported by this page",
                  confidence: "high",
                },
              ],
            },
          }),
        },
      ],
      details: { schemaVersion: SIMULATION_MODEL_PACK_GUIDANCE.schemaVersion },
    }),
  });

  const runFirmwareCircuitScenario = defineTool({
    name: "run_uno_firmware_circuit_scenario",
    label: "Run Uno firmware-to-circuit scenario",
    description:
      "Executes the latest compiled Arduino Uno R3 ELF in pinned simavr for bounded virtual time, captures real digital output/UART events, maps selected output pins into circuit nets, and evaluates functional IC assertions.",
    promptSnippet:
      "Test an already-compiled Uno sketch against explicit circuit-net mappings and assertions.",
    promptGuidelines: [
      "Never claim analog, current, timing-margin, thermal, physical-build, or electrical-safety validation from this functional bridge.",
      "Report unobserved output pins, trace truncation, assertion failures, and all model limitations verbatim.",
      "This tool does not compile firmware or mutate the circuit; ask the user to compile/apply changes first when required.",
    ],
    parameters: Type.Object({
      firmwareKind: Type.Union([Type.Literal("arduino"), Type.Literal("esphome")]),
      virtualDurationMicros: Type.Integer({ minimum: 1000, maximum: 5000000 }),
      pinBridges: Type.Array(
        Type.Object({
          firmwarePin: Type.String({ minLength: 2, maxLength: 20 }),
          net: Type.String({ minLength: 1, maxLength: 80 }),
        }),
        { minItems: 1, maxItems: 40 },
      ),
      scenario: Type.Any(),
    }),
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          firmwareKind: z.enum(["arduino", "esphome"]),
          virtualDurationMicros: z.int().min(1000).max(5000000),
          pinBridges: FirmwareCircuitRequestSchema.shape.pinBridges,
          scenario: FirmwareCircuitRequestSchema.shape.scenario,
        })
        .strict()
        .parse(rawInput);
      const execution = await firmware.runSimulation({
        projectId,
        targetId: "arduino_uno_r3",
        engine: "simavr",
        firmwareKind: input.firmwareKind,
        virtualDurationMicros: input.virtualDurationMicros,
        circuit: { pinBridges: input.pinBridges, scenario: input.scenario },
      });
      if (!execution.trace) {
        return {
          content: [{ type: "text", text: JSON.stringify(execution) }],
          details: { outcome: execution.outcome, circuitOutcome: "blocked" },
        };
      }
      const preparation = prepareFirmwareCircuitScenario(execution.trace, {
        pinBridges: input.pinBridges,
        scenario: input.scenario,
      });
      if (!preparation.scenario) {
        const result = {
          ...execution,
          circuitBridge: {
            outcome: "blocked",
            appliedStimuli: preparation.appliedStimuli,
            diagnostics: preparation.diagnostics,
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: { outcome: execution.outcome, circuitOutcome: "blocked" },
        };
      }
      const scenario = await circuits.runModelScenario(projectId, preparation.scenario);
      const result = {
        ...execution,
        coverage: { ...execution.coverage, circuitAssertions: "evaluated" },
        circuitBridge: {
          outcome: scenario.outcome,
          appliedStimuli: preparation.appliedStimuli,
          diagnostics: preparation.diagnostics,
          scenario,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { outcome: execution.outcome, circuitOutcome: scenario.outcome },
      };
    },
  });

  const readProjectFirmware = defineTool({
    name: "read_project_firmware",
    label: "Read project firmware",
    description:
      "Reads the project-owned Arduino sketch or ESPHome YAML through a bounded firmware service. It cannot read any other file.",
    promptSnippet: "Inspect the current project firmware before changing or compiling it.",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("arduino"), Type.Literal("esphome")]),
    }),
    execute: async (_toolCallId, rawInput) => {
      const { kind } = z.object({ kind: z.enum(["arduino", "esphome"]) }).parse(rawInput);
      const result =
        kind === "arduino"
          ? await firmware.readArduino(projectId)
          : await firmware.readEspHome(projectId);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: { kind } };
    },
  });

  const compileArduinoFirmware = defineTool({
    name: "compile_arduino_firmware",
    label: "Save and compile Arduino firmware",
    description:
      "Saves a complete project-local Arduino sketch, performs bounded structural validation, and invokes the allowlisted local compiler for Arduino Uno R3 or ESP32-S3 without a shell.",
    promptSnippet:
      "Author and compile project-local Arduino firmware for the selected supported board.",
    promptGuidelines: [
      "Read the current firmware first and send a complete replacement sketch only when the user's request requires a firmware change.",
      "Report structural validation, compiler outcome, and artifact production separately; compilation is not processor, peripheral, circuit, or hardware validation.",
    ],
    parameters: Type.Object({
      targetId: Type.Union([Type.Literal("arduino_uno_r3"), Type.Literal("esp32s3")]),
      source: Type.String({ minLength: 1, maxLength: 1024 * 1024 }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          targetId: z.enum(["arduino_uno_r3", "esp32s3"]),
          source: z
            .string()
            .min(1)
            .max(1024 * 1024),
        })
        .parse(rawInput);
      const result = await firmware.compileArduino({ projectId, ...input });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { targetId: input.targetId, outcome: result.compilation.outcome },
      };
    },
  });

  const compileEspHomeFirmware = defineTool({
    name: "compile_esphome_firmware",
    label: "Save, validate, and compile ESPHome firmware",
    description:
      "Saves complete project-local ESPHome YAML, validates it against the pinned catalog and installed ESPHome tool, then compiles only when safe and valid.",
    promptSnippet: "Author and validate project-local ESPHome YAML for an ESP32-S3 board.",
    promptGuidelines: [
      "Search the pinned ESPHome catalog first and do not invent configuration options.",
      "Use only ESP32-S3 boards for executable product workflows; other catalog boards are reference-only.",
      "Report validation, compilation, artifact creation, and simulation coverage separately.",
    ],
    parameters: Type.Object({
      yaml: Type.String({ minLength: 1, maxLength: 1024 * 1024 }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          yaml: z
            .string()
            .min(1)
            .max(1024 * 1024),
        })
        .parse(rawInput);
      const result = await firmware.compileEspHome({ projectId, yaml: input.yaml });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { outcome: result.compilation.outcome, valid: result.validation.valid },
      };
    },
  });

  const runFirmwareSimulation = defineTool({
    name: "run_local_firmware_simulation",
    label: "Run local firmware simulation",
    description:
      "Runs an already-compiled supported firmware artifact in the selected pinned local processor engine. It returns explicit CPU, GPIO, UART, and circuit-assertion coverage fields.",
    promptSnippet:
      "Run a bounded local firmware processor simulation and report its exact coverage.",
    promptGuidelines: [
      "Use simavr only with Arduino Uno R3 and QEMU only with ESP32-S3.",
      "ESP32-S3 GPIO/circuit bridging is unsupported in the pinned QEMU; never infer it from console output.",
      "A processor run is not electrical, physical-build, peripheral, timing-margin, thermal, or safety proof.",
    ],
    parameters: Type.Object({
      targetId: Type.Union([Type.Literal("arduino_uno_r3"), Type.Literal("esp32s3")]),
      firmwareKind: Type.Union([Type.Literal("arduino"), Type.Literal("esphome")]),
      engine: Type.Union([Type.Literal("simavr"), Type.Literal("qemu")]),
      virtualDurationMicros: Type.Optional(Type.Integer({ minimum: 1000, maximum: 5000000 })),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          targetId: z.enum(["arduino_uno_r3", "esp32s3"]),
          firmwareKind: z.enum(["arduino", "esphome"]),
          engine: z.enum(["simavr", "qemu"]),
          virtualDurationMicros: z.int().min(1000).max(5000000).optional(),
        })
        .parse(rawInput);
      const result = await firmware.runSimulation({
        projectId,
        targetId: input.targetId,
        firmwareKind: input.firmwareKind,
        engine: input.engine,
        ...(input.virtualDurationMicros === undefined
          ? {}
          : { virtualDurationMicros: input.virtualDurationMicros }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { targetId: input.targetId, outcome: result.outcome },
      };
    },
  });

  return [
    getAssembly,
    assessEmbedded,
    searchEspHome,
    listIcModels,
    listProjectModels,
    getModelGuidance,
    readProjectFirmware,
    compileArduinoFirmware,
    compileEspHomeFirmware,
    runFirmwareSimulation,
    runFirmwareCircuitScenario,
  ];
}
