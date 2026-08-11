import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { type ElectronApplication, expect, type Page, test } from "playwright/test";
import { CircuitDocumentSchema } from "../../src/domain/circuit";
import { ProjectManifestSchema } from "../../src/domain/project";

test("creates and restores an isolated project through the sandboxed desktop UI", async () => {
  const testInfo = test.info();
  const testRoot = await mkdtemp(path.join(tmpdir(), "circuit-harness-e2e-"));
  const userDataPath = path.join(testRoot, "user-data");
  const projectRoot = path.join(testRoot, "projects");
  const piAgentDirectory = path.join(testRoot, "pi-agent");
  const rendererErrors: string[] = [];
  let application: ElectronApplication | undefined;
  let remoteCameraServer: Server | undefined;
  let portableArchivePath = "";

  const launch = async (): Promise<{ app: ElectronApplication; page: Page }> => {
    const environment = processEnvironment();
    environment.CIRCUIT_HARNESS_PROJECT_ROOT = projectRoot;
    environment.PI_CODING_AGENT_DIR = piAgentDirectory;
    delete environment.ELECTRON_RENDERER_URL;

    const app = await electron.launch({
      args: [
        ".",
        `--user-data-dir=${userDataPath}`,
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      cwd: path.resolve(import.meta.dirname, "../.."),
      env: environment,
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        rendererErrors.push(message.text());
      }
    });
    return { app, page };
  };

  try {
    ({ app: application } = await launch());
    let page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
    });

    await expect(page).toHaveTitle("Circuit Design Harness");
    await expect(page.getByText("No circuit project selected")).toBeVisible();
    await page.getByRole("button", { name: "New circuit project" }).click();
    await expect(page.getByText("Untitled Circuit", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Project active")).toBeVisible();
    await expect(
      page.getByText(/0 authenticated provider\(s\), 0 available model\(s\)/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Enable spoken replies" }).click();
    await expect(page.getByRole("button", { name: "Disable spoken replies" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Disable spoken replies" }).click();
    await page.getByRole("button", { name: "Spoken reply settings" }).click();
    const speechDialog = page.getByRole("dialog");
    await expect(
      speechDialog.getByRole("heading", { name: "Spoken reply settings" }),
    ).toBeVisible();
    await expect(speechDialog.getByLabel("Voice")).toBeVisible();
    await speechDialog.getByLabel(/Rate/).fill("1.2");
    await speechDialog.getByLabel(/Volume/).fill("0.8");
    await expect(speechDialog.getByText("Rate · 1.2×")).toBeVisible();
    await expect(speechDialog.getByText("Volume · 80%")).toBeVisible();
    await expect(speechDialog.getByRole("button", { name: "Replay latest reply" })).toBeDisabled();
    await speechDialog.getByRole("button", { name: "Close" }).click();
    const seededProjectNames = await readdir(projectRoot);
    const seededProjectDirectory = path.join(projectRoot, seededProjectNames[0] ?? "missing");
    const seededCircuit = CircuitDocumentSchema.parse(
      JSON.parse(
        await readFile(
          path.resolve(import.meta.dirname, "../fixtures/circuits/led-current-limiter.json"),
          "utf8",
        ),
      ),
    );
    const seededManifest = ProjectManifestSchema.parse(
      JSON.parse(await readFile(path.join(seededProjectDirectory, "project.json"), "utf8")),
    );
    await writeFile(
      path.join(seededProjectDirectory, "circuit.json"),
      `${JSON.stringify(seededCircuit, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(seededProjectDirectory, "project.json"),
      `${JSON.stringify({ ...seededManifest, circuitRevision: seededCircuit.revision }, null, 2)}\n`,
      "utf8",
    );
    const seededAssembly = JSON.parse(
      await readFile(path.join(seededProjectDirectory, "assembly.json"), "utf8"),
    ) as Record<string, unknown>;
    const seededResistor = seededCircuit.components.find(
      (component) => component.reference === "R1",
    );
    if (!seededResistor) {
      throw new Error("The E2E fixture must include R1.");
    }
    await writeFile(
      path.join(seededProjectDirectory, "assembly.json"),
      `${JSON.stringify(
        {
          ...seededAssembly,
          revision: 1,
          circuitRevision: seededCircuit.revision,
          placements: [
            {
              componentId: seededResistor.id,
              pins: [{ pinId: "1", hole: "a1" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await application.close();
    ({ app: application, page } = await launch());
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
    });

    const circuitEditor = page.locator('section[aria-label="AI-managed circuit design"]');
    await expect(circuitEditor.getByRole("heading", { name: "AI schematic" })).toBeVisible();
    await expect(circuitEditor.getByText("Review only")).toBeVisible();
    await circuitEditor.getByRole("button", { name: "Show AI component catalog" }).click();
    await expect(circuitEditor.getByText("Agent component catalog")).toBeVisible();
    await expect(circuitEditor.getByText("Relay", { exact: true })).toBeVisible();
    await expect(circuitEditor.getByText("ESP32-S3-DevKitC-1 v1.1", { exact: true })).toBeVisible();
    await circuitEditor.getByRole("button", { name: "Show AI component catalog" }).click();
    await circuitEditor.getByRole("button", { name: "R1, Resistor" }).click();
    await expect(
      circuitEditor.getByLabel("Schematic inspector").getByText("330 Ω", { exact: true }),
    ).toBeVisible();
    await expect(
      circuitEditor.getByText("Structural schematic symbol only", { exact: false }),
    ).toBeVisible();
    await circuitEditor.getByRole("button", { name: "Zoom in schematic" }).click();
    await expect(circuitEditor.getByText("90%", { exact: true })).toBeVisible();
    await circuitEditor.getByRole("button", { name: "Zoom out schematic" }).click();
    await expect(circuitEditor.getByText("80%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Breadboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "AI breadboard map" })).toBeVisible();
    await expect(page.getByText(/Ask Pi to place pins or add jumpers/)).toBeVisible();
    await expect(page.getByLabel("a1 occupied by R1.1")).toBeVisible();
    await expect(page.getByText(/Assembly rev 1 · circuit rev 1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Firmware & simulation" })).toHaveCount(0);
    await expect(page.getByText("Pi controls firmware and local simulation")).toBeVisible();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
    });
    const panelGeometry = await page.evaluate(() => {
      const rect = (selector: string): DOMRect => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing layout element: ${selector}`);
        return element.getBoundingClientRect();
      };
      const sidebar = rect('[data-slot="sidebar-container"]');
      const assistant = rect('section[aria-label="Conversation"]');
      const camera = rect('section[aria-label="Camera input"]');
      const design = rect('section[aria-label="AI-managed circuit design"]');
      return {
        sidebar: { left: sidebar.left, right: sidebar.right },
        assistant: {
          left: assistant.left,
          right: assistant.right,
          top: assistant.top,
          bottom: assistant.bottom,
        },
        camera: {
          left: camera.left,
          right: camera.right,
          top: camera.top,
          bottom: camera.bottom,
        },
        design: {
          left: design.left,
          right: design.right,
          top: design.top,
          bottom: design.bottom,
        },
      };
    });
    expect(panelGeometry.sidebar.right).toBeLessThanOrEqual(panelGeometry.assistant.left + 1);
    expect(panelGeometry.assistant.right).toBeLessThan(panelGeometry.camera.left);
    expect(Math.abs(panelGeometry.camera.left - panelGeometry.design.left)).toBeLessThan(2);
    expect(Math.abs(panelGeometry.camera.right - panelGeometry.design.right)).toBeLessThan(2);
    expect(panelGeometry.camera.bottom).toBeLessThan(panelGeometry.design.top);
    expect(Math.abs(panelGeometry.assistant.top - panelGeometry.camera.top)).toBeLessThan(2);
    expect(Math.abs(panelGeometry.assistant.bottom - panelGeometry.design.bottom)).toBeLessThan(2);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    let settingsDialog = page.getByRole("dialog");
    await expect(settingsDialog.getByRole("heading", { name: "Harness settings" })).toBeVisible();
    await expect(settingsDialog.getByText(projectRoot, { exact: true })).toBeVisible();
    const cameraConsent = settingsDialog.getByLabel("Camera capture for visual requests");
    await expect(cameraConsent).toBeChecked();
    await cameraConsent.uncheck();
    await expect(cameraConsent).not.toBeChecked();
    await cameraConsent.check();
    await settingsDialog.getByLabel("Eve’s tone").selectOption("focused");
    await settingsDialog.getByRole("button", { name: "Close" }).first().click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    settingsDialog = page.getByRole("dialog");
    await expect(settingsDialog.getByLabel("Eve’s tone")).toHaveValue("focused");
    await expect(settingsDialog.getByLabel("Enable Eve wake word")).not.toBeChecked();
    await settingsDialog.evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    await page.screenshot({ path: testInfo.outputPath("harness-settings.png") });
    await settingsDialog.getByRole("button", { name: "Close" }).first().click();

    await expect(page.getByRole("button", { name: "Enable Eve wake word" })).toBeVisible();
    await page.getByRole("button", { name: "Phone / LAN" }).click();
    const cameraDialog = page.getByRole("dialog");
    await expect(cameraDialog.getByText("Secure phone relay", { exact: true })).toBeVisible();
    await cameraDialog.getByRole("button", { name: "Create phone pairing code" }).click();
    await expect(
      cameraDialog.getByRole("img", { name: "QR code for pairing a phone build camera" }),
    ).toBeVisible();
    await expect(cameraDialog.getByText(/Certificate fingerprint:/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("secure-phone-relay.png") });
    await cameraDialog.getByRole("button", { name: "Cancel pairing" }).click();
    await cameraDialog.getByRole("button", { name: "Close" }).first().click();
    const attachmentPath = path.join(testRoot, "fixture-datasheet.txt");
    const pdfPath = path.join(testRoot, "fixture-datasheet.pdf");
    await writeFile(attachmentPath, "Absolute maximum supply voltage: 5 V.\n", "utf8");
    await writeFile(pdfPath, createMinimalPdf("Recommended resistor 330 ohm"));
    await application.evaluate(
      ({ dialog }, selectedPaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selectedPaths });
      },
      [attachmentPath, pdfPath],
    );
    await page.getByRole("button", { name: "Attach design files" }).click();
    await expect(
      page.getByRole("button", { name: "fixture-datasheet.txt", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "View fixture-datasheet.pdf" }).click();
    const attachmentViewer = page.getByRole("dialog");
    await expect(
      attachmentViewer.getByRole("heading", { name: "fixture-datasheet.pdf" }),
    ).toBeVisible();
    await expect(
      attachmentViewer.getByRole("img", { name: "fixture-datasheet.pdf page 1" }),
    ).toBeVisible();
    await attachmentViewer.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Re-index fixture-datasheet.txt" }).click();
    await expect(
      page.getByRole("button", { name: "fixture-datasheet.txt", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete fixture-datasheet.txt" }).click();
    const deleteEvidenceDialog = page.getByRole("dialog");
    await expect(
      deleteEvidenceDialog.getByRole("heading", { name: "Move evidence to project trash?" }),
    ).toBeVisible();
    await deleteEvidenceDialog.getByRole("button", { name: "Move to trash" }).click();
    await expect(
      page.getByRole("button", { name: "fixture-datasheet.txt", exact: true }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Deleted evidence" }).click();
    const deletedEvidenceDialog = page.getByRole("dialog");
    await expect(
      deletedEvidenceDialog.getByRole("heading", { name: "Deleted evidence" }),
    ).toBeVisible();
    await expect(deletedEvidenceDialog.getByText("fixture-datasheet.txt")).toBeVisible();
    await deletedEvidenceDialog.getByRole("button", { name: "Restore" }).click();
    await expect(deletedEvidenceDialog.getByText("Project trash is empty.")).toBeVisible();
    await deletedEvidenceDialog.getByRole("button", { name: "Close" }).click();
    await expect(
      page.getByRole("button", { name: "fixture-datasheet.txt", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Choose camera" }).click();
    await expect(page.getByText("Local preview on — not uploading")).toBeVisible();
    await page.getByRole("button", { name: "Take snapshot" }).click();
    await expect(page.getByText("Snapshot frozen — review before saving")).toBeVisible();
    await page.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByText("Saved locally with circuit revision 1")).toBeVisible();
    const captureChip = page.getByRole("button", {
      name: "Camera snapshot 1 from revision 1",
    });
    await expect(captureChip).toHaveAttribute("aria-pressed", "false");
    await captureChip.click();
    await expect(captureChip).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Retake" }).click();
    await page.getByRole("button", { name: "Stop preview" }).click();
    await expect(page.getByRole("button", { name: "Choose camera" })).toBeVisible();

    const earlyProjectDirectories = await readdir(projectRoot);
    const earlyProjectDirectory = path.join(projectRoot, earlyProjectDirectories[0] ?? "missing");
    const localCaptureDirectories = await readdir(path.join(earlyProjectDirectory, "captures"));
    const localCaptureJpeg = await readFile(
      path.join(
        earlyProjectDirectory,
        "captures",
        localCaptureDirectories[0] ?? "missing",
        "capture.jpg",
      ),
    );
    remoteCameraServer = createServer((_, response) => {
      response.writeHead(200, {
        "content-length": localCaptureJpeg.byteLength,
        "content-type": "image/jpeg",
      });
      response.end(localCaptureJpeg);
    });
    await new Promise<void>((resolve, reject) => {
      remoteCameraServer?.once("error", reject);
      remoteCameraServer?.listen(0, "127.0.0.1", resolve);
    });
    const remoteCameraAddress = remoteCameraServer.address();
    if (!remoteCameraAddress || typeof remoteCameraAddress === "string") {
      throw new Error("Expected a remote camera test server address.");
    }
    await page.getByRole("button", { name: "Phone / LAN" }).click();
    const remoteCameraDialog = page.getByRole("dialog");
    await remoteCameraDialog.getByText("Existing JPEG camera endpoint").click();
    await remoteCameraDialog
      .getByLabel("JPEG snapshot URL")
      .fill(`http://127.0.0.1:${remoteCameraAddress.port}/shot.jpg`);
    await remoteCameraDialog.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("Private-LAN preview on — not sent to Pi")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Private-LAN remote camera preview" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Take snapshot" }).click();
    await expect(page.getByText("Remote snapshot frozen — review before saving")).toBeVisible();
    await page.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByText("Saved locally with circuit revision 1")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Camera snapshot 2 from revision 1" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retake" }).click();
    await page.getByRole("button", { name: "Stop preview" }).click();
    await page.getByRole("button", { name: "Export publication package" }).click();
    await expect(page.getByText(/Exported revision 1/)).toBeVisible();
    await page.getByRole("button", { name: "Export portable project archive" }).click();
    const archiveStatus = page.getByText(/Archived \d+ project files/);
    await archiveStatus.scrollIntoViewIfNeeded();
    await expect(archiveStatus).toBeVisible();
    const inspectorToggle = page.getByRole("button", { name: "Toggle schematic inspector" });
    if ((await inspectorToggle.getAttribute("aria-pressed")) === "true") {
      await inspectorToggle.click();
    }
    await page.getByRole("button", { name: "Verify project integrity" }).click();
    const integrityDialog = page.getByRole("dialog");
    await expect(
      integrityDialog.getByRole("heading", { name: "Project integrity verified" }),
    ).toBeVisible();
    await expect(integrityDialog.getByText("No integrity problems were found.")).toBeVisible();
    await integrityDialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(integrityDialog).toBeHidden();
    await expect(archiveStatus).toBeHidden({ timeout: 6_000 });

    await page.screenshot({ path: testInfo.outputPath("project-workbench.png") });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(960, 640);
    });
    await expect(page.getByRole("heading", { name: "Design assistant" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Build camera" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI schematic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose camera" })).toBeVisible();
    const viewportMetrics = await page.evaluate(() => {
      const design = document.querySelector('section[aria-label="AI-managed circuit design"]');
      const exportButton = document.querySelector(
        'button[aria-label="Export publication package"]',
      );
      const catalogButton = document.querySelector(
        'button[aria-label="Show AI component catalog"]',
      );
      if (!design || !exportButton || !catalogButton) {
        throw new Error("Expected required schematic controls at the minimum window size.");
      }
      const designBounds = design.getBoundingClientRect();
      const contained = (element: Element): boolean => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= designBounds.left &&
          bounds.right <= designBounds.right &&
          bounds.top >= designBounds.top &&
          bounds.bottom <= designBounds.bottom
        );
      };
      return {
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        requiredSchematicControlsFit: contained(exportButton) && contained(catalogButton),
      };
    });
    await page.screenshot({ path: testInfo.outputPath("minimum-window.png") });
    expect(viewportMetrics.canScrollX, JSON.stringify(viewportMetrics)).toBe(false);
    expect(viewportMetrics.canScrollY, JSON.stringify(viewportMetrics)).toBe(false);
    expect(viewportMetrics.requiredSchematicControlsFit, JSON.stringify(viewportMetrics)).toBe(
      true,
    );
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
    });

    await page.getByRole("button", { name: "Providers" }).click();
    const providerDialog = page.getByRole("dialog");
    await expect(providerDialog.getByRole("heading", { name: "Pi providers" })).toBeVisible();
    const anthropicCard = providerDialog
      .getByText("Anthropic", { exact: true })
      .locator('xpath=ancestor::*[@data-slot="card"]');
    await anthropicCard.getByRole("button", { name: "API key" }).click();
    await expect(providerDialog.getByLabel("Enter Anthropic API key")).toHaveAttribute(
      "type",
      "password",
    );
    await page.screenshot({ path: testInfo.outputPath("provider-auth-prompt.png") });
    await providerDialog.getByRole("button", { name: "Close" }).last().click();
    await expect(providerDialog).toBeHidden();

    const projectDirectories = await readdir(projectRoot);
    expect(projectDirectories).toHaveLength(1);
    const projectDirectory = path.join(projectRoot, projectDirectories[0] ?? "missing");
    const manifest = ProjectManifestSchema.parse(
      JSON.parse(await readFile(path.join(projectDirectory, "project.json"), "utf8")),
    );
    expect(manifest.title).toBe("Untitled Circuit");
    expect(manifest.circuitRevision).toBe(1);
    expect(await readdir(path.join(projectDirectory, "attachments", "originals"))).toHaveLength(2);
    expect(await readdir(path.join(projectDirectory, "attachments", "extracted"))).toHaveLength(2);
    expect(await readdir(path.join(projectDirectory, "captures"))).toHaveLength(2);
    expect(
      new Set(await readdir(path.join(projectDirectory, "exports", "revision-00000001"))),
    ).toEqual(
      new Set([
        "bom.csv",
        "bom.md",
        "circuit.json",
        "design-report.md",
        "manifest.json",
        "schematic-transparent.svg",
        "schematic.svg",
      ]),
    );
    const projectArchiveDirectory = path.join(projectDirectory, "exports", "project-archives");
    const projectArchiveFiles = await readdir(projectArchiveDirectory);
    expect(projectArchiveFiles.filter((name) => name.endsWith(".tar.gz"))).toHaveLength(1);
    expect(projectArchiveFiles.filter((name) => name.endsWith(".manifest.json"))).toHaveLength(1);
    const archiveManifestName = projectArchiveFiles.find((name) => name.endsWith(".manifest.json"));
    if (!archiveManifestName) {
      throw new Error("Expected a project archive manifest.");
    }
    const archiveManifest = JSON.parse(
      await readFile(path.join(projectArchiveDirectory, archiveManifestName), "utf8"),
    ) as { archiveRelativePath?: unknown; sha256?: unknown };
    expect(typeof archiveManifest.archiveRelativePath).toBe("string");
    portableArchivePath = path.join(projectDirectory, String(archiveManifest.archiveRelativePath));
    const archivePayload = await readFile(portableArchivePath);
    expect(createHash("sha256").update(archivePayload).digest("hex")).toBe(archiveManifest.sha256);
    await expectProjectLayout(projectDirectory);

    const circuit = CircuitDocumentSchema.parse(
      JSON.parse(await readFile(path.join(projectDirectory, "circuit.json"), "utf8")),
    );
    const resistor = circuit.components.find((component) => component.reference === "R1");
    if (!resistor) {
      throw new Error("Expected R1 in the E2E circuit.");
    }
    const proposalId = "00000000-0000-4000-8000-000000000099";
    await writeFile(
      path.join(projectDirectory, "history", `proposal--${proposalId}.json`),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: proposalId,
          projectId: manifest.id,
          baseRevision: 1,
          rationale: "Use a higher resistor value for this fixture.",
          operations: [
            {
              type: "set_component_value",
              componentId: resistor.id,
              value: "2.2 kΩ",
            },
          ],
          status: "pending",
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await application.close();
    application = undefined;

    ({ app: application, page } = await launch());
    await expect(page.getByText("Untitled Circuit", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Project active")).toBeVisible();
    await expect(page.getByRole("button", { name: "R1, Resistor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "D1, LED" })).toBeVisible();
    await page.getByRole("button", { name: "Breadboard", exact: true }).click();
    await expect(page.getByText(/Assembly rev 1 · circuit rev 1/)).toBeVisible();
    await expect(page.getByLabel("a1 occupied by R1.1")).toBeVisible();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Camera snapshot 1 from revision 1" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Camera snapshot 2 from revision 1" }),
    ).toBeVisible();
    await expect(page.getByText("Pi proposes 1 circuit change(s)")).toBeVisible();
    await expect(page.getByText("Nothing changes until you approve.")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Pi proposes 1 circuit change(s)")).toBeHidden();
    await expect(page.getByText("Revision 2").last()).toBeVisible();
    await expect(page.getByText("2.2 kΩ", { exact: true })).toBeVisible();
    const updatedManifest = ProjectManifestSchema.parse(
      JSON.parse(await readFile(path.join(projectDirectory, "project.json"), "utf8")),
    );
    expect(updatedManifest.circuitRevision).toBe(2);
    const resolvedProposal = JSON.parse(
      await readFile(
        path.join(projectDirectory, "history", `proposal--${proposalId}.json`),
        "utf8",
      ),
    ) as { status?: unknown };
    expect(resolvedProposal.status).toBe("approved");
    await expect(page.getByRole("button", { name: "Undo last circuit change" })).toHaveCount(0);

    await application.close();
    application = undefined;
    ({ app: application, page } = await launch());
    await expect(page.getByText("Revision 2").last()).toBeVisible();
    await expect(page.getByText("2.2 kΩ", { exact: true })).toBeVisible();
    await page.getByText("Untitled Circuit", { exact: true }).last().hover();
    await page.getByRole("button", { name: "Rename Untitled Circuit" }).click();
    const renameDialog = page.getByRole("dialog");
    await renameDialog.getByLabel("Project name").fill("Bench LED");
    await renameDialog.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByText("Bench LED", { exact: true }).last()).toBeVisible();
    expect(
      ProjectManifestSchema.parse(
        JSON.parse(await readFile(path.join(projectDirectory, "project.json"), "utf8")),
      ).title,
    ).toBe("Bench LED");

    const importRoot = path.join(testRoot, "imported-projects");
    await mkdir(importRoot);
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, importRoot);
    await page.getByRole("button", { name: "projects", exact: true }).click();
    await expect(page.getByText("No circuit project selected")).toBeVisible();
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, portableArchivePath);
    await page.getByRole("button", { name: "Import project archive" }).click();
    await expect(page.getByText("Untitled Circuit", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Revision 1").last()).toBeVisible();
    await expect(page.getByRole("button", { name: "R1, Resistor" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Camera snapshot 1 from revision 1" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Camera snapshot 2 from revision 1" }),
    ).toBeVisible();
    const importedDirectories = await readdir(importRoot);
    expect(importedDirectories).toHaveLength(1);
    await expectProjectLayout(path.join(importRoot, importedDirectories[0] ?? "missing"));
    expect(rendererErrors).toEqual([]);
  } finally {
    await application?.close().catch(() => undefined);
    await new Promise<void>((resolve) => remoteCameraServer?.close(() => resolve()) ?? resolve());
    await rm(testRoot, { recursive: true, force: true });
  }
});

async function expectProjectLayout(projectDirectory: string): Promise<void> {
  const entries = new Set(await readdir(projectDirectory));
  expect(entries).toEqual(
    new Set([
      "assembly.json",
      "AGENTS.md",
      "attachments",
      "captures",
      "chat",
      "circuit.json",
      "exports",
      "firmware",
      "history",
      "project.json",
      "simulation",
      "trash",
    ]),
  );
}

function processEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
}

function createMinimalPdf(text: string): Uint8Array {
  const escapedText = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
