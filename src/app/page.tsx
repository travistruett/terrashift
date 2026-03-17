import { Group } from "@mantine/core";
import EarthCanvas from "@/components/EarthCanvas";
import ClimatePanel from "@/components/ClimatePanel";
import GitHubLink from "@/components/GitHubLink";
import LocationSearch from "@/components/LocationSearch";
import WeatherPanel from "@/components/WeatherPanel";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <EarthCanvas />
      <Group
        justify="space-between"
        align="center"
        pos="absolute"
        top="var(--mantine-spacing-md)"
        left="var(--mantine-spacing-md)"
        right="var(--mantine-spacing-md)"
        style={{ zIndex: 10 }}
        wrap="nowrap"
      >
        <LocationSearch />
        <GitHubLink />
      </Group>
      <ClimatePanel />
      <WeatherPanel />
    </main>
  );
}
