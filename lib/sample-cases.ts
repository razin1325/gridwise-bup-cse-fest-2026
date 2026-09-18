import samplePack from '../BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json';

export interface SampleCase {
  id: string;
  label: string;
  input: any;
  expected_output: any;
  rationale: string;
}

export const SAMPLE_CASES: SampleCase[] = (samplePack.cases || []).map((c: any) => ({
  id: c.id,
  label: c.label,
  input: c.input,
  expected_output: c.expected_output,
  rationale: c.rationale,
}));

export function getSampleCaseById(id: string): SampleCase | undefined {
  return SAMPLE_CASES.find((c) => c.id === id);
}
