"use client";

import {
  Card,
  Slider,
  Text,
  Title,
  Stack,
  Group,
} from "@mantine/core";
import { useClimateStore } from "@/stores/climate";

/** Convert internal slider value (0–1000) to years (10–10,000) on a log scale */
function sliderToYears(v: number): number {
  return Math.round(Math.pow(10, 1 + (3 * v) / 1000));
}

/** Convert years back to the internal slider value */
function yearsToSlider(y: number): number {
  return ((Math.log10(Math.max(10, y)) - 1) * 1000) / 3;
}

/** Ice mass change as % of present-day land ice (~26.5M Gt) */
function formatIcePct(slr: number): string {
  const pct = (-slr * 362_000) / 26_500_000 * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export default function Interface() {
  const { tempDiff, timeFrame, slr, setTempDiff, setTimeFrame } =
    useClimateStore();

  const timeSliderValue = yearsToSlider(timeFrame);

  return (
    <Card
      shadow="xl"
      padding="lg"
      radius="md"
      style={{
        position: "absolute",
        bottom: 24,
        left: 24,
        width: 360,
        zIndex: 10,
        backgroundColor: "rgba(26, 27, 30, 0.85)",
        backdropFilter: "blur(10px)",
      }}
    >
      <Stack gap="md">
        <Title order={4}>TerraShift</Title>

        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>
              Temperature
            </Text>
            <Text size="sm" c="dimmed">
              {tempDiff >= 0 ? "+" : ""}
              {tempDiff.toFixed(1)}°C
            </Text>
          </Group>
          <Slider
            value={tempDiff}
            onChange={setTempDiff}
            min={-40}
            max={40}
            step={0.1}
            marks={[
              { value: -40, label: "-40°C" },
              { value: 0, label: "0" },
              { value: 40, label: "+40°C" },
            ]}
            color={tempDiff > 0 ? "red" : tempDiff < 0 ? "blue" : "gray"}
          />
        </div>

        <div style={{ marginTop: 8 }}>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>
              Timeframe
            </Text>
            <Text size="sm" c="dimmed">
              {timeFrame.toLocaleString()} years
            </Text>
          </Group>
          <Slider
            value={timeSliderValue}
            onChange={(v) => setTimeFrame(sliderToYears(v))}
            min={0}
            max={1000}
            step={1}
            label={(v) => `${sliderToYears(v).toLocaleString()}yr`}
            marks={[
              { value: 0, label: "10yr" },
              { value: 333, label: "100" },
              { value: 667, label: "1k" },
              { value: 1000, label: "10k" },
            ]}
            color="teal"
          />
        </div>

        <div
          style={{
            marginTop: 4,
            padding: "10px 12px",
            borderRadius: 8,
            backgroundColor: "rgba(255, 255, 255, 0.04)",
          }}
        >
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Sea level</Text>
            <Text
              size="sm"
              fw={600}
              c={slr > 0 ? "red.4" : slr < 0 ? "blue.4" : "dimmed"}
            >
              {slr >= 0 ? "+" : ""}{slr.toFixed(2)}m ({(slr * 3.281).toFixed(1)}ft)
            </Text>
          </Group>
          <Group justify="space-between" mt={4}>
            <Text size="sm" c="dimmed">Ice mass</Text>
            <Text
              size="sm"
              fw={600}
              c={slr > 0 ? "red.4" : slr < 0 ? "blue.4" : "dimmed"}
            >
              {formatIcePct(slr)}
            </Text>
          </Group>
        </div>
      </Stack>
    </Card>
  );
}
