"use client";

import {
  ActionIcon,
  Button,
  Card,
  Collapse,
  Group,
  LoadingOverlay,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useSnowfallStore } from "@/stores/snowfall";
import { useClimateStore } from "@/stores/climate";

function snowFraction(t: number): number {
  return Math.max(0, Math.min(1, (1.5 - t) / 3.0));
}

function moistureFactor(dT: number): number {
  // Warming: full Clausius-Clapeyron at ~7%/°C (moisture is the secondary effect).
  // Cooling: net ~2%/°C — the 7% moisture decrease is largely offset by snow season
  // extension (~5%/°C) into shoulder months the model doesn't capture directly.
  const rate = dT < 0 ? 0.02 : 0.07;
  return Math.exp(rate * dT);
}

function formatCoord(lat: number, lng: number): string {
  const latStr = `${Math.abs(lat).toFixed(1)}\u00B0${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(1)}\u00B0${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

export default function SnowfallPanel() {
  const { lat, lng, baselineSnowfallCm, meanWinterTempC, loading, error, clear, fetchBaseline } =
    useSnowfallStore();
  const tempDiff = useClimateStore((s) => s.tempDiff);
  const [methodOpen, { toggle: toggleMethod }] = useDisclosure(false);
  const narrow = useMediaQuery("(max-width: 768px)");

  if (lat === null || lng === null) return null;

  // Projection calculation
  const baselineFrac = snowFraction(meanWinterTempC);
  const projectedFrac = snowFraction(meanWinterTempC + tempDiff);
  const moisture = moistureFactor(tempDiff);

  const isTrace = baselineSnowfallCm < 0.1;
  // Only treat as "non-snow" when BOTH model fraction and observed snowfall are negligible.
  // Warm-margin locations (mean winter temp > 1.5C) can still have real snow from cold events.
  const isNonSnow = baselineFrac < 0.01 && baselineSnowfallCm < 0.1;
  const isWarmMargin = baselineFrac < 0.01 && baselineSnowfallCm >= 0.1;

  let projectedSnowfallCm = 0;
  if (!isNonSnow && !isTrace) {
    if (isWarmMargin) {
      // Warm-margin: real snow exists but mean winter temp is above the model's
      // snow fraction threshold. Snow comes from cold-event tails, so the fraction
      // ratio method is unreliable. Scale by moisture only (conservative).
      projectedSnowfallCm = baselineSnowfallCm * moisture;
    } else {
      projectedSnowfallCm =
        projectedFrac === 0
          ? 0
          : baselineSnowfallCm * (projectedFrac / baselineFrac) * moisture;
    }
  }

  const changePct =
    baselineSnowfallCm > 0
      ? ((projectedSnowfallCm - baselineSnowfallCm) / baselineSnowfallCm) * 100
      : 0;

  const projectedWinterTemp = meanWinterTempC + tempDiff;

  return (
    <Card
      shadow="xl"
      p="lg"
      radius="md"
      pos="absolute"
      bottom={narrow ? 200 : 24}
      left={narrow ? 24 : undefined}
      right={narrow ? undefined : 24}
      w={340}
      style={{
        zIndex: 10,
        backgroundColor: "rgba(26, 27, 30, 0.85)",
        backdropFilter: "blur(10px)",
      }}
    >
      <LoadingOverlay visible={loading} zIndex={20} overlayProps={{ blur: 2 }} />

      <Group justify="space-between" align="center" mb="md">
        <div>
          <Title order={5}>Snowfall Projection</Title>
          <Text size="xs" c="dimmed">
            {formatCoord(lat, lng)}
          </Text>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={clear} aria-label="Close snowfall panel">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </ActionIcon>
      </Group>

      {error ? (
        <Stack align="center" gap="sm">
          <Text size="sm" c="red.4">
            {error}
          </Text>
          <Button
            size="xs"
            variant="light"
            onClick={() => fetchBaseline(lat, lng)}
          >
            Retry
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          {isTrace ? (
            <Text size="sm" c="dimmed" ta="center">
              Trace / negligible snowfall at this location
            </Text>
          ) : (
            <>
              <Stack
                gap={6}
                bg="dark.7"
                p="sm"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Baseline</Text>
                  <Text size="sm" fw={600}>
                    {baselineSnowfallCm.toFixed(1)} cm/yr
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Projected</Text>
                  <Text size="sm" fw={600}>
                    {projectedSnowfallCm.toFixed(1)} cm/yr
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Change</Text>
                  <Text
                    size="sm"
                    fw={600}
                    c={changePct > 0 ? "blue.4" : changePct < 0 ? "red.4" : "dimmed"}
                  >
                    {changePct >= 0 ? "+" : ""}
                    {changePct.toFixed(1)}%
                  </Text>
                </Group>
              </Stack>

              <Stack
                gap={6}
                bg="dark.7"
                p="sm"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <Text size="xs" fw={500} c="dimmed">
                  Inputs
                </Text>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Winter Temp</Text>
                  <Text size="xs">
                    {meanWinterTempC.toFixed(1)}{"\u00B0"}C {"\u2192"} {projectedWinterTemp.toFixed(1)}{"\u00B0"}C
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Precip as Snow</Text>
                  <Text size="xs">
                    {(baselineFrac * 100).toFixed(0)}% {"\u2192"} {(projectedFrac * 100).toFixed(0)}%
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Moisture</Text>
                  <Text size="xs">
                    {tempDiff >= 0 ? "+" : ""}
                    {((moisture - 1) * 100).toFixed(0)}%
                  </Text>
                </Group>
              </Stack>

              {isWarmMargin && (
                <Text size="xs" c="yellow.6" lh={1.4}>
                  Warm-margin location — mean winter temp above model threshold. Projection uses moisture scaling only.
                </Text>
              )}
            </>
          )}

          <Group justify="space-between" align="center" style={{ cursor: "pointer" }} onClick={toggleMethod}>
            <Text size="xs" c="dimmed">Methodology</Text>
            <ActionIcon variant="subtle" color="gray" size="xs" aria-label="Toggle methodology">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: methodOpen ? "rotate(0deg)" : "rotate(180deg)",
                  transition: "transform 200ms ease",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </ActionIcon>
          </Group>
          <Collapse in={methodOpen}>
            <Text size="xs" c="dimmed" lh={1.5}>
              Snow fraction model: linear transition between -1.5°C (100% snow) and +1.5°C
              (0% snow). Moisture scales at +7%/°C (Clausius-Clapeyron). Baseline: WMO 1991-2020
              climate normal from ERA5 reanalysis (Open-Meteo).
            </Text>
          </Collapse>
        </Stack>
      )}
    </Card>
  );
}
