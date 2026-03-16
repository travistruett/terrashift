import EarthCanvas from "@/components/EarthCanvas";
import Interface from "@/components/Interface";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <EarthCanvas />
      <Interface />
    </main>
  );
}
