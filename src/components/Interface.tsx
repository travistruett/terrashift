"use client";

import {
  ActionIcon,
  Box,
  Card,
  Collapse,
  Group,
  Slider,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useClimateStore } from "@/stores/climate";

function sliderToYears(v: number): number {
  return Math.round(Math.pow(10, 1 + (3 * v) / 1000));
}

function yearsToSlider(y: number): number {
  return ((Math.log10(Math.max(10, y)) - 1) * 1000) / 3;
}

function formatIcePct(slr: number): string {
  const pct = ((-slr * 362_000) / 26_500_000) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export default function Interface() {
  const { tempDiff, timeFrame, slr, setTempDiff, setTimeFrame } =
    useClimateStore();
  const [opened, { toggle }] = useDisclosure(true);

  const timeSliderValue = yearsToSlider(timeFrame);
  const slrColor = slr > 0 ? "red.4" : slr < 0 ? "blue.4" : "dimmed";

  return (
    <Card
      shadow="xl"
      p="lg"
      radius="md"
      pos="absolute"
      bottom={24}
      left={24}
      w={360}
      style={{
        zIndex: 10,
        backgroundColor: "rgba(26, 27, 30, 0.85)",
        backdropFilter: "blur(10px)",
      }}
    >
      <Group justify="space-between" align="center" mb={opened ? "md" : 0}>
        <Title order={4}>TerraShift</Title>
        <ActionIcon variant="subtle" color="gray" onClick={toggle} aria-label="Toggle panel">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: opened ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 200ms ease",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </ActionIcon>
      </Group>

      <Collapse in={opened}>
        <Stack gap="md">
          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>Temperature</Text>
              <Text size="sm" c="dimmed">
                {tempDiff >= 0 ? "+" : ""}{tempDiff.toFixed(1)}°C
              </Text>
            </Group>
            <Slider
              mb={24}
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
          </Box>

          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>Timeframe</Text>
              <Text size="sm" c="dimmed">
                {timeFrame.toLocaleString()} years
              </Text>
            </Group>
            <Slider
              mb={24}
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
          </Box>

          <Stack gap={6} bg="dark.7" p="sm" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Sea Level</Text>
              <Text size="sm" fw={600} c={slrColor}>
                {slr >= 0 ? "+" : ""}{slr.toFixed(2)}m ({(slr * 3.281).toFixed(1)}ft)
              </Text>
            </Group>
            <Group justify="space-between" mt={4}>
              <Text size="sm" c="dimmed">Ice Mass</Text>
              <Text size="sm" fw={600} c={slrColor}>
                {formatIcePct(slr)}
              </Text>
            </Group>
          </Stack>
        </Stack>
      </Collapse>
    </Card>
  );
}
