import EarthCanvas from "@/components/EarthCanvas";
import Interface from "@/components/Interface";
import SnowfallPanel from "@/components/SnowfallPanel";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <EarthCanvas />
      <Interface />
      <SnowfallPanel />
    </main>
  );
}
