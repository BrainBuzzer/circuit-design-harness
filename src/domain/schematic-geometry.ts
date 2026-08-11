import type {
  CircuitComponent,
  CircuitDocument,
  CircuitPoint,
  SchematicPlacement,
} from "./circuit";
import { getComponentCatalogEntry, type SymbolFamily } from "./component-catalog";

export type SchematicPrimitive =
  | {
      readonly type: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly role: PrimitiveRole;
    }
  | {
      readonly type: "path";
      readonly d: string;
      readonly role: PrimitiveRole;
      readonly fill?: boolean;
    }
  | {
      readonly type: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly role: PrimitiveRole;
      readonly fill?: boolean;
    }
  | {
      readonly type: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
      readonly role: PrimitiveRole;
      readonly fill?: boolean;
    }
  | {
      readonly type: "polygon";
      readonly points: readonly CircuitPoint[];
      readonly role: PrimitiveRole;
      readonly fill?: boolean;
    }
  | {
      readonly type: "text";
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly role: "reference" | "value" | "pin_label" | "net_label";
      readonly anchor?: "start" | "middle" | "end";
    };

export type PrimitiveRole = "symbol" | "wire" | "junction" | "accent" | "selection";

export interface SchematicComponentGeometry {
  readonly component: CircuitComponent;
  readonly placement: SchematicPlacement;
  readonly primitives: readonly SchematicPrimitive[];
  readonly localPins: Readonly<Record<string, CircuitPoint>>;
}

export interface SchematicScene {
  readonly components: readonly SchematicComponentGeometry[];
  readonly wires: readonly SchematicPrimitive[];
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

const LEAD = 50;

export function buildSchematicScene(document: CircuitDocument): SchematicScene {
  const placementById = new Map(
    document.schematic.placements.map((placement) => [placement.componentId, placement]),
  );
  const components = document.components.flatMap((component) => {
    const placement = placementById.get(component.id);
    return placement ? [buildComponentGeometry(component, placement)] : [];
  });
  const geometryById = new Map(components.map((geometry) => [geometry.component.id, geometry]));
  const wires: SchematicPrimitive[] = [];

  for (const net of document.nets) {
    const points = net.terminals.flatMap((terminal) => {
      const geometry = geometryById.get(terminal.componentId);
      const local = geometry?.localPins[terminal.pinId];
      return geometry && local ? [rotateAndTranslate(local, geometry.placement)] : [];
    });
    const first = points[0];
    if (!first) {
      continue;
    }
    for (const point of points.slice(1)) {
      const middleX = snap((first.x + point.x) / 2, 10);
      wires.push({
        type: "path",
        d: `M ${n(first.x)} ${n(first.y)} H ${n(middleX)} V ${n(point.y)} H ${n(point.x)}`,
        role: "wire",
      });
    }
    if (points.length > 2) {
      wires.push({
        type: "circle",
        cx: first.x,
        cy: first.y,
        r: 3.5,
        role: "junction",
        fill: true,
      });
    }
    if (net.name && points.length > 0) {
      wires.push({
        type: "text",
        x: first.x + 8,
        y: first.y - 8,
        text: net.name,
        role: "net_label",
        anchor: "start",
      });
    }
  }

  const positioned = components.flatMap((geometry) =>
    geometry.primitives.flatMap((primitive) => primitivePoints(primitive, geometry.placement)),
  );
  const wirePoints = wires.flatMap((primitive) => primitivePoints(primitive));
  const allPoints = [...positioned, ...wirePoints];
  const minX = Math.min(0, ...allPoints.map((point) => point.x));
  const minY = Math.min(0, ...allPoints.map((point) => point.y));
  const maxX = Math.max(600, ...allPoints.map((point) => point.x));
  const maxY = Math.max(380, ...allPoints.map((point) => point.y));
  return {
    components,
    wires,
    bounds: { x: minX - 70, y: minY - 70, width: maxX - minX + 140, height: maxY - minY + 140 },
  };
}

export function buildComponentGeometry(
  component: CircuitComponent,
  placement: SchematicPlacement,
): SchematicComponentGeometry {
  const symbol = getComponentCatalogEntry(component.kind).symbol;
  const localPins = localPinPositions(component, symbol);
  const body = symbolPrimitives(symbol, component, localPins);
  const labelY = labelPosition(symbol, component);
  const primitives: SchematicPrimitive[] = [
    ...body,
    {
      type: "text",
      x: 0,
      y: labelY.reference,
      text: component.reference,
      role: "reference",
      anchor: "middle",
    },
    ...(component.value
      ? [
          {
            type: "text" as const,
            x: 0,
            y: labelY.value,
            text: component.value,
            role: "value" as const,
            anchor: "middle" as const,
          },
        ]
      : []),
  ];
  if (component.pins.length > 2 || symbol === "ic" || symbol === "development_board") {
    for (const pin of component.pins) {
      const point = localPins[pin.id];
      if (!point) continue;
      primitives.push({
        type: "text",
        x: point.x < 0 ? point.x + 7 : point.x > 0 ? point.x - 7 : point.x + 7,
        y: point.y - 5,
        text: pin.name,
        role: "pin_label",
        anchor: point.x < 0 ? "start" : point.x > 0 ? "end" : "start",
      });
    }
  }
  return { component, placement, primitives, localPins };
}

export function pinPosition(
  component: CircuitComponent,
  placement: SchematicPlacement,
  pinId: string,
): CircuitPoint {
  const symbol = getComponentCatalogEntry(component.kind).symbol;
  const local = localPinPositions(component, symbol)[pinId] ?? { x: 0, y: 0 };
  return rotateAndTranslate(local, placement);
}

function localPinPositions(
  component: CircuitComponent,
  symbol: SymbolFamily,
): Readonly<Record<string, CircuitPoint>> {
  const pins = component.pins;
  if (symbol === "ground") return { [pins[0]?.id ?? "ground"]: { x: 0, y: -30 } };
  if (symbol === "power_port") return { [pins[0]?.id ?? "power"]: { x: 0, y: 30 } };
  if (symbol === "test_point") return { [pins[0]?.id ?? "probe"]: { x: 0, y: 30 } };
  if (symbol === "transformer")
    return mapPins(pins, [
      { x: -50, y: -22 },
      { x: -50, y: 22 },
      { x: 50, y: -22 },
      { x: 50, y: 22 },
    ]);
  if (symbol === "bridge_rectifier")
    return mapPins(pins, [
      { x: -50, y: 0 },
      { x: 0, y: -50 },
      { x: 50, y: 0 },
      { x: 0, y: 50 },
    ]);
  if (symbol === "relay")
    return mapPins(pins, [
      { x: -60, y: -24 },
      { x: -60, y: 24 },
      { x: 60, y: 0 },
      { x: 60, y: -28 },
      { x: 60, y: 28 },
    ]);
  if (symbol === "switch_spdt")
    return mapPins(pins, [
      { x: -50, y: 0 },
      { x: 50, y: -20 },
      { x: 50, y: 20 },
    ]);
  if (symbol === "resistor_adjustable")
    return mapPins(pins, [
      { x: -50, y: 0 },
      { x: 0, y: -50 },
      { x: 50, y: 0 },
    ]);
  if (
    ["transistor_bjt_npn", "transistor_bjt_pnp", "transistor_mos_n", "transistor_mos_p"].includes(
      symbol,
    )
  ) {
    return mapPins(pins, [
      { x: -50, y: 0 },
      { x: 32, y: -46 },
      { x: 32, y: 46 },
    ]);
  }
  if (symbol === "op_amp" || symbol === "comparator") {
    return mapPins(pins, [
      { x: -50, y: -16 },
      { x: -50, y: 16 },
      { x: 50, y: 0 },
      { x: 0, y: -50 },
      { x: 0, y: 50 },
    ]);
  }
  if (symbol === "logic_inverter") {
    return mapPins(pins, [
      { x: -50, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: -44 },
      { x: 0, y: 44 },
    ]);
  }
  if (symbol === "connector") {
    const span = Math.max(0, (pins.length - 1) * 18);
    return Object.fromEntries(
      pins.map((pin, index) => [pin.id, { x: -50, y: index * 18 - span / 2 }]),
    );
  }
  if (symbol === "development_board") {
    const half = Math.ceil(pins.length / 2);
    const rowGap = 16;
    return Object.fromEntries(
      pins.map((pin, index) => {
        const left = index < half;
        const row = left ? index : index - half;
        return [pin.id, { x: left ? -90 : 90, y: (row - (half - 1) / 2) * rowGap }];
      }),
    );
  }
  if (symbol === "ic") {
    const half = Math.ceil(pins.length / 2);
    const rowGap = 16;
    return Object.fromEntries(
      pins.map((pin, index) => {
        const left = index < half;
        const row = left ? index : pins.length - 1 - index;
        return [pin.id, { x: left ? -60 : 60, y: (row - (half - 1) / 2) * rowGap }];
      }),
    );
  }
  return mapPins(pins, [
    { x: -LEAD, y: 0 },
    { x: LEAD, y: 0 },
  ]);
}

function symbolPrimitives(
  symbol: SymbolFamily,
  _component: CircuitComponent,
  pins: Readonly<Record<string, CircuitPoint>>,
): readonly SchematicPrimitive[] {
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    role: PrimitiveRole = "symbol",
  ): SchematicPrimitive => ({ type: "line", x1, y1, x2, y2, role });
  const path = (d: string, role: PrimitiveRole = "symbol", fill = false): SchematicPrimitive => ({
    type: "path",
    d,
    role,
    ...(fill ? { fill: true } : {}),
  });
  const circle = (
    cx: number,
    cy: number,
    r: number,
    role: PrimitiveRole = "symbol",
    fill = false,
  ): SchematicPrimitive => ({ type: "circle", cx, cy, r, role, ...(fill ? { fill: true } : {}) });
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
    role: PrimitiveRole = "symbol",
    fill = false,
    rx?: number,
  ): SchematicPrimitive => ({
    type: "rect",
    x,
    y,
    width,
    height,
    role,
    ...(fill ? { fill: true } : {}),
    ...(rx === undefined ? {} : { rx }),
  });
  const polygon = (
    points: readonly CircuitPoint[],
    role: PrimitiveRole = "symbol",
    fill = false,
  ): SchematicPrimitive => ({ type: "polygon", points, role, ...(fill ? { fill: true } : {}) });
  const leads = [line(-50, 0, -30, 0), line(30, 0, 50, 0)];
  const arrow = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    inward = false,
  ): readonly SchematicPrimitive[] => {
    const direction = inward ? -1 : 1;
    return [
      line(x, y, x + dx * direction, y + dy * direction, "accent"),
      polygon(
        [
          { x: x + dx * direction, y: y + dy * direction },
          { x: x + dx * direction - 7, y: y + dy * direction + 1 },
          { x: x + dx * direction - 1, y: y + dy * direction - 7 },
        ],
        "accent",
        true,
      ),
    ];
  };

  switch (symbol) {
    case "resistor":
    case "resistor_sensor":
      return [
        ...leads,
        path("M -30 0 L -24 -13 L -14 13 L -4 -13 L 6 13 L 16 -13 L 26 13 L 30 0"),
        ...(symbol === "resistor_sensor" ? [line(-8, 26, 16, -26, "accent")] : []),
      ];
    case "resistor_adjustable":
      return [
        ...leads,
        path("M -30 0 L -24 -13 L -14 13 L -4 -13 L 6 13 L 16 -13 L 26 13 L 30 0"),
        line(0, -50, 0, -27),
        polygon(
          [
            { x: 0, y: -20 },
            { x: -5, y: -29 },
            { x: 5, y: -29 },
          ],
          "accent",
          true,
        ),
      ];
    case "capacitor":
    case "capacitor_polarized":
    case "capacitor_variable":
      return [
        line(-50, 0, -8, 0),
        line(8, 0, 50, 0),
        line(-8, -25, -8, 25),
        ...(symbol === "capacitor_polarized"
          ? [
              path("M 8 -25 Q 18 0 8 25"),
              {
                type: "text",
                x: -17,
                y: -25,
                text: "+",
                role: "pin_label",
                anchor: "middle",
              } as const,
            ]
          : [line(8, -25, 8, 25)]),
        ...(symbol === "capacitor_variable"
          ? [
              line(-22, 28, 24, -28, "accent"),
              polygon(
                [
                  { x: 24, y: -28 },
                  { x: 14, y: -27 },
                  { x: 23, y: -18 },
                ],
                "accent",
                true,
              ),
            ]
          : []),
      ];
    case "inductor":
      return [
        ...leads,
        path(
          "M -30 0 C -30 -18 -15 -18 -15 0 C -15 -18 0 -18 0 0 C 0 -18 15 -18 15 0 C 15 -18 30 -18 30 0",
        ),
      ];
    case "transformer":
      return [
        line(-50, -22, -30, -22),
        line(-50, 22, -30, 22),
        path("M -30 -22 C -12 -22 -12 -8 -30 -8 C -12 -8 -12 8 -30 8 C -12 8 -12 22 -30 22"),
        line(-5, -34, -5, 34),
        line(5, -34, 5, 34),
        path("M 30 -22 C 12 -22 12 -8 30 -8 C 12 -8 12 8 30 8 C 12 8 12 22 30 22"),
        line(30, -22, 50, -22),
        line(30, 22, 50, 22),
      ];
    case "crystal":
      return [...leads, line(-30, -22, -30, 22), rect(-18, -26, 36, 52), line(30, -22, 30, 22)];
    case "source_dc":
    case "source_ac":
      return [
        line(-50, 0, -34, 0),
        circle(0, 0, 34),
        line(34, 0, 50, 0),
        ...(symbol === "source_dc"
          ? [line(-16, -8, -4, -8), line(-10, -14, -10, -2), line(6, 10, 18, 10)]
          : [path("M -20 0 C -10 -18 0 -18 0 0 C 0 18 10 18 20 0")]),
      ];
    case "battery":
      return [
        line(-50, 0, -12, 0),
        line(-12, -24, -12, 24),
        line(10, -14, 10, 14),
        line(10, 0, 50, 0),
      ];
    case "diode":
    case "diode_zener":
    case "diode_schottky":
    case "diode_led":
    case "diode_photo": {
      const cathode =
        symbol === "diode_zener"
          ? path("M 14 -20 L 8 -15 V 15 L 2 20")
          : symbol === "diode_schottky"
            ? path("M 8 -20 H 15 V -12 M 8 -15 V 15 M 8 20 H 1 V 12")
            : line(8, -20, 8, 20);
      const light =
        symbol === "diode_led"
          ? [...arrow(16, -20, 17, -17), ...arrow(28, -10, 17, -17)]
          : symbol === "diode_photo"
            ? [...arrow(45, -35, 17, 17, true), ...arrow(34, -45, 17, 17, true)]
            : [];
      return [
        line(-50, 0, -20, 0),
        polygon([
          { x: -20, y: -22 },
          { x: -20, y: 22 },
          { x: 8, y: 0 },
        ]),
        cathode,
        line(8, 0, 50, 0),
        ...light,
      ];
    }
    case "bridge_rectifier":
      return [
        polygon([
          { x: 0, y: -36 },
          { x: 36, y: 0 },
          { x: 0, y: 36 },
          { x: -36, y: 0 },
        ]),
        line(-50, 0, -36, 0),
        line(0, -50, 0, -36),
        line(36, 0, 50, 0),
        line(0, 36, 0, 50),
        { type: "text", x: 0, y: -18, text: "+", role: "pin_label", anchor: "middle" },
        { type: "text", x: 0, y: 24, text: "−", role: "pin_label", anchor: "middle" },
      ];
    case "switch_spst":
    case "pushbutton_no":
    case "pushbutton_nc":
      return [
        line(-50, 0, -24, 0),
        circle(-20, 0, 3, "junction", true),
        circle(20, 0, 3, "junction", true),
        line(24, 0, 50, 0),
        line(-18, 0, 18, symbol === "pushbutton_nc" ? 0 : -20),
        ...(symbol.startsWith("pushbutton") ? [line(-4, -30, 16, -30), line(6, -30, 6, -15)] : []),
      ];
    case "switch_spdt":
      return [
        line(-50, 0, -22, 0),
        circle(-20, 0, 3, "junction", true),
        circle(20, -20, 3, "junction", true),
        circle(20, 20, 3, "junction", true),
        line(24, -20, 50, -20),
        line(24, 20, 50, 20),
        line(-18, 0, 17, -18),
      ];
    case "relay":
      return [
        line(-60, -24, -40, -24),
        line(-60, 24, -40, 24),
        rect(-40, -34, 34, 68, "symbol", false, 4),
        path("M -34 24 C -34 10 -12 10 -12 -2 C -12 -14 -34 -14 -34 -24"),
        line(4, -40, 4, 40, "accent"),
        line(14, 0, 36, -22),
        circle(12, 0, 3, "junction", true),
        circle(38, -28, 3, "junction", true),
        circle(38, 28, 3, "junction", true),
        line(12, 0, 60, 0),
        line(42, -28, 60, -28),
        line(42, 28, 60, 28),
      ];
    case "fuse":
      return [
        line(-50, 0, -28, 0),
        rect(-28, -12, 56, 24, "symbol", false, 3),
        path("M -24 0 C -12 -10 12 10 24 0"),
        line(28, 0, 50, 0),
      ];
    case "lamp":
      return [...leads, circle(0, 0, 28), line(-20, -20, 20, 20), line(-20, 20, 20, -20)];
    case "motor":
      return [
        ...leads,
        circle(0, 0, 30),
        { type: "text", x: 0, y: 7, text: "M", role: "reference", anchor: "middle" },
      ];
    case "buzzer":
      return [
        ...leads,
        path("M -28 -20 V 20 L 8 12 V -12 Z"),
        path("M 15 -12 Q 28 0 15 12", "accent"),
      ];
    case "speaker":
      return [
        ...leads,
        rect(-28, -14, 10, 28),
        polygon([
          { x: -18, y: -14 },
          { x: 12, y: -30 },
          { x: 12, y: 30 },
          { x: -18, y: 14 },
        ]),
      ];
    case "ground":
      return [line(0, -30, 0, 0), line(-22, 0, 22, 0), line(-14, 8, 14, 8), line(-7, 16, 7, 16)];
    case "power_port":
      return [
        line(0, 30, 0, 0),
        polygon(
          [
            { x: 0, y: -16 },
            { x: -8, y: 0 },
            { x: 8, y: 0 },
          ],
          "symbol",
          true,
        ),
      ];
    case "test_point":
      return [line(0, 30, 0, 8), circle(0, 0, 8)];
    case "connector": {
      const points = Object.values(pins);
      const minY = Math.min(...points.map((point) => point.y)) - 10;
      const maxY = Math.max(...points.map((point) => point.y)) + 10;
      return [
        rect(-30, minY, 60, maxY - minY, "symbol", false, 3),
        ...points.flatMap((point) => [line(-50, point.y, -30, point.y), circle(-20, point.y, 3)]),
      ];
    }
    case "op_amp":
    case "comparator":
      return [
        line(-50, -16, -32, -16),
        line(-50, 16, -32, 16),
        line(32, 0, 50, 0),
        line(0, -50, 0, -32),
        line(0, 32, 0, 50),
        polygon(
          [
            { x: -32, y: -32 },
            { x: -32, y: 32 },
            { x: 32, y: 0 },
          ],
          "symbol",
          true,
        ),
        { type: "text", x: -22, y: -11, text: "+", role: "pin_label", anchor: "middle" },
        { type: "text", x: -22, y: 22, text: "−", role: "pin_label", anchor: "middle" },
      ];
    case "logic_inverter":
      return [
        line(-50, 0, -30, 0),
        polygon(
          [
            { x: -30, y: -28 },
            { x: -30, y: 28 },
            { x: 25, y: 0 },
          ],
          "symbol",
          true,
        ),
        circle(31, 0, 6),
        line(37, 0, 50, 0),
        line(0, -44, 0, -24),
        line(0, 24, 0, 44),
      ];
    case "development_board": {
      const pinPoints = Object.values(pins);
      const halfHeight = Math.max(
        54,
        Math.max(...pinPoints.map((point) => Math.abs(point.y))) + 12,
      );
      return [
        rect(-70, -halfHeight, 140, halfHeight * 2, "symbol", true, 8),
        ...pinPoints.map((point) => line(point.x, point.y, point.x < 0 ? -70 : 70, point.y)),
        {
          type: "text",
          x: 0,
          y: 5,
          text: "ESP32-S3",
          role: "pin_label",
          anchor: "middle",
        },
      ];
    }
    case "transistor_bjt_npn":
    case "transistor_bjt_pnp":
    case "transistor_mos_n":
    case "transistor_mos_p": {
      const bjt = symbol.includes("bjt");
      return [
        line(-50, 0, -14, 0),
        line(-14, -24, -14, 24),
        line(-14, -14, 20, -38),
        line(20, -38, 32, -46),
        line(-14, 14, 20, 38),
        line(20, 38, 32, 46),
        ...(bjt
          ? [circle(0, 0, 36)]
          : [line(-5, -24, -5, 24), line(2, -18, 2, -6), line(2, 6, 2, 18)]),
        ...(symbol === "transistor_bjt_npn" || symbol === "transistor_mos_n"
          ? [
              polygon(
                [
                  { x: 21, y: 38 },
                  { x: 10, y: 33 },
                  { x: 16, y: 25 },
                ],
                "accent",
                true,
              ),
            ]
          : [
              polygon(
                [
                  { x: 3, y: 14 },
                  { x: 14, y: 19 },
                  { x: 8, y: 27 },
                ],
                "accent",
                true,
              ),
            ]),
      ];
    }
    case "ic": {
      const pinPoints = Object.values(pins);
      const halfHeight = Math.max(
        38,
        Math.max(...pinPoints.map((point) => Math.abs(point.y))) + 12,
      );
      return [
        rect(-44, -halfHeight, 88, halfHeight * 2, "symbol", true, 2),
        ...pinPoints.map((point) => line(point.x, point.y, point.x < 0 ? -44 : 44, point.y)),
      ];
    }
  }
}

function labelPosition(
  symbol: SymbolFamily,
  component: CircuitComponent,
): { reference: number; value: number } {
  if (symbol === "ground") return { reference: 38, value: 52 };
  if (symbol === "power_port") return { reference: -32, value: -18 };
  if (symbol === "ic" || symbol === "development_board") {
    const half = Math.ceil(component.pins.length / 2);
    const height = Math.max(38, ((half - 1) * 16) / 2 + 12);
    return { reference: -height - 15, value: height + 20 };
  }
  return { reference: -42, value: 48 };
}

function mapPins(
  pins: readonly { readonly id: string }[],
  points: readonly CircuitPoint[],
): Readonly<Record<string, CircuitPoint>> {
  return Object.fromEntries(pins.map((pin, index) => [pin.id, points[index] ?? { x: 0, y: 0 }]));
}

function rotateAndTranslate(point: CircuitPoint, placement: SchematicPlacement): CircuitPoint {
  const radians = (placement.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: placement.position.x + point.x * cosine - point.y * sine,
    y: placement.position.y + point.x * sine + point.y * cosine,
  };
}

function primitivePoints(
  primitive: SchematicPrimitive,
  placement?: SchematicPlacement,
): readonly CircuitPoint[] {
  const points = (() => {
    switch (primitive.type) {
      case "line":
        return [
          { x: primitive.x1, y: primitive.y1 },
          { x: primitive.x2, y: primitive.y2 },
        ];
      case "circle":
        return [
          { x: primitive.cx - primitive.r, y: primitive.cy - primitive.r },
          { x: primitive.cx + primitive.r, y: primitive.cy + primitive.r },
        ];
      case "rect":
        return [
          { x: primitive.x, y: primitive.y },
          { x: primitive.x + primitive.width, y: primitive.y + primitive.height },
        ];
      case "polygon":
        return primitive.points;
      case "text":
        return [{ x: primitive.x, y: primitive.y }];
      case "path":
        return [];
    }
  })();
  return placement ? points.map((point) => rotateAndTranslate(point, placement)) : points;
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function n(value: number): string {
  return Number(value.toFixed(3)).toString();
}
