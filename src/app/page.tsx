import EarthCanvas from "@/components/EarthCanvas";
import ClimatePanel from "@/components/ClimatePanel";
import LocationSearch from "@/components/LocationSearch";
import SnowfallPanel from "@/components/SnowfallPanel";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <EarthCanvas />
      <LocationSearch />
      <ClimatePanel />
      <SnowfallPanel />
    </main>
  );
}
