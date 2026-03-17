import EarthCanvas from "@/components/EarthCanvas";
import ClimatePanel from "@/components/ClimatePanel";
import GitHubLink from "@/components/GitHubLink";
import LocationSearch from "@/components/LocationSearch";
import SnowfallPanel from "@/components/SnowfallPanel";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <EarthCanvas />
      <GitHubLink />
      <LocationSearch />
      <ClimatePanel />
      <SnowfallPanel />
    </main>
  );
}
