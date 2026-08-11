import type { CoachSnapshot } from "@shared/coach-contract";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LabCoachPanelProps {
  readonly projectId: string;
  readonly onAskCoach?: (prompt: string) => void;
}

export function LabCoachPanel({ projectId, onAskCoach }: LabCoachPanelProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<CoachSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selectedLessonId, setSelectedLessonId] = useState<string>("");
  const [firmwareStatus, setFirmwareStatus] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const next = await window.circuitHarness.getCoach(projectId);
      setSnapshot(next);
      setError(undefined);
      if (next.progress.lessonId) {
        setSelectedLessonId(next.progress.lessonId);
      } else if (next.lessons[0]) {
        setSelectedLessonId((current) => current || next.lessons[0]!.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<CoachSnapshot>) => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const boardLabel = (board: string) =>
    board === "arduino_uno_r3" ? "Arduino Uno" : board === "esp32s3" ? "ESP32-S3" : board;

  return (
    <div className="flex size-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
        <GraduationCapIcon className="mt-0.5 size-4 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Lab coach</h2>
            <Badge variant="secondary" className="text-[10px]">
              Mode A · starter kits
            </Badge>
          </div>
          <p className="text-[11.5px] leading-snug text-ink-3">
            Golden lessons for Uno and ESP32-S3. Guidance coaches your build; it does not prove
            wiring, voltage, or safety from the camera alone.
          </p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex flex-col gap-2 rounded-xl border border-line bg-field/40 p-3">
            <label className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Start a lesson
            </label>
            <Select
              value={selectedLessonId}
              onValueChange={(value) => setSelectedLessonId(value ?? "")}
            >
              <SelectTrigger className="w-full bg-surface" size="sm">
                <SelectValue placeholder="Choose a starter lesson" />
              </SelectTrigger>
              <SelectContent>
                {(snapshot?.lessons ?? []).map((lesson) => (
                  <SelectItem key={lesson.id} value={lesson.id}>
                    {boardLabel(lesson.board)} · {lesson.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !selectedLessonId}
                size="sm"
                onClick={() =>
                  void run(() =>
                    window.circuitHarness.startCoachLesson({
                      projectId,
                      lessonId: selectedLessonId,
                    }),
                  )
                }
              >
                <BookOpenIcon data-icon="inline-start" />
                Start lesson
              </Button>
              {snapshot?.progress.lessonId && (
                <Button
                  disabled={busy}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(() => window.circuitHarness.clearCoachLesson({ projectId }))
                  }
                >
                  <XIcon data-icon="inline-start" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {snapshot?.activeLesson && snapshot.activeStep ? (
            <div className="flex flex-col gap-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{boardLabel(snapshot.activeLesson.board)}</Badge>
                <span className="text-sm font-medium text-ink">{snapshot.activeLesson.title}</span>
                <span className="text-[11.5px] text-ink-3">
                  Step {snapshot.stepNumber}/{snapshot.totalSteps}
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink">{snapshot.activeStep.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">
                  {snapshot.activeStep.instruction}
                </p>
              </div>
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Why</h4>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{snapshot.activeStep.why}</p>
              </div>
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Reference wiring
                </h4>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
                  {snapshot.activeStep.referenceSummary}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
                  {snapshot.activeLesson.pinMap.map((pin) => (
                    <li key={`${pin.signal}-${pin.boardPin}`}>
                      <span className="font-medium text-ink">{pin.signal}</span> → {pin.boardPin}
                      {pin.notes ? ` (${pin.notes})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Camera checklist
                </h4>
                <ul className="mt-1 space-y-1">
                  {snapshot.activeStep.cameraChecklist.map((item) => (
                    <li key={item} className="flex gap-2 text-xs text-ink-2">
                      <CheckIcon className="mt-0.5 size-3 shrink-0 text-accent" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Common mistakes
                </h4>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
                  {snapshot.activeLesson.commonMistakes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  disabled={busy || snapshot.isLastStep}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void run(() => window.circuitHarness.advanceCoachLesson({ projectId }))
                  }
                >
                  Next step
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onAskCoach?.(
                      `Explain lab step ${snapshot.stepNumber} of ${snapshot.activeLesson?.title} and what I should verify on camera.`,
                    )
                  }
                >
                  Ask Eve to teach this step
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onAskCoach?.(
                      `Check my build for step ${snapshot.stepNumber} (${snapshot.activeStep?.title}) against the golden checklist.`,
                    )
                  }
                >
                  Check my build
                </Button>
                <Button
                  disabled={busy || !snapshot.activeLesson}
                  size="sm"
                  variant="default"
                  onClick={() => {
                    if (!snapshot.activeLesson) {
                      return;
                    }
                    setBusy(true);
                    setFirmwareStatus(undefined);
                    setError(undefined);
                    void window.circuitHarness
                      .applyCoachLessonFirmware({
                        projectId,
                        lessonId: snapshot.activeLesson.id,
                      })
                      .then((applied) => {
                        const outcome = applied.result.compilation.outcome;
                        setFirmwareStatus(
                          outcome === "passed"
                            ? `Golden sketch compiled (${applied.targetId}). Success check: ${applied.successCheck}`
                            : outcome === "not_available"
                              ? "Sketch saved. Install arduino-cli: bash scripts/setup-arduino-cli.sh then restart the app."
                              : `Compile ${outcome}: ${applied.result.compilation.summary}`,
                        );
                      })
                      .catch((reason: unknown) => {
                        setError(reason instanceof Error ? reason.message : String(reason));
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  Load golden sketch + compile
                </Button>
              </div>
              {firmwareStatus && (
                <p className="text-xs leading-relaxed text-ink-2">{firmwareStatus}</p>
              )}
              {snapshot.isLastStep && (
                <p className="text-xs text-ink-3">
                  Last step. Use firmware only after the physical map matches the reference; camera
                  still cannot prove continuity or safety.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-3">
              <p className="font-medium text-ink-2">No active lesson</p>
              <p className="mt-1 text-xs leading-relaxed">
                Pick a starter lesson above, or ask in chat for things like “wire an LED on Uno” or
                “ESP32 button and buzzer”. Freeform schematic design remains available under
                Schematic / Breadboard as advanced sandbox.
              </p>
              <ul className="mt-3 space-y-1 text-xs">
                {(snapshot?.lessons ?? []).map((lesson) => (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      className="text-left text-accent hover:underline"
                      onClick={() => setSelectedLessonId(lesson.id)}
                    >
                      {boardLabel(lesson.board)}: {lesson.title}
                    </button>
                    <span className="text-ink-3"> — {lesson.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
