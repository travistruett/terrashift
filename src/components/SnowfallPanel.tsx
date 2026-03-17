"use client";

import {
  ActionIcon,
  Button,
  Card,
  Collapse,
  Group,
  HoverCard,
  LoadingOverlay,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useSnowfallStore } from "@/stores/snowfall";
import { useClimateStore } from "@/stores/climate";

const BIN_MIN = -40;

/**
 * Logistic snow fraction using wet-bulb temperature (Jennings et al. 2018).
 * T50 = 0.5°C wet-bulb (hemispheric mean), steepness a = 1.5.
 * Wet-bulb accounts for evaporative cooling, improving rain/snow
 * partitioning in dry continental climates.
 */
function snowFraction(Tw: number): number {
  return 1 / (1 + Math.exp(1.5 * (Tw - 0.5)));
}

/**
 * Compute total annual snowfall (cm) from temperature-binned precipitation.
 *
 * For each 1°C bin:
 *   1. Shift the bin temperature by deltaT
 *   2. Scale precipitation by Clausius-Clapeyron (e^(0.06 * deltaT))
 *   3. Apply logistic snow fraction at the shifted temperature
 *   4. Sum across all bins
 *
 * precipitation_sum is in mm; 1mm precip ≈ 1cm snow depth.
 */
function computeSnowfall(precipDist: number[], deltaT: number): number {
  const ccScale = Math.exp(0.06 * deltaT);
  let total = 0;
  for (let i = 0; i < precipDist.length; i++) {
    const T_shifted = BIN_MIN + i + deltaT;
    total += precipDist[i] * ccScale * snowFraction(T_shifted);
  }
  return total;
}

function formatCoord(lat: number, lng: number): string {
  const latStr = `${Math.abs(lat).toFixed(1)}\u00B0${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(1)}\u00B0${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

export default function SnowfallPanel() {
  const { lat, lng, precipDist, baselineSnowfallCm, loading, error, clear, fetchBaseline } =
    useSnowfallStore();
  const tempDiff = useClimateStore((s) => s.tempDiff);
  const [methodOpen, { toggle: toggleMethod }] = useDisclosure(false);
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);
  const narrow = useMediaQuery("(max-width: 768px)");

  // Only show panel once a fetch has been initiated (not just a pin drop)
  if (lat === null || lng === null) return null;
  if (!loading && !error && precipDist.length === 0) return null;

  // The model computes a ratio: how much does the physics change snowfall?
  // We apply that ratio to the observed baseline (ERA5 snowfall_sum) for calibrated output.
  const hasData = precipDist.length > 0;
  const modelBaseline = hasData ? computeSnowfall(precipDist, 0) : 0;
  const modelProjected = hasData ? computeSnowfall(precipDist, tempDiff) : 0;
  const changeRatio = modelBaseline > 0 ? modelProjected / modelBaseline : 0;
  const projectedSnowfallCm = baselineSnowfallCm * changeRatio;

  const isTrace = baselineSnowfallCm < 0.1;

  const changePct =
    baselineSnowfallCm > 0
      ? ((projectedSnowfallCm - baselineSnowfallCm) / baselineSnowfallCm) * 100
      : 0;

  // Counterintuitive: cooling but snowfall decreases (moisture starvation)
  const isMoistureStarved = tempDiff < -3 && changePct < -10;
  // Counterintuitive: moderate warming slightly increases snowfall
  const isWarmingIncrease = tempDiff > 0.5 && changePct > 5;

  return (
    <Card
      shadow="md"
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
            color="gray"
            onClick={() => fetchBaseline(lat, lng)}
          >
            Retry
          </Button>
        </Stack>
      ) : (
        <Stack gap="lg">
          {isTrace ? (
            <Text size="sm" c="dimmed" fs="italic">
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
                    {baselineSnowfallCm.toFixed(1)} cm/yr{" "}
                    <Text span size="xs" c="dimmed" fw={400}>
                      ({(baselineSnowfallCm * 0.3937).toFixed(1)} in/yr)
                    </Text>
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Projected</Text>
                  <Text size="sm" fw={600}>
                    {projectedSnowfallCm.toFixed(1)} cm/yr{" "}
                    <Text span size="xs" c="dimmed" fw={400}>
                      ({(projectedSnowfallCm * 0.3937).toFixed(1)} in/yr)
                    </Text>
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Change</Text>
                  <HoverCard
                    width={280}
                    shadow="md"
                    position="left"
                    disabled={!isMoistureStarved && !isWarmingIncrease}
                  >
                    <HoverCard.Target>
                      <Text
                        size="sm"
                        fw={600}
                        c={changePct > 0 ? "blue.4" : changePct < 0 ? "red.4" : "dimmed"}
                        style={(isMoistureStarved || isWarmingIncrease) ? {
                          textDecoration: "underline dotted",
                          cursor: "help",
                        } : undefined}
                      >
                        {changePct >= 0 ? "+" : ""}
                        {changePct.toFixed(1)}%
                      </Text>
                    </HoverCard.Target>
                    <HoverCard.Dropdown
                      style={{ backgroundColor: "rgba(26, 27, 30, 0.95)" }}
                    >
                      {isMoistureStarved && (
                        <Text size="xs" c="dimmed" lh={1.5}>
                          <Text span fw={600} c="yellow.5">Why does colder mean less snow?</Text>{" "}
                          Very cold air holds far less moisture (Clausius-Clapeyron). Below a
                          certain point, the atmosphere becomes too dry to produce heavy
                          snowfall{"\u2014"}the same reason Antarctica{"'"}s interior is one of
                          the driest places on Earth despite extreme cold.
                        </Text>
                      )}
                      {isWarmingIncrease && (
                        <Text size="xs" c="dimmed" lh={1.5}>
                          <Text span fw={600} c="blue.4">Why does warming increase snow here?</Text>{" "}
                          At this location, most precipitation already falls below
                          freezing. Warmer air holds ~7% more moisture per degree, so total
                          precipitation increases faster than the rain/snow boundary shifts.
                          At higher warming the effect reverses as snow converts to rain.
                        </Text>
                      )}
                    </HoverCard.Dropdown>
                  </HoverCard>
                </Group>
              </Stack>

              <Stack
                gap={6}
                bg="dark.7"
                p="sm"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <Text size="xs" fw={500} c="dimmed" td="underline">
                  Inputs
                </Text>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Temperature shift</Text>
                  <Text size="xs">
                    {tempDiff >= 0 ? "+" : ""}{tempDiff.toFixed(1)}{"\u00B0"}C
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Moisture scaling</Text>
                  <Text size="xs">
                    {tempDiff >= 0 ? "+" : ""}
                    {((Math.exp(0.06 * tempDiff) - 1) * 100).toFixed(0)}%
                  </Text>
                </Group>
              </Stack>
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
            <Stack gap={6}>
              <Text size="xs" c="dimmed" lh={1.5}>
                30-year daily precipitation (1991{"\u2013"}2020) is binned by wet-bulb temperature in
                1{"\u00B0"}C intervals. Wet-bulb accounts for humidity, improving the rain/snow split
                in dry climates. For each bin, the temperature is shifted by {"\u0394"}T, precipitation
                is scaled by the Clausius-Clapeyron relation (+6%/{"\u00B0"}C), and a logistic
                snow fraction determines the rain/snow split (T{"\u2085\u2080"} = 0.5{"\u00B0"}C wet-bulb,
                per Jennings et al. 2018). Data from ERA5 reanalysis via Open-Meteo.
              </Text>
              <Text
                size="xs"
                c="blue.4"
                mt={4}
                style={{ cursor: "pointer" }}
                onClick={openModal}
              >
                Read more {"\u2192"}
              </Text>
            </Stack>
          </Collapse>

          <Modal
            opened={modalOpen}
            onClose={closeModal}
            title="Snowfall Projection Model"
            size="lg"
            styles={{
              header: { backgroundColor: "var(--mantine-color-dark-7)" },
              body: { backgroundColor: "var(--mantine-color-dark-7)" },
            }}
          >
            <Stack gap="md">
              <Text size="sm" lh={1.6}>
                Click any point on the globe to see how snowfall changes under different temperatures.
                The model uses 30 years of daily weather data to build a detailed picture of when and
                how precipitation falls at that location.
              </Text>

              <Text size="sm" fw={600}>How It Works</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                The server fetches 30 years (1991{"\u2013"}2020) of daily precipitation, temperature, and
                relative humidity from ERA5 reanalysis. For each day, wet-bulb temperature is computed
                using the Stull (2011) approximation, and precipitation is sorted into 1{"\u00B0"}C wet-bulb
                bins (70 bins from {"\u2212"}40{"\u00B0"}C to +29{"\u00B0"}C). Wet-bulb temperature accounts for
                evaporative cooling from humidity, which improves rain/snow partitioning {"\u2014"} especially
                in dry continental climates where dry-bulb temperature alone overestimates snowfall.
              </Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                The projection runs client-side (so it updates instantly as you drag the slider).
                For each bin:
              </Text>
              <Text size="sm" c="dimmed" lh={1.6} ff="monospace" pl="md">
                1. Shift the bin temperature by {"\u0394"}T{"\n"}
                2. Scale precipitation by Clausius-Clapeyron{"\n"}
                3. Apply snow fraction at the new temperature{"\n"}
                4. Sum across all bins
              </Text>

              <Text size="sm" fw={600}>Snow Fraction (Jennings et al. 2018)</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Determines what fraction of precipitation falls as snow using a logistic function
                calibrated from 17.8 million surface observations. Using wet-bulb temperature lowers
                the 50% threshold from 1.0{"\u00B0"}C (dry-bulb) to 0.5{"\u00B0"}C:
              </Text>
              <Text size="sm" c="dimmed" lh={1.6} ff="monospace" pl="md">
                snowFraction(Tw) = 1 / (1 + exp(1.5 {"\u00D7"} (Tw {"\u2212"} 0.5)))
              </Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                At {"\u2212"}2{"\u00B0"}C: ~98% snow. At 0.5{"\u00B0"}C: 50%. At +3.5{"\u00B0"}C: ~1% snow.
              </Text>

              <Text size="sm" fw={600}>Clausius-Clapeyron Moisture Scaling</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Warmer air holds more moisture. For every degree of warming, atmospheric moisture
                capacity increases ~6% (thermodynamic rate for extratropical precipitation):
              </Text>
              <Text size="sm" c="dimmed" lh={1.6} ff="monospace" pl="md">
                moistureScale = e^(0.06 {"\u00D7"} {"\u0394"}T)
              </Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                This is why moderate warming can briefly <Text span fs="italic">increase</Text> snowfall
                at cold locations {"\u2014"} the extra moisture outpaces the rain/snow shift until
                temperatures rise enough to flip precipitation to rain.
              </Text>

              <Text size="sm" fw={600}>Calibrated Output</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Rather than trusting the model{"\u2019"}s absolute numbers, the projection computes a
                {" "}<Text span fs="italic">ratio</Text> of change and applies it to the observed ERA5
                baseline. The physics drives direction and magnitude; real-world data anchors it to
                reality.
              </Text>

              <Text size="sm" fw={600}>Limitations</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                {"\u2022"} ERA5 resolution is ~25km {"\u2014"} snowfall varies at finer scales in mountains{"\n"}
                {"\u2022"} Temperature bins shift uniformly (no change in variance or storm tracks){"\n"}
                {"\u2022"} Moisture scaling is thermodynamic only (no dynamic synoptic changes)
              </Text>

              <Text size="xs" c="dimmed" lh={1.5} mt="sm">
                <Text span fw={600}>References:</Text>{" "}
                Jennings et al. (2018), <Text span fs="italic">Nature Communications</Text> 9, 1148.{" "}
                O{"\u2019"}Gorman (2014), <Text span fs="italic">Nature</Text> 512, 416{"\u2013"}418.{" "}
                ERA5 reanalysis via Open-Meteo.
              </Text>
            </Stack>
          </Modal>
        </Stack>
      )}
    </Card>
  );
}
