"use client";

import {
  ActionIcon,
  Box,
  Card,
  Collapse,
  Group,
  Modal,
  SegmentedControl,
  Slider,
  Stack,
  Table,
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

export default function ClimatePanel() {
  const { tempDiff, timeFrame, slr, iceSLR, seaSeason, setTempDiff, setTimeFrame, setSeaSeason } =
    useClimateStore();
  const [opened, { toggle }] = useDisclosure(true);
  const [methodOpen, { toggle: toggleMethod }] = useDisclosure(false);
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);

  const timeSliderValue = yearsToSlider(timeFrame);
  const slrColor = slr > 0 ? "red.4" : slr < 0 ? "blue.4" : "dimmed";

  return (
    <Card
      shadow="md"
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
        <Title order={4} style={{ letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 300 }}>TerraShift</Title>
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
        <Stack gap="lg">
          <Stack gap={6}>
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
              domain={[-50, 50]}
              step={0.1}
              marks={[
                { value: -40, label: "-40°C" },
                { value: 0, label: "0" },
                { value: 40, label: "+40°C" },
              ]}
              color={tempDiff > 0 ? "red" : tempDiff < 0 ? "blue" : "gray"}
            />
          </Stack>

          <Stack gap={6}>
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
              domain={[-100, 1100]}
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
          </Stack>

          <Stack gap={6} bg="dark.9" p="md" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Sea Level</Text>
              <Text size="sm" fw={600} c={slrColor}>
                {slr >= 0 ? "+" : ""}{slr.toFixed(2)}m{" "}
                <Text span size="xs" c="dimmed" fw={400}>
                  ({(slr * 3.281).toFixed(1)}ft)
                </Text>
              </Text>
            </Group>
            <Group justify="space-between" mt={4}>
              <Text size="sm" c="dimmed">Ice Mass</Text>
              <Text size="sm" fw={600} c={slrColor}>
                {formatIcePct(iceSLR)}
              </Text>
            </Group>
          </Stack>

          <Box>
            <Text size="sm" fw={500} mb={6}>Sea Ice Season</Text>
            <SegmentedControl
              fullWidth
              size="xs"
              value={String(seaSeason)}
              onChange={(v) => setSeaSeason(Number(v))}
              data={[
                { label: "Summer (Sep)", value: "0" },
                { label: "Winter (Mar)", value: "1" },
              ]}
            />
          </Box>

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
                <Text span fw={600}>Sea Level:</Text> Five-component model with thermal expansion (0.42m/{"\u00B0"}C),
                mountain glaciers (0.34m/{"\u00B0"}C, capped 0.5m), Greenland (7.4m), West Antarctic (5m),
                and East Antarctic (53m) ice sheets. Each responds on its own timescale; ice sheets
                activate via sigmoid tipping points.
              </Text>
              <Text size="xs" c="dimmed" lh={1.5}>
                <Text span fw={600}>Ice Mass:</Text> Approximated from sea level change {"\u2014"} 362,000 km{"\u00B3"} of water
                per meter of SLR, against 26.5 million km{"\u00B3"} total land ice.
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
            title="Sea Level Rise Model"
            size="lg"
            styles={{
              header: { backgroundColor: "var(--mantine-color-dark-7)" },
              body: { backgroundColor: "var(--mantine-color-dark-7)" },
            }}
          >
            <Stack gap="md">
              <Text size="sm" lh={1.6}>
                TerraShift uses a multi-component sea level model based on Levermann et al. (2013).
                Each component has its own equilibrium sensitivity, response timescale ({"\u03C4"}), and
                optional tipping-point threshold:
              </Text>
              <Text size="sm" fw={600} ff="monospace">
                SLR = sign({"\u0394"}T) {"\u00D7"} {"\u03A3"} [ sensitivity({"\u0394"}T) {"\u00D7"} (1 {"\u2212"} e^(-t/{"\u03C4"})) ]
              </Text>
              <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Component</Table.Th>
                    <Table.Th>Sensitivity</Table.Th>
                    <Table.Th>{"\u03C4"} (years)</Table.Th>
                    <Table.Th>Tipping Point</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>Thermal expansion</Table.Td>
                    <Table.Td>0.42 m/{"\u00B0"}C (linear)</Table.Td>
                    <Table.Td>200</Table.Td>
                    <Table.Td>{"\u2014"}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Mountain glaciers</Table.Td>
                    <Table.Td>0.34 m/{"\u00B0"}C (capped 0.5m)</Table.Td>
                    <Table.Td>150</Table.Td>
                    <Table.Td>{"\u2014"}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Greenland</Table.Td>
                    <Table.Td>7.4m total</Table.Td>
                    <Table.Td>3,000</Table.Td>
                    <Table.Td>~1.5{"\u00B0"}C</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>West Antarctic (WAIS)</Table.Td>
                    <Table.Td>5.0m total</Table.Td>
                    <Table.Td>800</Table.Td>
                    <Table.Td>~3.0{"\u00B0"}C</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>East Antarctic (EAIS)</Table.Td>
                    <Table.Td>53.0m total</Table.Td>
                    <Table.Td>10,000</Table.Td>
                    <Table.Td>~8.0{"\u00B0"}C</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              <Text size="sm" fw={600}>Tipping Points</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Ice sheets don{"\u2019"}t respond linearly to warming. Below a threshold, they barely respond;
                above it, collapse accelerates. This is modeled with a sigmoid function that smoothly
                transitions from 0 to 1 around the threshold temperature.
              </Text>

              <Text size="sm" fw={600}>Mountain Glacier Cap</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                There is a finite amount of alpine ice on Earth (~0.41m sea level equivalent). Once
                committed to melt (~1.5{"\u00B0"}C), further warming can{"\u2019"}t add more {"\u2014"} there is no more
                mountain ice to lose. The model caps this at 0.5m.
              </Text>

              <Text size="sm" fw={600}>Ice Temperature Response</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Ice doesn{"\u2019"}t respond instantly. A two-component lag model captures the difference
                between fast-responding sea ice ({"\u03C4"}=50yr, 30% weight) and slow continental ice sheets
                ({"\u03C4"}=2,000yr, 70% weight). At 100 years, ice has only responded to ~29% of the
                temperature change; at 1,000 years, ~57%; near-equilibrium takes ~10,000 years.
              </Text>

              <Text size="sm" fw={600}>Ice Mass</Text>
              <Text size="sm" c="dimmed" lh={1.6}>
                Ice mass change is approximated from the ice-only component of sea level rise
                (excluding thermal expansion). 362,000 km{"\u00B3"} of meltwater per meter of SLR, measured
                against ~26.5 million km{"\u00B3"} of total land ice on Earth today.
              </Text>

              <Text size="sm" fw={600}>Example Scenarios</Text>
              <Table striped withTableBorder withColumnBorders fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Scenario</Table.Th>
                    <Table.Th>Sea Level Rise</Table.Th>
                    <Table.Th>What{"\u2019"}s Happening</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>+2{"\u00B0"}C, 100yr</Table.Td>
                    <Table.Td>~0.6m</Table.Td>
                    <Table.Td>Thermal + glaciers + early Greenland</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>+2{"\u00B0"}C, 3,000yr</Table.Td>
                    <Table.Td>~5.5m</Table.Td>
                    <Table.Td>Most of Greenland + some WAIS</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>+10{"\u00B0"}C, 10,000yr</Table.Td>
                    <Table.Td>~56m</Table.Td>
                    <Table.Td>Everything committed</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>{"\u2212"}6{"\u00B0"}C, 3,000yr</Table.Td>
                    <Table.Td>~{"\u2212"}5.5m</Table.Td>
                    <Table.Td>Sea level drop from ice growth</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              <Text size="xs" c="dimmed" lh={1.5} mt="sm">
                <Text span fw={600}>Reference:</Text> Levermann, A., et al. (2013). {"\u201C"}The multimillennial
                sea-level commitment of global warming.{"\u201D"}{" "}
                <Text span fs="italic">PNAS</Text>, 110(34), 13745{"\u2013"}13750.
              </Text>
            </Stack>
          </Modal>
        </Stack>
      </Collapse>
    </Card>
  );
}
