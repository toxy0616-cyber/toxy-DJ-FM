import { ToxyRadio } from "@/components/toxy-radio";
import { getBootstrapData } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const bootstrap = await getBootstrapData();
  return <ToxyRadio {...bootstrap} />;
}
