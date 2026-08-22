export type EmploymentSnapshot = Readonly<{
  workforce: number;
  totalJobs: number;
  employed: number;
  unemployed: number;
  vacancies: number;
  unemploymentRate: number;
}>;

export class EmploymentSystem {
  evaluate(population: number, totalJobs: number): EmploymentSnapshot {
    const pop = Math.max(0, Math.floor(Number.isFinite(population) ? population : 0));
    const jobs = Math.max(0, Math.floor(Number.isFinite(totalJobs) ? totalJobs : 0));
    const workforce = Math.floor(pop * 0.5);
    const employed = Math.min(workforce, jobs);
    const unemployed = Math.max(0, workforce - employed);
    const vacancies = Math.max(0, jobs - employed);
    return {
      workforce,
      totalJobs: jobs,
      employed,
      unemployed,
      vacancies,
      unemploymentRate: workforce === 0 ? 0 : unemployed / workforce,
    };
  }
  evaluateFromFirmTotals(population: number, totalJobs: number, employedJobs: number): EmploymentSnapshot {
    const pop = Math.max(0, Math.floor(Number.isFinite(population) ? population : 0));
    const workforce = Math.floor(pop * 0.5);
    const jobs = Math.max(0, Math.floor(Number.isFinite(totalJobs) ? totalJobs : 0));
    const employed = Math.max(0, Math.min(workforce, jobs, Math.floor(Number.isFinite(employedJobs) ? employedJobs : 0)));
    const unemployed = Math.max(0, workforce - employed);
    return { workforce, totalJobs: jobs, employed, unemployed, vacancies: Math.max(0, jobs - employed), unemploymentRate: workforce === 0 ? 0 : unemployed / workforce };
  }

}
