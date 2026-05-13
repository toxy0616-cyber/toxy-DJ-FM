import { ToxyRadio } from '@/components/toxy-radio';
import { getRadioState } from '@/lib/orchestrator';

export default async function Page() {
  const initialState = await getRadioState();

  return <ToxyRadio initialState={initialState} />;
}
