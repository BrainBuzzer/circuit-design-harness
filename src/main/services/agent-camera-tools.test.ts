import { describe, expect, it } from "vitest";
import { requestsBuildCameraInspection } from "./agent-camera-tools";

describe("build-camera request routing", () => {
  it.each([
    "Take a look",
    "Hey Eve, take a look at this",
    "Check this with camera",
    "Hey Eve, does this design look correct?",
    "Can you inspect the breadboard build?",
    "Look at the camera and compare it with the circuit",
  ])("routes %j to an immediate camera capture", (request) => {
    expect(requestsBuildCameraInspection(request)).toBe(true);
  });

  it.each([
    "Change R1 to 330 ohms",
    "Summarize the attached datasheet",
    "Compile the Arduino firmware",
  ])("does not capture for unrelated request %j", (request) => {
    expect(requestsBuildCameraInspection(request)).toBe(false);
  });
});
