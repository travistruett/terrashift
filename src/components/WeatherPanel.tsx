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
import { useWeatherStore } from "@/stores/weather";
import { useClimateStore } from "@/stores/climate";

const BIN_MIN = -40;

function snowFraction(Tw: number): number {
  return 1 / (1 + Math.exp(1.5 * (Tw - 0.5)));
}

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

function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

function mmToIn(mm: number): number {
  return mm * 0.03937;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" fw={600}>{children}</Text>
    </Group>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>
      {children}
    </Text>
  );
}

function MetricBlock({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      gap={6}
      bg="dark.7"
      p="sm"
      style={{ borderRadius: "var(--mantine-radius-sm)" }}
    >
      {children}
    </Stack>
  );
}

export default function WeatherPanel() {
  const {
    lat, lng, precipDist, baselineSnowfallCm,
    avgHighC, avgLowC, totalPrecipMm, avgRH,
    loading, error, clear, fetchBaseline,
  } = useWeatherStore();
  const tempDiff = useClimateStore((s) => s.tempDiff);
  const [methodOpen, { toggle: toggleMethod }] = useDisclosure(false);
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);
  const narrow = useMediaQuery("(max-width: 768px)");

  if (lat === null || lng === null) return null;
  if (!loading && !error && precipDist.length === 0) return null;

  const hasData = precipDist.length > 0;

  // Snowfall projection
  const modelBaseline = hasData ? computeSnowfall(precipDist, 0) : 0;
  const modelProjected = hasData ? computeSnowfall(precipDist, tempDiff) : 0;
  const baselineIsTrace = baselineSnowfallCm < 0.1;

  let projectedSnowfallCm: number;
  let snowChangePct: number;
  if (!baselineIsTrace && modelBaseline > 0) {
    // Ratio approach: calibrate model against ERA5 observed snowfall
    const changeRatio = modelProjected / modelBaseline;
    projectedSnowfallCm = baselineSnowfallCm * changeRatio;
    snowChangePct = ((projectedSnowfallCm - baselineSnowfallCm) / baselineSnowfallCm) * 100;
  } else {
    // Absolute approach: no baseline snowfall to calibrate against
    // 1mm water-equivalent ≈ 1cm snow (standard 10:1 fresh snow density)
    projectedSnowfallCm = modelProjected;
    snowChangePct = 0;
  }
  const isTrace = baselineIsTrace && projectedSnowfallCm < 0.1;

  // Precipitation projection
  // Per-event CC rate (6%/°C) for snowfall bins; energy-budget rate (2%/°C) for
  // total annual precip (Held & Soden 2006 — radiative cooling limits the
  // hydrological cycle, so total precip scales much slower than column moisture).
  const ccScale = Math.exp(0.06 * tempDiff);
  const precipScale = Math.exp(0.02 * tempDiff);
  const projectedPrecipMm = totalPrecipMm * precipScale;
  const precipChangePct =
    totalPrecipMm > 0
      ? ((projectedPrecipMm - totalPrecipMm) / totalPrecipMm) * 100
      : 0;

  // Temperature projection (simple shift)
  const projHighC = avgHighC + tempDiff;
  const projLowC = avgLowC + tempDiff;

  // Counterintuitive snowfall explanations
  const isMoistureStarved = tempDiff < -3 && snowChangePct < -10;
  const isWarmingIncrease = tempDiff > 0.5 && snowChangePct > 5;

  return (
    <Card
      shadow="md"
      p={{ base: "md", sm: "lg" }}
      radius="md"
      pos="absolute"
      bottom={narrow ? "calc(55vh + var(--mantine-spacing-md))" : "var(--mantine-spacing-md)"}
      left={narrow ? "var(--mantine-spacing-md)" : undefined}
      right={narrow ? undefined : "var(--mantine-spacing-md)"}
      w={{ base: "90vw", sm: 340 }}
      mah={narrow ? "calc(45vh - 36px)" : "calc(100vh - 48px)"}
      style={{
        zIndex: 10,
        backgroundColor: "rgba(26, 27, 30, 0.85)",
        backdropFilter: "blur(10px)",
        overflowY: "auto",
      }}
    >
      <LoadingOverlay visible={loading} zIndex={20} overlayProps={{ blur: 2 }} />

      <Group justify="space-between" align="center" mb="md">
        <div>
          <Title order={5}>Weather Projection</Title>
          <Text size="xs" c="dimmed">
            {formatCoord(lat, lng)}
          </Text>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={clear} aria-label="Close weather panel">
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
        <Stack gap="md">
          {/* Temperature */}
          <MetricBlock>
            <SectionLabel>Temperature</SectionLabel>
            <Row label="Avg High">
              {projHighC.toFixed(1)}{"\u00B0"}C{" "}
              <Text span size="xs" c="dimmed" fw={400}>
                ({cToF(projHighC).toFixed(0)}{"\u00B0"}F)
              </Text>
            </Row>
            <Row label="Avg Low">
              {projLowC.toFixed(1)}{"\u00B0"}C{" "}
              <Text span size="xs" c="dimmed" fw={400}>
                ({cToF(projLowC).toFixed(0)}{"\u00B0"}F)
              </Text>
            </Row>
            {tempDiff !== 0 && (
              <Text size="xs" c="dimmed">
                baseline {avgHighC.toFixed(1)}/{avgLowC.toFixed(1)}{"\u00B0"}C
              </Text>
            )}
          </MetricBlock>

          {/* Precipitation */}
          <MetricBlock>
            <SectionLabel>Precipitation</SectionLabel>
            <Row label="Annual">
              {projectedPrecipMm.toFixed(0)} mm/yr{" "}
              <Text span size="xs" c="dimmed" fw={400}>
                ({mmToIn(projectedPrecipMm).toFixed(1)} in)
              </Text>
            </Row>
            {tempDiff !== 0 && (
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  baseline {totalPrecipMm.toFixed(0)} mm
                </Text>
                <Text
                  size="xs"
                  fw={600}
                  c={precipChangePct > 0 ? "blue.4" : precipChangePct < 0 ? "red.4" : "dimmed"}
                >
                  {precipChangePct >= 0 ? "+" : ""}{precipChangePct.toFixed(1)}%
                </Text>
              </Group>
            )}
          </MetricBlock>

          {/* Snowfall */}
          <MetricBlock>
            <SectionLabel>Snowfall</SectionLabel>
            {isTrace ? (
              <Text size="sm" c="dimmed" fs="italic">
                Trace / negligible at this location
              </Text>
            ) : baselineIsTrace ? (
              <>
                <Row label="Projected">
                  {projectedSnowfallCm.toFixed(1)} cm/yr{" "}
                  <Text span size="xs" c="dimmed" fw={400}>
                    ({(projectedSnowfallCm * 0.3937).toFixed(1)} in)
                  </Text>
                </Row>
                <Text size="xs" c="dimmed">
                  no current snowfall {"\u2014"} model estimate from precipitation data
                </Text>
              </>
            ) : (
              <>
                <Row label="Baseline">
                  {baselineSnowfallCm.toFixed(1)} cm/yr{" "}
                  <Text span size="xs" c="dimmed" fw={400}>
                    ({(baselineSnowfallCm * 0.3937).toFixed(1)} in)
                  </Text>
                </Row>
                <Row label="Projected">
                  {projectedSnowfallCm.toFixed(1)} cm/yr{" "}
                  <Text span size="xs" c="dimmed" fw={400}>
                    ({(projectedSnowfallCm * 0.3937).toFixed(1)} in)
                  </Text>
                </Row>
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
                        c={snowChangePct > 0 ? "blue.4" : snowChangePct < 0 ? "red.4" : "dimmed"}
                        style={(isMoistureStarved || isWarmingIncrease) ? {
                          textDecoration: "underline dotted",
                          cursor: "help",
                        } : undefined}
                      >
                        {snowChangePct >= 0 ? "+" : ""}
                        {snowChangePct.toFixed(1)}%
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
              </>
            )}
          </MetricBlock>

          {/* Humidity */}
          <MetricBlock>
            <SectionLabel>Humidity</SectionLabel>
            <Row label="Avg Relative">
              {avgRH.toFixed(0)}%
            </Row>
            {tempDiff !== 0 && (
              <Text size="xs" c="dimmed">
                RH stays ~constant; absolute moisture{" "}
                {tempDiff > 0 ? "+" : ""}{((ccScale - 1) * 100).toFixed(0)}%
              </Text>
            )}
          </MetricBlock>

          {/* Methodology */}
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
                30-year daily weather data (1991{"\u2013"}2020) from ERA5 reanalysis via Open-Meteo.
                Temperature projections shift the baseline by {"\u0394"}T. Precipitation scales at
                +2%/{"\u00B0"}C (energy-budget constraint, Held {"\u0026"} Soden 2006). Snowfall uses wet-bulb temperature binning with
                a logistic rain/snow split (T{"\u2085\u2080"} = 0.5{"\u00B0"}C, per Jennings et al. 2018).
                Relative humidity stays approximately constant under warming; absolute moisture
                increases ~6%/{"\u00B0"}C.
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
            title="Weather Projection Model"
            size="lg"
            styles={{
              header: { backgroundColor: "var(--mantine-color-dark-7)" },
              body: { backgroundColor: "var(--mantine-color-dark-7)" },
            }}
          >
            <Stack gap="md">
              <Text size="sm" lh={1.6}>
                Click any point on the globe to see how local weather changes under different
                temperatures. The model uses 30 years of daily weather data to build a detailed
                picture of conditions at that location.
              </Text>

              <Text size="sm" fw={600}>Data Source</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                ERA5 reanalysis via Open-Meteo (1991{"\u2013"}2020, WMO 30-year climate normal).
                Daily variables: max/min temperature (~11km), precipitation (~25km), relative
                humidity (~11km), and snowfall. Temperature and humidity use ERA5-Land via the
                {" "}<Text span ff="monospace">best_match</Text> model for higher resolution.
              </Text>

              <Text size="sm" fw={600}>Temperature</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Baseline average daily high and low are computed from 30 years of daily
                {" "}<Text span ff="monospace">temperature_2m_max</Text> and{" "}
                <Text span ff="monospace">temperature_2m_min</Text>. Projected values shift
                the baseline by {"\u0394"}T. This is a first-order approximation{"\u2014"}in
                reality, cold extremes tend to warm faster than warm extremes (polar amplification).
              </Text>

              <Text size="sm" fw={600}>Precipitation</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Annual total precipitation scales at ~2%/{"\u00B0"}C, not the full Clausius-Clapeyron
                rate of ~6{"\u2013"}7%. While column water vapor scales at the CC rate, total
                precipitation is constrained by the atmospheric energy budget{"\u2014"}the troposphere
                can only radiate heat so fast, which limits the hydrological cycle (Held {"\u0026"}{" "}
                Soden 2006). The snowfall model uses the full CC rate for per-event moisture
                scaling, since individual storms can tap the full moisture column.
              </Text>

              <Text size="sm" fw={600}>Snowfall Model</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                The server fetches 30 years of daily precipitation, temperature, and
                relative humidity. For each day, wet-bulb temperature is computed
                using the Stull (2011) approximation, and precipitation is sorted into 1{"\u00B0"}C wet-bulb
                bins (70 bins from {"\u2212"}40{"\u00B0"}C to +29{"\u00B0"}C). Wet-bulb temperature accounts for
                evaporative cooling from humidity, which improves rain/snow partitioning{"\u2014"}especially
                in dry continental climates where dry-bulb temperature alone overestimates snowfall.
              </Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                The projection runs client-side (updates instantly as you drag the slider).
                For each bin:
              </Text>
              <Text size="sm" c="dimmed" lh={1.6} ff="monospace" pl="md">
                1. Shift the bin temperature by {"\u0394"}T{"\n"}
                2. Scale precipitation by Clausius-Clapeyron{"\n"}
                3. Apply snow fraction at the new temperature{"\n"}
                4. Sum across all bins
              </Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                For locations with observed snowfall, the model computes a ratio (projected/baseline)
                and applies it to the ERA5 observed value for calibration. For locations with no
                current snowfall (e.g., tropical regions under extreme cooling), the model output
                is used directly{"\u2014"}1mm water-equivalent {"\u2248"} 1cm snow at standard 10:1 density.
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

              <Text size="sm" fw={600}>Humidity</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Relative humidity stays approximately constant under climate change (a well-established
                result from observations and models). Absolute moisture increases ~6%/{"\u00B0"}C via
                Clausius-Clapeyron. The displayed RH is the 30-year daily mean.
              </Text>

              <Text size="sm" fw={600}>Limitations</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                {"\u2022"} Precipitation resolution is ~25km; temperature/humidity are ~11km (ERA5-Land){"\n"}
                {"\u2022"} Temperature shifts uniformly (no change in variance or storm tracks){"\n"}
                {"\u2022"} Moisture scaling is thermodynamic only (no dynamic synoptic changes){"\n"}
                {"\u2022"} Cold extremes warm faster than warm extremes in reality (not modeled)
              </Text>

              <Text size="xs" c="dimmed" lh={1.5} mt="sm">
                <Text span fw={600}>References:</Text>{" "}
                Jennings et al. (2018), <Text span fs="italic">Nature Communications</Text> 9, 1148.{" "}
                O{"\u2019"}Gorman (2014), <Text span fs="italic">Nature</Text> 512, 416{"\u2013"}418.{" "}
                Held {"\u0026"} Soden (2006), <Text span fs="italic">J. Climate</Text> 19(21).{" "}
                ERA5 reanalysis via Open-Meteo.
              </Text>
            </Stack>
          </Modal>
        </Stack>
      )}
    </Card>
  );
}
