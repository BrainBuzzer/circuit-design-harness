export const PART_KIND_IDS = [
  "dc_source",
  "battery",
  "ac_source",
  "resistor",
  "potentiometer",
  "thermistor",
  "ldr",
  "capacitor",
  "polarized_capacitor",
  "variable_capacitor",
  "inductor",
  "transformer",
  "crystal",
  "diode",
  "zener_diode",
  "schottky_diode",
  "led",
  "photodiode",
  "bridge_rectifier",
  "npn_transistor",
  "pnp_transistor",
  "nmos",
  "pmos",
  "switch",
  "switch_spdt",
  "pushbutton_no",
  "pushbutton_nc",
  "relay",
  "fuse",
  "lamp",
  "motor",
  "buzzer",
  "speaker",
  "ground",
  "vcc",
  "test_point",
  "connector_2",
  "connector_3",
  "connector_4",
  "op_amp",
  "comparator",
  "logic_inverter",
  "esp32s3_devkitc_1",
  "ic",
] as const;

export type PartKind = (typeof PART_KIND_IDS)[number];

export type ComponentCategory =
  | "power"
  | "passive"
  | "semiconductor"
  | "switching"
  | "electromechanical"
  | "connector"
  | "logic"
  | "controller";

export type PinElectricalType = "passive" | "power_in" | "power_out";

export interface CatalogPin {
  readonly id: string;
  readonly name: string;
  readonly electricalType: PinElectricalType;
}

export type SymbolFamily =
  | "source_dc"
  | "battery"
  | "source_ac"
  | "resistor"
  | "resistor_adjustable"
  | "resistor_sensor"
  | "capacitor"
  | "capacitor_polarized"
  | "capacitor_variable"
  | "inductor"
  | "transformer"
  | "crystal"
  | "diode"
  | "diode_zener"
  | "diode_schottky"
  | "diode_led"
  | "diode_photo"
  | "bridge_rectifier"
  | "transistor_bjt_npn"
  | "transistor_bjt_pnp"
  | "transistor_mos_n"
  | "transistor_mos_p"
  | "switch_spst"
  | "switch_spdt"
  | "pushbutton_no"
  | "pushbutton_nc"
  | "relay"
  | "fuse"
  | "lamp"
  | "motor"
  | "buzzer"
  | "speaker"
  | "ground"
  | "power_port"
  | "test_point"
  | "connector"
  | "op_amp"
  | "comparator"
  | "logic_inverter"
  | "development_board"
  | "ic";

export interface ComponentCatalogEntry {
  readonly id: PartKind;
  readonly label: string;
  readonly description: string;
  readonly category: ComponentCategory;
  readonly referencePrefix: string;
  readonly defaultValue?: string;
  readonly requiresValue: boolean;
  readonly symbol: SymbolFamily;
  readonly pins: readonly CatalogPin[];
  readonly limitations: string;
  readonly sourceUrl?: string;
}

const passive = (id: string, name: string): CatalogPin => ({
  id,
  name,
  electricalType: "passive",
});
const powerIn = (id: string, name: string): CatalogPin => ({
  id,
  name,
  electricalType: "power_in",
});
const powerOut = (id: string, name: string): CatalogPin => ({
  id,
  name,
  electricalType: "power_out",
});
const twoPin = [passive("1", "1"), passive("2", "2")] as const;
const diodePins = [passive("anode", "A"), passive("cathode", "K")] as const;
const structural =
  "Structural schematic symbol only; ratings, tolerances, package, footprint, and electrical behavior require separate evidence.";

export const COMPONENT_CATALOG: readonly ComponentCatalogEntry[] = [
  {
    id: "dc_source",
    label: "DC source",
    description: "Independent DC voltage source",
    category: "power",
    referencePrefix: "V",
    defaultValue: "5 V",
    requiresValue: true,
    symbol: "source_dc",
    pins: [powerOut("positive", "+"), powerIn("negative", "−")],
    limitations: structural,
  },
  {
    id: "battery",
    label: "Battery",
    description: "Cell or battery source",
    category: "power",
    referencePrefix: "BT",
    defaultValue: "9 V",
    requiresValue: true,
    symbol: "battery",
    pins: [powerOut("positive", "+"), powerIn("negative", "−")],
    limitations: `${structural} Chemistry, capacity, protection, and charging behavior are not modeled.`,
  },
  {
    id: "ac_source",
    label: "AC source",
    description: "Independent AC voltage source",
    category: "power",
    referencePrefix: "VAC",
    defaultValue: "1 Vrms",
    requiresValue: true,
    symbol: "source_ac",
    pins: [powerOut("1", "1"), powerIn("2", "2")],
    limitations: structural,
  },
  {
    id: "resistor",
    label: "Resistor",
    description: "Fixed resistor",
    category: "passive",
    referencePrefix: "R",
    defaultValue: "1 kΩ",
    requiresValue: true,
    symbol: "resistor",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "potentiometer",
    label: "Potentiometer",
    description: "Three-terminal variable resistor",
    category: "passive",
    referencePrefix: "RV",
    defaultValue: "10 kΩ",
    requiresValue: true,
    symbol: "resistor_adjustable",
    pins: [passive("1", "1"), passive("wiper", "W"), passive("2", "2")],
    limitations: structural,
  },
  {
    id: "thermistor",
    label: "Thermistor",
    description: "Temperature-dependent resistor",
    category: "passive",
    referencePrefix: "RT",
    defaultValue: "10 kΩ NTC",
    requiresValue: true,
    symbol: "resistor_sensor",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "ldr",
    label: "Photoresistor",
    description: "Light-dependent resistor",
    category: "passive",
    referencePrefix: "R",
    defaultValue: "LDR",
    requiresValue: true,
    symbol: "resistor_sensor",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "capacitor",
    label: "Capacitor",
    description: "Non-polarized capacitor",
    category: "passive",
    referencePrefix: "C",
    defaultValue: "100 nF",
    requiresValue: true,
    symbol: "capacitor",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "polarized_capacitor",
    label: "Polarized capacitor",
    description: "Electrolytic or other polarized capacitor",
    category: "passive",
    referencePrefix: "C",
    defaultValue: "10 µF",
    requiresValue: true,
    symbol: "capacitor_polarized",
    pins: [passive("positive", "+"), passive("negative", "−")],
    limitations: structural,
  },
  {
    id: "variable_capacitor",
    label: "Variable capacitor",
    description: "Adjustable capacitor",
    category: "passive",
    referencePrefix: "CV",
    defaultValue: "5–50 pF",
    requiresValue: true,
    symbol: "capacitor_variable",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "inductor",
    label: "Inductor",
    description: "Fixed inductor or choke",
    category: "passive",
    referencePrefix: "L",
    defaultValue: "10 µH",
    requiresValue: true,
    symbol: "inductor",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "transformer",
    label: "Transformer",
    description: "Two-winding transformer",
    category: "passive",
    referencePrefix: "T",
    defaultValue: "1:1",
    requiresValue: true,
    symbol: "transformer",
    pins: [passive("p1", "P1"), passive("p2", "P2"), passive("s1", "S1"), passive("s2", "S2")],
    limitations: structural,
  },
  {
    id: "crystal",
    label: "Crystal",
    description: "Crystal or ceramic resonator",
    category: "passive",
    referencePrefix: "Y",
    defaultValue: "16 MHz",
    requiresValue: true,
    symbol: "crystal",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "diode",
    label: "Diode",
    description: "General rectifier or signal diode",
    category: "semiconductor",
    referencePrefix: "D",
    defaultValue: "1N4148",
    requiresValue: true,
    symbol: "diode",
    pins: diodePins,
    limitations: structural,
  },
  {
    id: "zener_diode",
    label: "Zener diode",
    description: "Voltage-reference or clamp diode",
    category: "semiconductor",
    referencePrefix: "D",
    defaultValue: "5.1 V",
    requiresValue: true,
    symbol: "diode_zener",
    pins: diodePins,
    limitations: structural,
  },
  {
    id: "schottky_diode",
    label: "Schottky diode",
    description: "Low-forward-drop diode",
    category: "semiconductor",
    referencePrefix: "D",
    defaultValue: "1N5819",
    requiresValue: true,
    symbol: "diode_schottky",
    pins: diodePins,
    limitations: structural,
  },
  {
    id: "led",
    label: "LED",
    description: "Light-emitting diode",
    category: "semiconductor",
    referencePrefix: "D",
    defaultValue: "red",
    requiresValue: true,
    symbol: "diode_led",
    pins: diodePins,
    limitations: structural,
  },
  {
    id: "photodiode",
    label: "Photodiode",
    description: "Light-sensitive diode",
    category: "semiconductor",
    referencePrefix: "PD",
    defaultValue: "photodiode",
    requiresValue: true,
    symbol: "diode_photo",
    pins: diodePins,
    limitations: structural,
  },
  {
    id: "bridge_rectifier",
    label: "Bridge rectifier",
    description: "Four-diode bridge package",
    category: "semiconductor",
    referencePrefix: "BR",
    defaultValue: "bridge",
    requiresValue: true,
    symbol: "bridge_rectifier",
    pins: [
      passive("ac1", "~"),
      passive("positive", "+"),
      passive("ac2", "~"),
      passive("negative", "−"),
    ],
    limitations: structural,
  },
  {
    id: "npn_transistor",
    label: "NPN transistor",
    description: "NPN bipolar junction transistor",
    category: "semiconductor",
    referencePrefix: "Q",
    defaultValue: "2N3904",
    requiresValue: true,
    symbol: "transistor_bjt_npn",
    pins: [passive("base", "B"), passive("collector", "C"), passive("emitter", "E")],
    limitations: structural,
  },
  {
    id: "pnp_transistor",
    label: "PNP transistor",
    description: "PNP bipolar junction transistor",
    category: "semiconductor",
    referencePrefix: "Q",
    defaultValue: "2N3906",
    requiresValue: true,
    symbol: "transistor_bjt_pnp",
    pins: [passive("base", "B"), passive("collector", "C"), passive("emitter", "E")],
    limitations: structural,
  },
  {
    id: "nmos",
    label: "N-channel MOSFET",
    description: "N-channel enhancement MOSFET",
    category: "semiconductor",
    referencePrefix: "Q",
    defaultValue: "2N7000",
    requiresValue: true,
    symbol: "transistor_mos_n",
    pins: [passive("gate", "G"), passive("drain", "D"), passive("source", "S")],
    limitations: structural,
  },
  {
    id: "pmos",
    label: "P-channel MOSFET",
    description: "P-channel enhancement MOSFET",
    category: "semiconductor",
    referencePrefix: "Q",
    defaultValue: "BS250",
    requiresValue: true,
    symbol: "transistor_mos_p",
    pins: [passive("gate", "G"), passive("drain", "D"), passive("source", "S")],
    limitations: structural,
  },
  {
    id: "switch",
    label: "SPST switch",
    description: "Single-pole single-throw switch",
    category: "switching",
    referencePrefix: "SW",
    defaultValue: "SPST",
    requiresValue: true,
    symbol: "switch_spst",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "switch_spdt",
    label: "SPDT switch",
    description: "Single-pole double-throw switch",
    category: "switching",
    referencePrefix: "SW",
    defaultValue: "SPDT",
    requiresValue: true,
    symbol: "switch_spdt",
    pins: [passive("common", "COM"), passive("throw_a", "A"), passive("throw_b", "B")],
    limitations: structural,
  },
  {
    id: "pushbutton_no",
    label: "Pushbutton (NO)",
    description: "Momentary normally-open pushbutton",
    category: "switching",
    referencePrefix: "SW",
    defaultValue: "NO",
    requiresValue: true,
    symbol: "pushbutton_no",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "pushbutton_nc",
    label: "Pushbutton (NC)",
    description: "Momentary normally-closed pushbutton",
    category: "switching",
    referencePrefix: "SW",
    defaultValue: "NC",
    requiresValue: true,
    symbol: "pushbutton_nc",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "relay",
    label: "Relay",
    description: "Electromechanical SPDT relay",
    category: "electromechanical",
    referencePrefix: "K",
    defaultValue: "5 V SPDT",
    requiresValue: true,
    symbol: "relay",
    pins: [
      passive("coil_a", "A1"),
      passive("coil_b", "A2"),
      passive("common", "COM"),
      passive("normally_closed", "NC"),
      passive("normally_open", "NO"),
    ],
    limitations: structural,
  },
  {
    id: "fuse",
    label: "Fuse",
    description: "Overcurrent fuse",
    category: "switching",
    referencePrefix: "F",
    defaultValue: "500 mA",
    requiresValue: true,
    symbol: "fuse",
    pins: twoPin,
    limitations: `${structural} A drawn fuse does not establish interrupt rating or suitability.`,
  },
  {
    id: "lamp",
    label: "Lamp",
    description: "Indicator or incandescent lamp",
    category: "electromechanical",
    referencePrefix: "LA",
    defaultValue: "lamp",
    requiresValue: true,
    symbol: "lamp",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "motor",
    label: "DC motor",
    description: "Two-terminal DC motor",
    category: "electromechanical",
    referencePrefix: "M",
    defaultValue: "DC motor",
    requiresValue: true,
    symbol: "motor",
    pins: [passive("positive", "+"), passive("negative", "−")],
    limitations: structural,
  },
  {
    id: "buzzer",
    label: "Buzzer",
    description: "Two-terminal buzzer",
    category: "electromechanical",
    referencePrefix: "BZ",
    defaultValue: "active buzzer",
    requiresValue: true,
    symbol: "buzzer",
    pins: [passive("positive", "+"), passive("negative", "−")],
    limitations: structural,
  },
  {
    id: "speaker",
    label: "Speaker",
    description: "Two-terminal loudspeaker",
    category: "electromechanical",
    referencePrefix: "LS",
    defaultValue: "8 Ω",
    requiresValue: true,
    symbol: "speaker",
    pins: twoPin,
    limitations: structural,
  },
  {
    id: "ground",
    label: "Ground",
    description: "Ground reference symbol",
    category: "power",
    referencePrefix: "GND",
    requiresValue: false,
    symbol: "ground",
    pins: [powerIn("ground", "GND")],
    limitations: structural,
  },
  {
    id: "vcc",
    label: "Power port",
    description: "Named positive supply port",
    category: "power",
    referencePrefix: "PWR",
    defaultValue: "VCC",
    requiresValue: true,
    symbol: "power_port",
    pins: [powerOut("power", "VCC")],
    limitations: structural,
  },
  {
    id: "test_point",
    label: "Test point",
    description: "Named measurement point",
    category: "connector",
    referencePrefix: "TP",
    defaultValue: "test point",
    requiresValue: true,
    symbol: "test_point",
    pins: [passive("probe", "TP")],
    limitations: structural,
  },
  {
    id: "connector_2",
    label: "2-pin connector",
    description: "Generic two-position connector",
    category: "connector",
    referencePrefix: "J",
    defaultValue: "2-pin",
    requiresValue: true,
    symbol: "connector",
    pins: [passive("1", "1"), passive("2", "2")],
    limitations: structural,
  },
  {
    id: "connector_3",
    label: "3-pin connector",
    description: "Generic three-position connector",
    category: "connector",
    referencePrefix: "J",
    defaultValue: "3-pin",
    requiresValue: true,
    symbol: "connector",
    pins: [passive("1", "1"), passive("2", "2"), passive("3", "3")],
    limitations: structural,
  },
  {
    id: "connector_4",
    label: "4-pin connector",
    description: "Generic four-position connector",
    category: "connector",
    referencePrefix: "J",
    defaultValue: "4-pin",
    requiresValue: true,
    symbol: "connector",
    pins: [passive("1", "1"), passive("2", "2"), passive("3", "3"), passive("4", "4")],
    limitations: structural,
  },
  {
    id: "op_amp",
    label: "Operational amplifier",
    description: "Generic single op-amp symbol",
    category: "logic",
    referencePrefix: "U",
    defaultValue: "op amp",
    requiresValue: true,
    symbol: "op_amp",
    pins: [
      passive("non_inverting", "+"),
      passive("inverting", "−"),
      passive("output", "OUT"),
      powerIn("positive_supply", "V+"),
      powerIn("negative_supply", "V−"),
    ],
    limitations: `${structural} No gain, saturation, common-mode, stability, or supply behavior is modeled.`,
  },
  {
    id: "comparator",
    label: "Comparator",
    description: "Generic single comparator symbol",
    category: "logic",
    referencePrefix: "U",
    defaultValue: "comparator",
    requiresValue: true,
    symbol: "comparator",
    pins: [
      passive("non_inverting", "+"),
      passive("inverting", "−"),
      passive("output", "OUT"),
      powerIn("positive_supply", "V+"),
      powerIn("negative_supply", "V−"),
    ],
    limitations: `${structural} No thresholds, hysteresis, output stage, or supply behavior is modeled.`,
  },
  {
    id: "logic_inverter",
    label: "Logic inverter",
    description: "Generic inverting logic gate",
    category: "logic",
    referencePrefix: "U",
    defaultValue: "inverter",
    requiresValue: true,
    symbol: "logic_inverter",
    pins: [
      passive("input", "IN"),
      passive("output", "OUT"),
      powerIn("vcc", "VCC"),
      powerIn("gnd", "GND"),
    ],
    limitations: `${structural} No voltage thresholds, propagation delay, or drive behavior is modeled.`,
  },
  {
    id: "esp32s3_devkitc_1",
    label: "ESP32-S3-DevKitC-1 v1.1",
    description: "Espressif ESP32-S3 development board with two 22-pin headers",
    category: "controller",
    referencePrefix: "MCU",
    defaultValue: "ESP32-S3-DevKitC-1 v1.1",
    requiresValue: true,
    symbol: "development_board",
    pins: [
      powerIn("3V3_J1_1", "3V3"),
      powerIn("3V3_J1_2", "3V3"),
      passive("EN", "EN/RST"),
      passive("GPIO4", "GPIO4"),
      passive("GPIO5", "GPIO5"),
      passive("GPIO6", "GPIO6"),
      passive("GPIO7", "GPIO7"),
      passive("GPIO15", "GPIO15"),
      passive("GPIO16", "GPIO16"),
      passive("GPIO17", "GPIO17"),
      passive("GPIO18", "GPIO18"),
      passive("GPIO8", "GPIO8"),
      passive("GPIO3", "GPIO3"),
      passive("GPIO46", "GPIO46"),
      passive("GPIO9", "GPIO9"),
      passive("GPIO10", "GPIO10"),
      passive("GPIO11", "GPIO11"),
      passive("GPIO12", "GPIO12"),
      passive("GPIO13", "GPIO13"),
      passive("GPIO14", "GPIO14"),
      powerIn("5V_J1_21", "5V"),
      powerIn("GND_J1_22", "GND"),
      powerIn("GND_J3_1", "GND"),
      passive("GPIO43", "GPIO43/TX"),
      passive("GPIO44", "GPIO44/RX"),
      passive("GPIO1", "GPIO1"),
      passive("GPIO2", "GPIO2"),
      passive("GPIO42", "GPIO42"),
      passive("GPIO41", "GPIO41"),
      passive("GPIO40", "GPIO40"),
      passive("GPIO39", "GPIO39"),
      passive("GPIO38", "GPIO38/RGB"),
      passive("GPIO37", "GPIO37"),
      passive("GPIO36", "GPIO36"),
      passive("GPIO35", "GPIO35"),
      passive("GPIO0", "GPIO0/BOOT"),
      passive("GPIO45", "GPIO45"),
      passive("GPIO48", "GPIO48"),
      passive("GPIO47", "GPIO47"),
      passive("GPIO21", "GPIO21"),
      passive("GPIO20", "GPIO20/USB D+"),
      passive("GPIO19", "GPIO19/USB D−"),
      powerIn("GND_J3_21", "GND"),
      powerIn("GND_J3_22", "GND"),
    ],
    limitations:
      "Structural ESP32-S3-DevKitC-1 v1.1 header symbol only. Verify the exact board/module revision before wiring: GPIO35–GPIO37 are unavailable on octal flash/PSRAM variants, GPIO38 drives the v1.1 onboard RGB LED, GPIO0/GPIO3/GPIO45/GPIO46 are strapping pins, and all GPIO is 3.3 V logic. The pinned QEMU GPIO device is unsupported, so firmware execution cannot validate external GPIO wiring or electrical behavior.",
    sourceUrl:
      "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html#header-block",
  },
  {
    id: "ic",
    label: "Built-in IC",
    description: "One of the ten reviewed built-in IC models",
    category: "logic",
    referencePrefix: "U",
    defaultValue: "IC",
    requiresValue: true,
    symbol: "ic",
    pins: [],
    limitations:
      "Pin map and bounded functional behavior come from the selected built-in model; electrical physics remain omitted.",
  },
];

const catalogById = new Map(COMPONENT_CATALOG.map((entry) => [entry.id, entry]));

export function getComponentCatalogEntry(kind: PartKind): ComponentCatalogEntry {
  const entry = catalogById.get(kind);
  if (!entry) {
    throw new Error(`Unknown component catalog kind ${kind}.`);
  }
  return entry;
}

export function isPowerSourceKind(kind: PartKind): boolean {
  return kind === "dc_source" || kind === "battery" || kind === "ac_source";
}
